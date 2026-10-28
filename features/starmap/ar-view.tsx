"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import {
  MATCH_TOLERANCE_PX,
  MAX_SCALE,
  MIN_SCALE,
  findBrightSpots,
  matchAsterism,
  solveAlignment,
  type AlignmentTarget,
} from "@/features/starmap/ar-alignment";
import { overlayStyle, useOverlayContrast, type OverlayStyle } from "@/features/starmap/ar-brightness";
import { useRearCamera, type CameraState } from "@/features/starmap/ar-camera";
import { useDeviceRotation } from "@/features/starmap/ar-orientation";
import {
  calibrationStep,
  focalLengthPx,
  projectToScreen,
  viewAltitude,
  type ArCorrection,
  type Matrix3,
  type ScreenProjection,
} from "@/features/starmap/ar-projection";
import { ASTERISMS } from "@/features/starmap/asterisms";
import { cameraLongFov } from "@/features/starmap/native-app";
import {
  constellationExtents,
  findConstellationAt,
  horizontalCoords,
  isLargeEnough,
  starSize,
  type ChartSegment,
  type HorizontalCoords,
  type Point,
} from "@/features/starmap/sky-math";
import type { StarmapData } from "@/features/starmap/starmap-data";

// 카메라 영상 위라 6등급까지 그리면 너무 빽빽하다. 밝은 별만 그린다.
const MAX_MAGNITUDE = 4;
// 하늘지도와 같은 규칙: 선택 거리, 작은 별자리 숨김, 끌기와 누르기의 경계, 지평선 아래 밝기.
const HIT_DISTANCE = 20;
const MIN_CONSTELLATION_PX = 60;
const DRAG_THRESHOLD = 4;
const HIDDEN_SKY_OPACITY = 0.7;
// 방위 글씨는 지평선 바로 아래(가려진 하늘 쪽)에 둔다.
const COMPASS_LABEL_ALT = -3;
// 자동 맞추기: 지표별 예상 자리 둘레로 화면 짧은 변의 이 비율 안에서 찾는다(나침반 오차 약 20° 까지).
const SEARCH_RADIUS_RATIO = 0.35;
// 밝은 점을 찾을 때 영상을 이 크기(긴 변)로 줄여서 본다.
const CAPTURE_LONG_SIDE = 480;
const RESULT_NOTICE_MS = 4000;
const ALIGN_METHOD_KEY = "starmap:ar-align-method";

type AlignMethod = "auto" | "manual";

type ArViewProps = {
  data: StarmapData;
  latDeg: number;
  lstDeg: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showAsterisms: boolean;
  // 하늘지도와 같은 위치·시각 줄.
  header: React.ReactNode;
  // 선택한 별자리의 설명 팝업.
  popup: React.ReactNode;
  // 방위·기울기·크기 보정. AR 화면을 닫았다 열어도 유지되도록 밖에서 들고 있는다.
  correction: ArCorrection;
  onCorrectionChange: Dispatch<SetStateAction<ArCorrection>>;
  // 안드로이드 뒤로 가기를 AR 화면이 먼저 처리할 수 있게 넘겨주는 자리. 처리했으면 true.
  backHandlerRef: React.RefObject<(() => boolean) | null>;
  onClose: () => void;
  // 카메라 권한을 거부했거나 카메라를 켤 수 없을 때.
  onCameraUnavailable: (state: Extract<CameraState, "denied" | "failed">) => void;
};

// 보정값을 -180~180 으로 맞춘다.
function normalizeOffset(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

function signedDegrees(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}°`;
}

function readAlignMethod(): AlignMethod {
  try {
    return window.localStorage.getItem(ALIGN_METHOD_KEY) === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

function writeAlignMethod(method: AlignMethod) {
  try {
    window.localStorage.setItem(ALIGN_METHOD_KEY, method);
  } catch {
    // 저장소를 쓸 수 없으면 이번 방문에서만 기억한다.
  }
}

export function ArView({
  data,
  latDeg,
  lstDeg,
  selectedId,
  onSelect,
  showAsterisms,
  header,
  popup,
  correction,
  onCorrectionChange,
  backHandlerRef,
  onClose,
  onCameraUnavailable,
}: ArViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRearCamera(videoRef);
  // 영상이 밝을수록 겹친 그림이 묻히므로 대비를 자동으로 올린다.
  const contrast = useOverlayContrast(videoRef);
  const style = useMemo(() => overlayStyle(contrast), [contrast]);
  const { rotation, available } = useDeviceRotation();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const longFov = useMemo(() => cameraLongFov(), []);
  // 마지막으로 계산한 화면(누른 곳의 별자리, 자동 맞추기의 지표별 자리를 찾을 때 쓴다).
  const frameRef = useRef<Frame | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ last: Point; start: Point; moved: boolean; pinchDistance: number | null } | null>(null);

  // 지표별 맞추기
  const [aligning, setAligning] = useState(false);
  const [method, setMethod] = useState<AlignMethod>(readAlignMethod);
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching" | "failed">("idle");
  const [canAlign, setCanAlign] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const beforeAlign = useRef<ArCorrection | null>(null);

  useEffect(() => {
    if (camera === "denied" || camera === "failed") onCameraUnavailable(camera);
  }, [camera, onCameraUnavailable]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), RESULT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const cancelAlign = useCallback(() => {
    if (beforeAlign.current) onCorrectionChange(beforeAlign.current);
    beforeAlign.current = null;
    setAligning(false);
    setSearchStatus("idle");
  }, [onCorrectionChange]);

  // 맞추기 중이면 뒤로 가기가 맞추기를 취소한다.
  useEffect(() => {
    backHandlerRef.current = () => {
      if (!aligning) return false;
      cancelAlign();
      return true;
    };
    return () => {
      backHandlerRef.current = null;
    };
  }, [aligning, cancelAlign, backHandlerRef]);

  // 하늘의 고도·방위는 시각(1분마다)과 위치가 바뀔 때만 다시 계산한다. 화면 좌표는 매 프레임 바꾼다.
  const sky = useMemo<Sky>(() => {
    const observer = { lstDeg, latDeg };
    const toHorizontal = ([ra, dec]: number[]) => horizontalCoords({ ra, dec }, observer);
    return {
      stars: data.stars
        .filter(({ properties }) => properties.mag <= MAX_MAGNITUDE)
        .map(({ geometry, properties }) => ({ at: toHorizontal(geometry.coordinates), size: starSize(properties.mag) })),
      lines: data.lines.flatMap(({ id, geometry }) =>
        geometry.coordinates.flatMap((line) =>
          line.slice(1).map((end, i) => ({ id, a: toHorizontal(line[i]), b: toHorizontal(end) }))
        )
      ),
      labels: data.constellations.map(({ id, properties, geometry }) => ({
        id,
        name: properties.ko,
        at: toHorizontal(geometry.coordinates),
      })),
      asterisms: ASTERISMS.map(({ name, stars }) => ({
        name,
        stars: stars.map((star) => ({ name: star.name, at: horizontalCoords(star, observer) })),
      })),
    };
  }, [data, latDeg, lstDeg]);

  const projectionFor = useCallback(
    (extra: Partial<ScreenProjection> = {}): ScreenProjection => {
      const video = videoRef.current;
      return {
        width: box.width,
        height: box.height,
        screenAngle: screen.orientation?.angle ?? 0,
        focalPx: focalLengthPx({
          width: box.width,
          height: box.height,
          videoWidth: video?.videoWidth ?? 0,
          videoHeight: video?.videoHeight ?? 0,
          longFovDeg: longFov,
        }),
        ...correction,
        ...extra,
      };
    },
    [box, longFov, correction]
  );

  // 센서 값이 들어오는 대로 매 프레임 다시 계산하고 그린다.
  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    const canvas = canvasRef.current;
    const frame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
    const cancel = window.cancelAnimationFrame ?? window.clearTimeout;
    let handle = 0;

    const tick = () => {
      handle = frame(tick);
      const matrix = rotation.current;
      if (!matrix) return;
      const computed = computeFrame(sky, matrix, projectionFor(), selectedId, showAsterisms || aligning);
      frameRef.current = computed;
      setCanAlign(computed.alignTargets.length > 0);

      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== box.width * ratio || canvas.height !== box.height * ratio) {
        canvas.width = box.width * ratio;
        canvas.height = box.height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      paintFrame(ctx, computed, selectedId, aligning, style);
    };
    tick();
    return () => cancel(handle);
  }, [box, sky, rotation, projectionFor, selectedId, showAsterisms, aligning, style]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      drag.current = { last: point, start: point, moved: false, pinchDistance: null };
    } else if (pointers.current.size === 2 && drag.current) {
      // 두 손가락: 맞추기 중에는 크기를 바꾼다. 손을 뗄 때 별자리를 고르지 않는다.
      const [a, b] = [...pointers.current.values()];
      drag.current.moved = true;
      drag.current.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const current = drag.current;
    if (!current) return;

    if (pointers.current.size >= 2) {
      if (!aligning || current.pinchDistance === null) return;
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (current.pinchDistance > 0) {
        const ratio = distance / current.pinchDistance;
        onCorrectionChange((c) => ({ ...c, scale: clampScale(c.scale * ratio) }));
      }
      current.pinchDistance = distance;
      return;
    }

    if (!current.moved && Math.hypot(point.x - current.start.x, point.y - current.start.y) > DRAG_THRESHOLD) {
      current.moved = true;
    }
    if (!current.moved) return;
    const dx = point.x - current.last.x;
    const dy = point.y - current.last.y;
    current.last = point;
    const matrix = rotation.current;
    const params = frameRef.current?.params;
    if (!matrix || !params) return;
    const f = params.focalPx * (params.scale ?? 1);
    // 좌우는 방위를 보정한다(그림이 손가락을 따라온다). 위아래(기울기)는 맞추기 중에만 보정한다.
    const azimuthStep = dx === 0 ? 0 : calibrationStep(dx, f, viewAltitude(matrix));
    const pitchStep = aligning && dy !== 0 ? (Math.atan(dy / f) * 180) / Math.PI : 0;
    if (azimuthStep === 0 && pitchStep === 0) return;
    onCorrectionChange((c) => ({
      ...c,
      azimuthOffset: normalizeOffset(c.azimuthOffset + azimuthStep),
      pitchOffset: Math.max(-45, Math.min(45, c.pitchOffset + pitchStep)),
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
    const current = drag.current;
    if (pointers.current.size > 0) return;
    drag.current = null;
    if (!current || current.moved || aligning) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const id = findConstellationAt(point, frameRef.current?.segments ?? [], HIT_DISTANCE);
    if (id) onSelect(id);
  }

  function startAlign() {
    beforeAlign.current = correction;
    setSearchStatus("idle");
    setNotice(null);
    setAligning(true);
  }

  function chooseMethod(next: AlignMethod) {
    setMethod(next);
    writeAlignMethod(next);
    setSearchStatus("idle");
  }

  function finishAlign(name: string, scale: number, how: "수동" | "자동") {
    beforeAlign.current = null;
    setAligning(false);
    setSearchStatus("idle");
    setNotice(`${name} 기준으로 맞춤 완료 · 크기 ×${scale.toFixed(2)} (${how})`);
  }

  function confirmManual() {
    const target = mostVisibleTarget(frameRef.current?.alignTargets ?? [], box);
    if (target) finishAlign(target.name, correction.scale, "수동");
  }

  function searchAutomatically() {
    setSearchStatus("searching");
    // "찾는 중"을 먼저 그린 뒤 영상을 분석한다.
    setTimeout(() => {
      const result = findAlignment(videoRef.current, frameRef.current, rotation.current, correction, box);
      if (!result) {
        setSearchStatus("failed");
        return;
      }
      onCorrectionChange(result.correction);
      finishAlign(result.name, result.correction.scale, "자동");
    }, 0);
  }

  const offsetParts = [
    Math.round(correction.azimuthOffset) !== 0 ? `방위 ${signedDegrees(correction.azimuthOffset)}` : null,
    Math.round(correction.pitchOffset) !== 0 ? `기울기 ${signedDegrees(correction.pitchOffset)}` : null,
  ].filter(Boolean);
  const scaled = Math.abs(correction.scale - 1) >= 0.005;

  let alignStatus: string | null = null;
  if (aligning) {
    if (!canAlign) alignStatus = "지표별이 보이는 쪽으로 폰을 돌려 주세요";
    else if (searchStatus === "searching") alignStatus = "지표별을 찾는 중…";
    else if (searchStatus === "failed")
      alignStatus = "영상에서 지표별을 찾지 못했습니다. 지표별 쪽을 비추고 다시 찾거나, 수동으로 맞춰 주세요.";
    else if (method === "manual") alignStatus = "끌어서 위치를, 두 손가락으로 크기를 맞춘 뒤 '맞췄어요'를 누르세요.";
    else alignStatus = "지표별 쪽을 비추고 '자동으로 찾기'를 누르세요.";
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="AR 화면"
      className="fixed inset-0 z-50 overflow-hidden bg-black text-white"
    >
      <video
        ref={videoRef}
        aria-label="AR 카메라 영상"
        className="absolute inset-0 size-full object-cover"
        autoPlay
        muted
        playsInline
      />
      {/* 영상이 밝을 때 깔아 배경을 눌러 주는 검은 막 */}
      <div
        aria-hidden
        data-testid="ar-scrim"
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-500"
        style={{ opacity: style.scrim }}
      />
      <canvas
        ref={canvasRef}
        aria-label="AR 별자리 겹쳐 보기"
        className="absolute inset-0 size-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size === 0) drag.current = null;
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b from-black/60 to-transparent pb-6">
        {header}
        <div className="pointer-events-auto px-3 pt-2">
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label="AR 닫기"
            className="rounded-full shadow-lg"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {!available && (
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2">
          <Card className="bg-slate-950/70 text-white ring-white/15">
            <CardHeader>
              <CardDescription className="text-slate-200">
                이 기기에서는 방향 센서를 쓸 수 없어 별자리를 겹쳐 그릴 수 없습니다.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}
      {popup && !aligning && (
        <div className="absolute inset-x-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom))]">{popup}</div>
      )}
      <div className="absolute inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-2 [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
        {(notice || alignStatus) && (
          <p role="status" className="rounded-lg bg-slate-950/70 px-3 py-2 text-center text-sm">
            {notice ?? alignStatus}
          </p>
        )}
        {(offsetParts.length > 0 || scaled) && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {offsetParts.length > 0 && (
              <>
                <span className="rounded-full bg-slate-950/60 px-3 py-1.5">보정 {offsetParts.join(" ")}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => onCorrectionChange((c) => ({ ...c, azimuthOffset: 0, pitchOffset: 0 }))}
                >
                  보정 초기화
                </Button>
              </>
            )}
            {scaled && (
              <>
                <span className="rounded-full bg-slate-950/60 px-3 py-1.5">크기 ×{correction.scale.toFixed(2)}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => onCorrectionChange((c) => ({ ...c, scale: 1 }))}
                >
                  크기 초기화
                </Button>
              </>
            )}
          </div>
        )}
        {aligning ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex rounded-full bg-slate-950/60 p-1">
              {(["auto", "manual"] as const).map((option) => (
                <Button
                  key={option}
                  variant={method === option ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={method === option}
                  className="rounded-full"
                  onClick={() => chooseMethod(option)}
                >
                  {option === "auto" ? "자동" : "수동"}
                </Button>
              ))}
            </div>
            {method === "auto" ? (
              <Button
                className="rounded-full shadow-lg"
                disabled={!canAlign || searchStatus === "searching"}
                onClick={searchAutomatically}
              >
                자동으로 찾기
              </Button>
            ) : (
              <Button className="rounded-full shadow-lg" disabled={!canAlign} onClick={confirmManual}>
                맞췄어요
              </Button>
            )}
            <Button variant="secondary" className="rounded-full shadow-lg" onClick={cancelAlign}>
              취소
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="rounded-full shadow-lg" onClick={startAlign}>
            지표별 맞추기
          </Button>
        )}
      </div>
    </div>
  );
}

type Sky = {
  stars: { at: HorizontalCoords; size: number }[];
  lines: { id: string; a: HorizontalCoords; b: HorizontalCoords }[];
  labels: { id: string; name: string; at: HorizontalCoords }[];
  asterisms: { name: string; stars: { name: string; at: HorizontalCoords }[] }[];
};

type Frame = {
  matrix: Matrix3;
  params: ScreenProjection;
  horizon: Point[][];
  segments: ChartSegment[];
  stars: (Point & { size: number; hidden: boolean })[];
  labels: (Point & { id: string; name: string; hidden: boolean })[];
  compass: (Point & { label: string })[];
  // 그릴 지표별(지평선 위의 꼭짓점만). null 이면 그리지 않는다.
  asterisms: { name: string; stars: ((Point & { name: string }) | null)[] }[] | null;
  // 맞추기에 쓸 수 있는 지표별: 지평선 위이면서 화면 안에 꼭짓점이 두 개 이상 보이는 도형.
  alignTargets: AlignmentTarget[];
};

// 한 프레임에 그릴 것을 화면 좌표로 계산한다. 그리는 일(paintFrame)과 나눠, 캔버스 없이도 고르기·맞추기에 쓴다.
function computeFrame(
  sky: Sky,
  matrix: Matrix3,
  params: ScreenProjection,
  selectedId: string | null,
  withAsterisms: boolean
): Frame {
  // 화면에서 너무 먼 점은 버린다(카메라 옆으로 거의 90° 돌아간 점은 좌표가 끝없이 커진다).
  const limit = 4 * Math.max(params.width, params.height);
  const project = (at: HorizontalCoords): Point | null => {
    const p = projectToScreen(at, matrix, params);
    return p && Math.abs(p.x - params.width / 2) < limit && Math.abs(p.y - params.height / 2) < limit ? p : null;
  };
  const onScreen = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= params.width && p.y <= params.height;

  // 지평선: 방위를 따라 이은 선. 화면 밖으로 크게 나가면 끊는다.
  const horizon: Point[][] = [];
  let run: Point[] = [];
  for (let az = 0; az <= 360; az += 2) {
    const p = project({ alt: 0, az });
    if (p) run.push(p);
    else {
      if (run.length >= 2) horizon.push(run);
      run = [];
    }
  }
  if (run.length >= 2) horizon.push(run);

  const allSegments: ChartSegment[] = [];
  for (const { id, a, b } of sky.lines) {
    const pa = project(a);
    const pb = project(b);
    if (pa && pb) allSegments.push({ id, a: pa, b: pb, hidden: a.alt <= 0 || b.alt <= 0 });
  }
  const extents = constellationExtents(allSegments);
  const visible = (id: string) => id === selectedId || isLargeEnough(extents.get(id) ?? 0, 1, MIN_CONSTELLATION_PX);

  const stars = sky.stars.flatMap(({ at, size }) => {
    const p = project(at);
    return p ? [{ ...p, size, hidden: at.alt <= 0 }] : [];
  });
  const labels = sky.labels.flatMap(({ id, name, at }) => {
    if (!visible(id)) return [];
    const p = project(at);
    return p ? [{ ...p, id, name, hidden: at.alt <= 0 }] : [];
  });
  const compass = (["N", "E", "S", "W"] as const).flatMap((label, i) => {
    const p = project({ alt: COMPASS_LABEL_ALT, az: i * 90 });
    return p ? [{ ...p, label }] : [];
  });

  const alignTargets: AlignmentTarget[] = [];
  const asterisms = sky.asterisms.map(({ name, stars: vertices }) => {
    const points = vertices.map((star) => {
      if (star.at.alt <= 0) return null;
      const p = project(star.at);
      return p ? { ...p, name: star.name, at: star.at } : null;
    });
    const shown = points.filter((p): p is NonNullable<typeof p> => p !== null && onScreen(p));
    if (shown.length >= 2) alignTargets.push({ name, stars: shown });
    return { name, stars: points };
  });

  return {
    matrix,
    params,
    horizon,
    segments: allSegments.filter(({ id }) => visible(id)),
    stars,
    labels,
    compass,
    asterisms: withAsterisms ? asterisms : null,
    alignTargets,
  };
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  selectedId: string | null,
  aligning: boolean,
  style: OverlayStyle
) {
  // 맞추기 중에는 지표별이 눈에 띄도록 별자리 선과 이름을 흐리게 그린다.
  const dim = aligning ? 0.4 : 1;

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(203, 213, 225, 0.85)";
  ctx.beginPath();
  for (const run of frame.horizon) {
    ctx.moveTo(run[0].x, run[0].y);
    for (const p of run.slice(1)) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.lineCap = "round";
  for (const hidden of [true, false]) {
    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = `rgba(147, 197, 253, ${style.lineAlpha * dim * (hidden ? HIDDEN_SKY_OPACITY : 1)})`;
    ctx.beginPath();
    for (const { id, a, b, hidden: isHidden } of frame.segments) {
      if (id === selectedId || Boolean(isHidden) !== hidden) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = style.lineWidth + 1.5;
  ctx.beginPath();
  for (const { id, a, b } of frame.segments) {
    if (id !== selectedId) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  for (const { x, y, size, hidden } of frame.stars) {
    const radius = size * style.starScale;
    // 밝은 영상에서는 별 둘레에 어두운 테두리를 둘러 배경과 떼어 낸다.
    if (style.starOutline > 0) {
      ctx.lineWidth = style.starOutline;
      ctx.strokeStyle = "rgba(2, 6, 23, 0.75)";
      ctx.beginPath();
      ctx.arc(x, y, radius + style.starOutline / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(248, 250, 252, ${hidden ? HIDDEN_SKY_OPACITY : 1})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 글씨는 카메라 영상 위에서도 읽히도록 어두운 그림자를 둔다.
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = style.shadowBlur;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${style.labelBold ? "bold " : ""}13px sans-serif`;
  for (const { id, name, x, y, hidden } of frame.labels) {
    ctx.fillStyle =
      id === selectedId
        ? "#fbbf24"
        : `rgba(226, 232, 240, ${style.labelAlpha * dim * (hidden ? HIDDEN_SKY_OPACITY : 1)})`;
    ctx.fillText(name, x, y);
  }

  if (frame.asterisms) paintAsterisms(ctx, frame.asterisms, aligning);

  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#e2e8f0";
  for (const { label, x, y } of frame.compass) ctx.fillText(label, x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

// 지표별 도형: 하늘지도와 같이 지평선 위의 꼭짓점과 그 사이의 변만, 같은 색·점선으로 그린다.
// 맞추기 중에는 더 굵고 밝게 그린다.
function paintAsterisms(ctx: CanvasRenderingContext2D, asterisms: NonNullable<Frame["asterisms"]>, emphasize: boolean) {
  ctx.strokeStyle = emphasize ? "#99f6e4" : "#5eead4";
  ctx.fillStyle = emphasize ? "#99f6e4" : "#5eead4";
  for (const { name, stars } of asterisms) {
    ctx.lineWidth = emphasize ? 3.5 : 2.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    stars.forEach((a, i) => {
      const b = stars[(i + 1) % stars.length];
      if (!a || !b) return;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "bold 12px sans-serif";
    ctx.lineWidth = 2;
    const shown = stars.filter((p) => p !== null);
    for (const p of shown) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, emphasize ? 9 : 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(p.name, p.x, p.y + 18);
    }
    if (shown.length === 0) continue;
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(
      name,
      shown.reduce((sum, p) => sum + p.x, 0) / shown.length,
      shown.reduce((sum, p) => sum + p.y, 0) / shown.length
    );
  }
}

// 맞추기 기준으로 삼을 지표별: 화면에 꼭짓점이 가장 많이 보이고, 같으면 화면 가운데에 가까운 도형.
function mostVisibleTarget(targets: AlignmentTarget[], box: { width: number; height: number }) {
  const centerDistance = ({ stars }: AlignmentTarget) => {
    const x = stars.reduce((s, p) => s + p.x, 0) / stars.length;
    const y = stars.reduce((s, p) => s + p.y, 0) / stars.length;
    return Math.hypot(x - box.width / 2, y - box.height / 2);
  };
  return [...targets].sort((a, b) => b.stars.length - a.stars.length || centerDistance(a) - centerDistance(b))[0] ?? null;
}

// 지금 카메라 영상 한 장의 밝기를 줄인 크기로 읽고, 그 좌표를 화면 좌표로 바꾸는 방법을 함께 돌려준다.
function captureLuminance(video: HTMLVideoElement, box: { width: number; height: number }) {
  const { videoWidth: vw, videoHeight: vh } = video;
  if (vw <= 0 || vh <= 0) return null;
  const k = Math.min(1, CAPTURE_LONG_SIDE / Math.max(vw, vh));
  const width = Math.round(vw * k);
  const height = Math.round(vh * k);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const luminance = new Uint8ClampedArray(width * height);
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  // 영상은 화면을 덮도록(비율 유지, 넘치는 쪽은 잘라) 그려져 있다.
  const scale = Math.max(box.width / vw, box.height / vh);
  const offsetX = (box.width - vw * scale) / 2;
  const offsetY = (box.height - vh * scale) / 2;
  const toScreen = ({ x, y }: Point): Point => ({ x: (x / k) * scale + offsetX, y: (y / k) * scale + offsetY });
  return { luminance, width, height, toScreen };
}

// 자동 맞추기: 영상 속 밝은 점에서 지표별을 찾아, 겹치도록 하는 보정을 구한다. 못 찾으면 null.
function findAlignment(
  video: HTMLVideoElement | null,
  frame: Frame | null,
  matrix: Matrix3 | null,
  correction: ArCorrection,
  box: { width: number; height: number }
): { name: string; correction: ArCorrection } | null {
  if (!video || !frame || !matrix || frame.alignTargets.length === 0) return null;
  const capture = captureLuminance(video, box);
  if (!capture) return null;
  const spots = findBrightSpots(capture.luminance, capture.width, capture.height).map(capture.toScreen);
  const match = matchAsterism(frame.alignTargets, spots, SEARCH_RADIUS_RATIO * Math.min(box.width, box.height));
  if (!match) return null;

  const { focalPx, ...rest } = frame.params;
  const result = solveAlignment(
    (c) => match.pairs.map(({ star }) => projectToScreen(star.at, matrix, { ...rest, focalPx, ...c })),
    match.pairs.map(({ spot }) => spot),
    correction,
    { focalPx, viewAltDeg: viewAltitude(matrix) }
  );
  const { scale } = result.correction;
  if (result.maxResidualPx > MATCH_TOLERANCE_PX || scale < MIN_SCALE || scale > MAX_SCALE) return null;
  return {
    name: match.name,
    correction: { ...result.correction, azimuthOffset: normalizeOffset(result.correction.azimuthOffset) },
  };
}

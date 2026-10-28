"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { useRearCamera, type CameraState } from "@/features/starmap/ar-camera";
import { useDeviceRotation } from "@/features/starmap/ar-orientation";
import {
  calibrationStep,
  focalLengthPx,
  projectToScreen,
  viewAltitude,
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
  // 나침반 오차를 맞추는 방위 보정(도). AR 화면을 닫았다 열어도 유지되도록 밖에서 들고 있는다.
  azimuthOffset: number;
  onAzimuthOffsetChange: Dispatch<SetStateAction<number>>;
  onClose: () => void;
  // 카메라 권한을 거부했거나 카메라를 켤 수 없을 때.
  onCameraUnavailable: (state: Extract<CameraState, "denied" | "failed">) => void;
};

// 보정값을 -180~180 으로 맞춘다.
function normalizeOffset(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
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
  azimuthOffset,
  onAzimuthOffsetChange,
  onClose,
  onCameraUnavailable,
}: ArViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRearCamera(videoRef);
  const { rotation, available } = useDeviceRotation();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const longFov = useMemo(() => cameraLongFov(), []);
  // 마지막으로 그린 별자리 선(누른 곳의 별자리를 찾을 때 쓴다).
  const drawnSegments = useRef<ChartSegment[]>([]);
  const drag = useRef<{ x: number; startX: number; startY: number; moved: boolean } | null>(null);

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

  // 하늘의 고도·방위는 시각(1분마다)과 위치가 바뀔 때만 다시 계산한다. 화면 좌표는 매 프레임 바꾼다.
  const sky = useMemo(() => {
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

  const projection = useRef<ScreenProjection | null>(null);

  // 센서 값이 들어오는 대로 매 프레임 다시 그린다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width === 0 || box.height === 0) return;
    const frame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
    const cancel = window.cancelAnimationFrame ?? window.clearTimeout;
    let handle = 0;

    const draw = () => {
      handle = frame(draw);
      const matrix = rotation.current;
      const video = videoRef.current;
      const params: ScreenProjection = {
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
        azimuthOffset,
      };
      projection.current = params;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== box.width * ratio || canvas.height !== box.height * ratio) {
        canvas.width = box.width * ratio;
        canvas.height = box.height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      if (!matrix) return;
      drawSky(ctx, sky, matrix, params, selectedId, showAsterisms, drawnSegments);
    };
    draw();
    return () => cancel(handle);
  }, [box, sky, rotation, longFov, azimuthOffset, selectedId, showAsterisms]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > DRAG_THRESHOLD) {
      current.moved = true;
    }
    if (!current.moved) return;
    // 좌우로 끄는 만큼 방위만 보정한다(기울기는 가속도 센서로 정확하다). 위아래 움직임은 무시한다.
    const dx = event.clientX - current.x;
    current.x = event.clientX;
    const params = projection.current;
    const matrix = rotation.current;
    if (!params || !matrix || dx === 0) return;
    const step = calibrationStep(dx, params.focalPx, viewAltitude(matrix));
    onAzimuthOffsetChange((offset) => normalizeOffset(offset + step));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const id = findConstellationAt(point, drawnSegments.current, HIT_DISTANCE);
    if (id) onSelect(id);
  }

  const shownOffset = Math.round(azimuthOffset);

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
      <canvas
        ref={canvasRef}
        aria-label="AR 별자리 겹쳐 보기"
        className="absolute inset-0 size-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (drag.current = null)}
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
      {popup && (
        <div className="absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">{popup}</div>
      )}
      {shownOffset !== 0 && (
        <div className="absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-center gap-2">
          <span className="rounded-full bg-slate-950/60 px-3 py-1.5 text-sm">
            보정 {shownOffset > 0 ? "+" : "−"}
            {Math.abs(shownOffset)}°
          </span>
          <Button variant="secondary" className="rounded-full shadow-lg" onClick={() => onAzimuthOffsetChange(0)}>
            보정 초기화
          </Button>
        </div>
      )}
    </div>
  );
}

type Sky = {
  stars: { at: HorizontalCoords; size: number }[];
  lines: { id: string; a: HorizontalCoords; b: HorizontalCoords }[];
  labels: { id: string; name: string; at: HorizontalCoords }[];
  asterisms: { name: string; stars: { name: string; at: HorizontalCoords }[] }[];
};

function drawSky(
  ctx: CanvasRenderingContext2D,
  sky: Sky,
  matrix: Matrix3,
  params: ScreenProjection,
  selectedId: string | null,
  showAsterisms: boolean,
  drawnSegments: { current: ChartSegment[] }
) {
  // 화면에서 너무 먼 점은 버린다(카메라 옆으로 거의 90° 돌아간 점은 좌표가 끝없이 커진다).
  const limit = 4 * Math.max(params.width, params.height);
  const project = (at: HorizontalCoords): Point | null => {
    const p = projectToScreen(at, matrix, params);
    return p && Math.abs(p.x - params.width / 2) < limit && Math.abs(p.y - params.height / 2) < limit ? p : null;
  };

  // 지평선: 방위를 따라 이은 선. 화면 밖으로 나가면 끊는다.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(203, 213, 225, 0.85)";
  ctx.beginPath();
  let drawing = false;
  for (let az = 0; az <= 360; az += 2) {
    const p = project({ alt: 0, az });
    if (!p) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    drawing = true;
  }
  ctx.stroke();

  const segments: ChartSegment[] = [];
  for (const { id, a, b } of sky.lines) {
    const pa = project(a);
    const pb = project(b);
    if (pa && pb) segments.push({ id, a: pa, b: pb, hidden: a.alt <= 0 || b.alt <= 0 });
  }
  const extents = constellationExtents(segments);
  const visible = (id: string) => id === selectedId || isLargeEnough(extents.get(id) ?? 0, 1, MIN_CONSTELLATION_PX);
  const shown = segments.filter(({ id }) => visible(id));
  drawnSegments.current = shown;

  ctx.lineCap = "round";
  for (const hidden of [true, false]) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(147, 197, 253, ${0.6 * (hidden ? HIDDEN_SKY_OPACITY : 1)})`;
    ctx.beginPath();
    for (const { id, a, b, hidden: isHidden } of shown) {
      if (id === selectedId || Boolean(isHidden) !== hidden) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const { id, a, b } of shown) {
    if (id !== selectedId) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  for (const { at, size } of sky.stars) {
    const p = project(at);
    if (!p) continue;
    ctx.fillStyle = `rgba(248, 250, 252, ${at.alt <= 0 ? HIDDEN_SKY_OPACITY : 1})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 글씨는 카메라 영상 위에서도 읽히도록 어두운 그림자를 둔다.
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 4;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "13px sans-serif";
  for (const { id, name, at } of sky.labels) {
    if (!visible(id)) continue;
    const p = project(at);
    if (!p) continue;
    ctx.fillStyle =
      id === selectedId ? "#fbbf24" : `rgba(226, 232, 240, ${0.9 * (at.alt <= 0 ? HIDDEN_SKY_OPACITY : 1)})`;
    ctx.fillText(name, p.x, p.y);
  }

  if (showAsterisms) drawAsterisms(ctx, sky.asterisms, project);

  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#e2e8f0";
  for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
    const p = project({ alt: COMPASS_LABEL_ALT, az });
    if (p) ctx.fillText(label, p.x, p.y);
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

// 지표별 도형: 하늘지도와 같이 지평선 위의 꼭짓점과 그 사이의 변만, 같은 색·점선으로 그린다.
function drawAsterisms(
  ctx: CanvasRenderingContext2D,
  asterisms: Sky["asterisms"],
  project: (at: HorizontalCoords) => Point | null
) {
  ctx.strokeStyle = "#5eead4";
  ctx.fillStyle = "#5eead4";
  for (const { name, stars } of asterisms) {
    const points = stars.map((star) => (star.at.alt > 0 ? project(star.at) : null));
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      if (!a || !b) return;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "bold 12px sans-serif";
    ctx.lineWidth = 2;
    const visible: Point[] = [];
    points.forEach((p, i) => {
      if (!p) return;
      visible.push(p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(stars[i].name, p.x, p.y + 16);
    });
    if (visible.length === 0) continue;
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(
      name,
      visible.reduce((sum, p) => sum + p.x, 0) / visible.length,
      visible.reduce((sum, p) => sum + p.y, 0) / visible.length
    );
  }
}

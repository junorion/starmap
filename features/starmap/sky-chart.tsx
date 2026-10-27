"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  canZoomIn,
  canZoomOut,
  clampZoom,
  fitZoom,
  isPanBlocked,
  panBy,
  screenToChart,
  zoomAround,
  zoomIn,
  zoomOut,
  type Viewport,
} from "@/features/starmap/chart-viewport";
import { ASTERISMS, projectAsterisms } from "@/features/starmap/asterisms";
import {
  IDENTITY_ORIENTATION,
  degreesPerPixel,
  orientationToCenter,
  rotateOrientation,
  viewCenter,
  type Orientation,
} from "@/features/starmap/sphere-orientation";
import type { StarmapData } from "@/features/starmap/starmap-data";
import {
  constellationExtents,
  compassLabelPoint,
  constellationStarKeys,
  findConstellationAt,
  horizontalCoords,
  isConstellationStar,
  isOnChart,
  projectAltitudeRing,
  isLargeEnough,
  projectConstellationLines,
  projectToChart,
  starSize,
  type SkyView,
} from "@/features/starmap/sky-math";

const HIT_DISTANCE = 20;
// 이보다 작게 보이는 별자리는 선과 이름을 숨기고, 확대해서 이 크기 이상이 되면 보여준다.
const MIN_CONSTELLATION_PX = 60;
const DRAG_THRESHOLD = 4;
// 휠 한 눈금(deltaY 100)이 약 1.16배. 트랙패드 핀치(Ctrl+휠)는 delta가 작아서 감도를 더 준다.
const WHEEL_SENSITIVITY = 0.0015;
const PINCH_WHEEL_SENSITIVITY = 0.01;
const WHEEL_LINE_PX = 16;
// 두 손가락이 이만큼(px) 움직이면 핀치와 회전 중 어느 쪽인지 정한다.
const PINCH_LOCK_PX = 12;
// 지평선 아래(가려진) 하늘의 별·별자리 선·이름은 지평선 위보다 이 비율만큼의 불투명도로 그려
// 살짝 어둡게 보이게 하고, 명암으로 두 하늘을 구분한다.
const HIDDEN_SKY_OPACITY = 0.7;
const MARGIN = 28;

// 밖에서 차트에 시킬 수 있는 일.
export type SkyChartHandle = {
  // 그 별자리가 화면 가운데에 오도록 하늘을 돌리고, 화면 폭의 약 60%로 보이게 배율을 맞춘다.
  focusOn: (constellationId: string) => void;
};

// 찾은 별자리가 차지하게 할 화면 폭의 비율.
const FOCUS_WIDTH_RATIO = 0.6;

type SkyChartProps = {
  chartRef?: React.Ref<SkyChartHandle>;
  data: StarmapData;
  latDeg: number;
  lstDeg: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  // 켜면 지표별 도형(계절별 대삼각형 등)을 지도에 겹쳐 그린다.
  showAsterisms?: boolean;
  // 끄면 별자리 선의 꼭짓점이 아닌 별(별자리에 속하지 않은 별)은 그리지 않는다.
  showOtherStars?: boolean;
  // 지도 화면 맨 위에 지도와 겹치지 않게 놓는 정보 줄.
  header?: React.ReactNode;
  // 지도 화면 안 아래쪽에 떠 있는 팝업창.
  popup?: React.ReactNode;
  // 지도 화면 오른쪽 아래에 놓는 메뉴 버튼.
  menu?: React.ReactNode;
  // 지도 화면 가운데에 띄우는 창(옵션 창 등).
  dialog?: React.ReactNode;
  // 켜면 한 손가락(왼쪽 버튼) 드래그가 지도 이동 대신 하늘 돌리기가 된다.
  rotateMode?: boolean;
  // 지도를 끌었는데 이동 한계에 닿았거나 1배라서 더 움직이지 않을 때 부른다.
  onPanBlocked?: () => void;
  // "현재 위치로" 버튼을 누르면 지도 모습을 되돌린 뒤 부른다(위치 다시 받기 등).
  onRecenter?: () => void;
};

export function SkyChart({
  chartRef,
  data,
  latDeg,
  lstDeg,
  selectedId,
  onSelect,
  showAsterisms = false,
  showOtherStars = true,
  rotateMode = false,
  onPanBlocked,
  header,
  popup,
  menu,
  dialog,
  onRecenter,
}: SkyChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // 사용자가 확대·축소·이동하기 전에는 화면 크기에 맞춘 초기 배율을 쓴다.
  const [userViewport, setUserViewport] = useState<Viewport | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // 두 손가락 동작: 시작 때보다 PINCH_LOCK_PX 이상 달라지면 핀치와 회전 중 하나로 정하고 손을 뗄 때까지 유지한다.
  const pinch = useRef<{
    distance: number;
    mid: { x: number; y: number };
    start: { distance: number; mid: { x: number; y: number } };
    mode: "pinch" | "rotate" | null;
  } | null>(null);
  // 마우스 오른쪽 버튼으로 끌어 회전하는 중인 포인터와 마지막 x 좌표.
  const rotateDrag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  // 하늘을 지구본처럼 돌려 정한 보는 방향. 처음에는 천정이 가운데, 북쪽이 위다.
  const [orientation, setOrientation] = useState<Orientation>(IDENTITY_ORIENTATION);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      })
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // 하늘 원은 화면의 짧은 변에 맞춰 한가운데에 놓는다.
  const radius = Math.min(box.width, box.height) / 2 - MARGIN;

  const initialViewport = useMemo<Viewport>(
    () => ({ zoom: fitZoom(box.width, box.height, MARGIN), panX: 0, panY: 0 }),
    [box.width, box.height]
  );
  const viewport = userViewport ?? initialViewport;

  function updateViewport(change: (view: Viewport) => Viewport) {
    setUserViewport((current) => change(current ?? initialViewport));
  }

  // 캔버스 중심을 원점으로 하는 화면 좌표.
  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return {
        x: clientX - (rect?.left ?? 0) - box.width / 2,
        y: clientY - (rect?.top ?? 0) - box.height / 2,
      };
    },
    [box.width, box.height]
  );

  // 마우스 휠(트랙패드 스크롤 포함): 지도 위에서는 페이지가 스크롤되지 않고 포인터 지점을 기준으로 확대·축소한다.
  // preventDefault가 필요해서 passive가 아닌 리스너를 직접 단다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? WHEEL_LINE_PX : 1);
      const factor = Math.exp(-delta * (event.ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY));
      const anchor = toCanvasPoint(event.clientX, event.clientY);
      setUserViewport((current) => zoomAround(current ?? initialViewport, factor, anchor, radius));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [initialViewport, radius, toCanvasPoint]);

  const constellationStars = useMemo(() => constellationStarKeys(data.lines), [data.lines]);

  const scene = useMemo(() => {
    const view: SkyView = { lstDeg, latDeg, radius, orientation };
    const stars = data.stars.flatMap(({ geometry, properties }) => {
      const [ra, dec] = geometry.coordinates;
      if (!showOtherStars && !isConstellationStar(geometry.coordinates, constellationStars)) {
        return [];
      }
      const horizontal = horizontalCoords({ ra, dec }, view);
      const point = projectToChart(horizontal, radius, orientation);
      if (!isOnChart(point, radius)) return [];
      return [{ ...point, size: starSize(properties.mag), hidden: horizontal.alt <= 0 }];
    });
    // 별자리 이름은 지평선 아래 하늘의 별자리도 똑같이 쓴다.
    const labels = data.constellations.flatMap(({ id, properties, geometry }) => {
      const [ra, dec] = geometry.coordinates;
      const horizontal = horizontalCoords({ ra, dec }, view);
      const point = projectToChart(horizontal, radius, orientation);
      return isOnChart(point, radius)
        ? [{ id, name: properties.ko, ...point, hidden: horizontal.alt <= 0 }]
        : [];
    });
    return {
      stars,
      labels,
      segments: projectConstellationLines(data.lines, view),
      asterisms: showAsterisms ? projectAsterisms(ASTERISMS, view) : null,
      // 지평선(고도 0°)과 고도 30°·60° 고리. 하늘을 돌리면 휘어진 선이 된다.
      horizon: projectAltitudeRing(0, radius, orientation),
      rings: [30, 60].flatMap((alt) => projectAltitudeRing(alt, radius, orientation)),
    };
  }, [
    data,
    latDeg,
    lstDeg,
    radius,
    orientation,
    showAsterisms,
    showOtherStars,
    constellationStars,
  ]);

  // 지금 배율에서 화면에 충분히 크게 보이는 별자리(와 선택한 별자리)의 선과 이름만 그린다.
  const extents = useMemo(() => constellationExtents(scene.segments), [scene.segments]);
  const shown = useMemo(() => {
    const visible = (id: string) =>
      id === selectedId || isLargeEnough(extents.get(id) ?? 0, viewport.zoom, MIN_CONSTELLATION_PX);
    return {
      segments: scene.segments.filter(({ id }) => visible(id)),
      labels: scene.labels.filter(({ id }) => visible(id)),
    };
  }, [scene, extents, selectedId, viewport.zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width === 0 || box.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, box.width, box.height);
    ctx.translate(box.width / 2 + viewport.panX, box.height / 2 + viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);
    // 확대해도 선 굵기, 별 크기, 글자 크기는 화면 기준으로 유지한다.
    const px = 1 / viewport.zoom;

    const strokeRuns = (runs: { x: number; y: number }[][]) => {
      ctx.beginPath();
      for (const run of runs) {
        ctx.moveTo(run[0].x, run[0].y);
        for (const point of run.slice(1)) ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    };

    ctx.lineWidth = px;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
    strokeRuns(scene.rings);
    // 지평선은 고도 고리보다 굵고 선명하게 그려 하늘의 위·아래를 쉽게 구분하게 한다.
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = "rgba(203, 213, 225, 0.85)";
    strokeRuns(scene.horizon);
    ctx.lineWidth = px;

    ctx.lineCap = "round";
    ctx.lineWidth = px;
    for (const hidden of [true, false]) {
      ctx.strokeStyle = `rgba(147, 197, 253, ${0.4 * (hidden ? HIDDEN_SKY_OPACITY : 1)})`;
      ctx.beginPath();
      for (const { id, a, b, hidden: isHidden } of shown.segments) {
        if (id === selectedId || Boolean(isHidden) !== hidden) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    for (const { id, a, b } of shown.segments) {
      if (id !== selectedId) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    for (const hidden of [true, false]) {
      ctx.fillStyle = `rgba(248, 250, 252, ${hidden ? HIDDEN_SKY_OPACITY : 1})`;
      for (const { x, y, size: starRadius, hidden: isHidden } of scene.stars) {
        if (isHidden !== hidden) continue;
        ctx.beginPath();
        ctx.arc(x, y, starRadius * px, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.font = `${12 * px}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const { id, name, x, y, hidden } of shown.labels) {
      ctx.fillStyle =
        id === selectedId
          ? "#fbbf24"
          : `rgba(226, 232, 240, ${0.75 * (hidden ? HIDDEN_SKY_OPACITY : 1)})`;
      ctx.fillText(name, x, y);
    }

    if (scene.asterisms) {
      const { edges, stars, labels } = scene.asterisms;
      // 별자리 선보다 눈에 띄도록 굵고 밝게 그리고, 글씨에는 어두운 그림자를 둔다.
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([8 * px, 4 * px]);
      ctx.beginPath();
      for (const { a, b } of edges) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.lineWidth = 2 * px;
      ctx.fillStyle = "#5eead4";
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 4;
      ctx.font = `bold ${12 * px}px sans-serif`;
      for (const { name, x, y } of stars) {
        ctx.beginPath();
        ctx.arc(x, y, 6 * px, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(name, x, y + 16 * px);
      }
      ctx.font = `bold ${14 * px}px sans-serif`;
      for (const { name, x, y } of labels) ctx.fillText(name, x, y);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }

    ctx.font = `bold ${14 * px}px sans-serif`;
    ctx.fillStyle = "#94a3b8";
    // 방위 글씨는 언제나 지평선의 바깥쪽(가려진 하늘 쪽)에 놓아, 글씨 위치로 어느 쪽이 지금 보이는 하늘이고
    // 어느 쪽이 가려진 하늘인지 구분하게 한다. 하늘과 함께 움직이지만 글씨는 돌지 않는다.
    for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
      const point = compassLabelPoint(az, radius, orientation, 16 * px);
      if (point) ctx.fillText(label, point.x, point.y);
    }
  }, [scene, shown, selectedId, box, radius, viewport, orientation]);

  // 찾기: 별자리를 화면 가운데로 가져오고(지평선 아래여도 된다), 보이기 좋은 배율로 맞춘다.
  useImperativeHandle(
    chartRef,
    () => ({
      focusOn(constellationId: string) {
        const constellation = data.constellations.find((c) => c.id === constellationId);
        if (!constellation) return;

        const [ra, dec] = constellation.geometry.coordinates;
        const target = horizontalCoords({ ra, dec }, { lstDeg, latDeg });
        const nextOrientation = orientationToCenter(target);
        setOrientation(nextOrientation);

        const segments = projectConstellationLines(
          data.lines.filter((line) => line.id === constellationId),
          { lstDeg, latDeg, radius, orientation: nextOrientation }
        );
        const extent = constellationExtents(segments).get(constellationId);
        const zoom = extent ? clampZoom((FOCUS_WIDTH_RATIO * box.width) / extent) : viewport.zoom;
        setUserViewport({ zoom, panX: 0, panY: 0 });
      },
    }),
    [data, lstDeg, latDeg, radius, box.width, viewport.zoom]
  );

  // 하늘 돌리기 속도: 확대 배율에 맞춰, 화면 가운데 근처의 별이 포인터와 같은 속도로 따라오게 한다.
  const rotationRate = degreesPerPixel(radius, viewport.zoom);

  // 지금 두 손가락의 모습을 시작 상태로 삼아 새 두 손가락 동작을 시작한다.
  function newPinch() {
    const now = measurePinch();
    return { ...now, start: now, mode: null };
  }

  // 눌려 있는 손가락(포인터) 가운데 앞의 두 개로 핀치를 잰다.
  function measurePinch() {
    const [a, b] = [...pointers.current.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 캡처할 수 없는 포인터(합성 이벤트 등)는 캡처 없이 계속한다.
    }
    // 마우스 오른쪽 버튼은 이동이 아니라 회전이다.
    if (event.button === 2) {
      rotateDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      // 두 번째 손가락이 닿으면 이동이 아니라 핀치/회전으로 보고, 끝나도 별자리를 선택하지 않는다.
      suppressClick.current = true;
      drag.current = null;
      pinch.current = newPinch();
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY };
    suppressClick.current = false;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const rotating = rotateDrag.current;
    if (rotating && rotating.pointerId === event.pointerId) {
      const dx = event.clientX - rotating.x;
      const dy = event.clientY - rotating.y;
      rotateDrag.current = { ...rotating, x: event.clientX, y: event.clientY };
      setOrientation((current) => rotateOrientation(current, dx, dy, rotationRate));
      return;
    }

    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pointers.current.size >= 2) {
      const previous = pinch.current;
      const current = measurePinch();
      if (!previous) {
        pinch.current = newPinch();
        return;
      }
      const midDx = current.mid.x - previous.mid.x;
      const midDy = current.mid.y - previous.mid.y;
      // 시작 때보다 사이 간격이 달라진 양이 가운데 지점이 움직인 양보다 크면 핀치, 아니면 회전으로 정한다.
      // 손가락마다 이동 이벤트가 따로 들어와 한 순간의 간격은 흔들리므로, 누적이 아니라 시작 대비 순변화로 잰다.
      const netDistance = Math.abs(current.distance - previous.start.distance);
      const netMid = Math.hypot(
        current.mid.x - previous.start.mid.x,
        current.mid.y - previous.start.mid.y
      );
      let mode = previous.mode;
      if (!mode && Math.max(netDistance, netMid) >= PINCH_LOCK_PX) {
        mode = netDistance > netMid ? "pinch" : "rotate";
      }
      pinch.current = { ...current, start: previous.start, mode };

      if (mode === "pinch" && previous.distance > 0) {
        const factor = current.distance / previous.distance;
        const anchor = toCanvasPoint(previous.mid.x, previous.mid.y);
        updateViewport((view) => zoomAround(view, factor, anchor, radius));
      } else if (mode === "rotate") {
        setOrientation((current) => rotateOrientation(current, midDx, midDy, rotationRate));
      }
      return;
    }

    const last = drag.current;
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    // 작은 흔들림은 클릭으로 남겨 두고, 문턱을 넘으면 그 순간부터 이동으로 본다.
    if (!suppressClick.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    suppressClick.current = true;
    drag.current = { x: event.clientX, y: event.clientY };
    if (rotateMode) {
      setOrientation((current) => rotateOrientation(current, dx, dy, rotationRate));
      return;
    }
    if (isPanBlocked(viewport, panBy(viewport, dx, dy, radius), dx, dy)) onPanBlocked?.();
    updateViewport((view) => panBy(view, dx, dy, radius));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (rotateDrag.current?.pointerId === event.pointerId) {
      rotateDrag.current = null;
      return;
    }
    pointers.current.delete(event.pointerId);
    pinch.current =
      pointers.current.size >= 2
        ? newPinch()
        : null;

    // 핀치 뒤 남은 한 손가락은 그 자리에서 이어서 끌 수 있게 하되, 클릭으로 보지 않는다.
    const [remaining] = [...pointers.current.values()];
    if (remaining) {
      drag.current = { x: remaining.x, y: remaining.y };
      suppressClick.current = true;
    } else {
      drag.current = null;
    }
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToChart(
      {
        x: event.clientX - rect.left - box.width / 2,
        y: event.clientY - rect.top - box.height / 2,
      },
      viewport
    );
    const id = findConstellationAt(point, shown.segments, HIT_DISTANCE / viewport.zoom);
    if (id) onSelect(id);
  }

  return (
    // 휴대폰(640px 미만)에서는 휴대폰 모양 틀 대신 기기 화면 전체를 채운다.
    <div className="relative mx-auto flex aspect-[9/19.5] w-full max-w-[390px] flex-col overflow-hidden rounded-xl bg-[#0b1020] max-sm:aspect-auto max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none">
      {header}
      <div ref={wrapperRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="size-full cursor-grab touch-none active:cursor-grabbing"
          aria-label="현재 하늘의 별자리 지도"
          data-view-alt={Math.round(viewCenter(orientation).alt)}
          data-view-az={Math.round(viewCenter(orientation).az) % 360}
          onClick={handleClick}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
        <div className="absolute top-2 right-2 flex flex-col gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="확대"
            disabled={!canZoomIn(viewport)}
            onClick={() => updateViewport((view) => zoomIn(view, radius))}
          >
            <PlusIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="현재 위치로"
            className="rounded-full"
            onClick={() => {
              setUserViewport(null);
              setOrientation(IDENTITY_ORIENTATION);
              onRecenter?.();
            }}
          >
            <LocateFixedIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="축소"
            disabled={!canZoomOut(viewport)}
            onClick={() => updateViewport((view) => zoomOut(view, radius))}
          >
            <MinusIcon />
          </Button>
        </div>
      </div>
      {/* 팝업은 오른쪽 아래 메뉴 버튼(높이 40px + 여백 12px)과 겹치지 않게 그 위에 둔다.
          둘 다 기기의 내비게이션 바 영역(safe-area)만큼 더 올린다. */}
      {popup && (
        <div className="absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">{popup}</div>
      )}
      {menu && <div className="absolute right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))]">{menu}</div>}
      {dialog && (
        <div className="absolute inset-x-3 top-1/2 -translate-y-1/2">{dialog}</div>
      )}
    </div>
  );
}

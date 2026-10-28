"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Astronomy from "astronomy-engine";
import { CameraIcon, MapPinIcon, Rotate3dIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ArNotice, type ArNoticeReason } from "@/features/starmap/ar-notice";
import type { CameraState } from "@/features/starmap/ar-camera";
import { ArView } from "@/features/starmap/ar-view";
import { ConstellationPopup } from "@/features/starmap/constellation-popup";
import { formatCoordinates } from "@/features/starmap/format-location";
import { OptionsPanel } from "@/features/starmap/options-panel";
import { RotateHint } from "@/features/starmap/rotate-hint";
import { SearchPanel } from "@/features/starmap/search-panel";
import { SkyChart, type SkyChartHandle } from "@/features/starmap/sky-chart";
import { isAndroidApp } from "@/features/starmap/native-app";
import { loadStarmapData, type StarmapData } from "@/features/starmap/starmap-data";

const SEOUL = { latDeg: 37.5665, lonDeg: 126.978 };
const REFRESH_MS = 60_000;
const GEOLOCATION_TIMEOUT_MS = 10_000;

type Observer = { latDeg: number; lonDeg: number; isFallback: boolean };
type AndroidBackWindow = Window & { onAndroidBack?: () => boolean };

// "더 이상 안내하지 않기"를 체크하면 이 브라우저에 기억한다. 저장소를 쓸 수 없으면 기억하지 않는다.
const HINT_DISMISSED_KEY = "starmap:rotate-hint-dismissed";

function readHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHintDismissed() {
  try {
    window.localStorage.setItem(HINT_DISMISSED_KEY, "1");
  } catch {
    // 저장할 수 없으면 이번 방문에서만 지킨다.
  }
}

function lstDegrees(date: Date, lonDeg: number): number {
  return (((Astronomy.SiderealTime(date) * 15 + lonDeg) % 360) + 360) % 360;
}

// 브라우저 위치를 받아 알린다. 받지 못하면 서울을 알린다.
function locate(onLocated: (observer: Observer) => void) {
  const fallback = () => onLocated({ ...SEOUL, isFallback: true });
  if (!navigator.geolocation) {
    queueMicrotask(fallback);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) =>
      onLocated({ latDeg: coords.latitude, lonDeg: coords.longitude, isFallback: false }),
    fallback,
    { timeout: GEOLOCATION_TIMEOUT_MS }
  );
}

// 처음 한 번 위치를 받고, relocate()로 다시 받을 수 있다. 다시 받는 동안에는 이전 위치를 그대로 쓴다.
function useObserver(): { observer: Observer | null; relocate: () => void } {
  const [observer, setObserver] = useState<Observer | null>(null);

  useEffect(() => locate(setObserver), []);

  const relocate = useCallback(() => locate(setObserver), []);

  return { observer, relocate };
}

function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    queueMicrotask(tick);
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}

function useStarmapData(): { data: StarmapData | null; failed: boolean } {
  const [state, setState] = useState<{ data: StarmapData | null; failed: boolean }>({
    data: null,
    failed: false,
  });

  useEffect(() => {
    loadStarmapData().then(
      (data) => setState({ data, failed: false }),
      () => setState({ data: null, failed: true })
    );
  }, []);

  return state;
}

export function Starmap() {
  const { observer, relocate } = useObserver();
  const now = useNow();
  const { data, failed } = useStarmapData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAsterisms, setShowAsterisms] = useState(false);
  const [showOtherStars, setShowOtherStars] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const closeOptions = useCallback(() => setOptionsOpen(false), []);
  // 돌리기 모드: 켜면 한 손가락(왼쪽 버튼) 드래그가 지도 이동 대신 하늘 돌리기가 된다.
  const [rotateMode, setRotateMode] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // AR 모드 안내 창(브라우저 안내, 카메라 권한 거부 등). null 이면 닫혀 있다.
  const [arNotice, setArNotice] = useState<ArNoticeReason | null>(null);
  const arNoticeOpen = arNotice !== null;
  const closeArNotice = useCallback(() => setArNotice(null), []);
  // AR 화면(앱에서만). 방위 보정은 AR 화면을 닫았다 열어도 앱을 끄기 전까지 유지한다.
  const [arOpen, setArOpen] = useState(false);
  const [arAzimuthOffset, setArAzimuthOffset] = useState(0);
  const closeAr = useCallback(() => setArOpen(false), []);
  const handleCameraUnavailable = useCallback((state: Extract<CameraState, "denied" | "failed">) => {
    setArOpen(false);
    setArNotice(state === "denied" ? "camera-denied" : "camera-failed");
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const chartRef = useRef<SkyChartHandle>(null);
  // 안내 창은 한 방문에 한 번만 띄운다(닫은 뒤에는 새로고침하기 전까지 다시 뜨지 않는다).
  const hintShownThisVisit = useRef(false);

  // 지도를 끌었는데 더 움직이지 않을 때 호출된다.
  const handlePanBlocked = useCallback(() => {
    if (
      hintShownThisVisit.current ||
      rotateMode ||
      optionsOpen ||
      searchOpen ||
      arNoticeOpen ||
      readHintDismissed()
    ) {
      return;
    }
    hintShownThisVisit.current = true;
    setHintOpen(true);
  }, [rotateMode, optionsOpen, searchOpen, arNoticeOpen]);

  // 가운데 창은 한 번에 하나만 열린다. 새 창을 열면 열려 있던 창은 닫는다.
  const openOptions = () => {
    setSearchOpen(false);
    setHintOpen(false);
    setArNotice(null);
    setOptionsOpen(true);
  };
  const openSearch = () => {
    setOptionsOpen(false);
    setHintOpen(false);
    setArNotice(null);
    setSearchOpen(true);
  };
  const openArNotice = () => {
    setOptionsOpen(false);
    setSearchOpen(false);
    setHintOpen(false);
    setArNotice(null);
    // 앱에서는 AR 화면을 연다(카메라 권한은 그때 묻는다). 브라우저에서는 앱에서 쓸 수 있다고 안내만 한다.
    if (isAndroidApp()) setArOpen(true);
    else setArNotice("browser");
  };

  const closeHint = useCallback((dontShowAgain: boolean, enableRotateMode: boolean) => {
    if (dontShowAgain) writeHintDismissed();
    if (enableRotateMode) setRotateMode(true);
    setHintOpen(false);
  }, []);

  // 안드로이드 앱(android/)의 뒤로 가기 버튼이 먼저 묻는다. AR 화면에서는 별자리 팝업, AR 화면 순으로,
  // 지도에서는 가운데 창, 별자리 팝업 순으로 닫고 닫은 것이 있으면 true를 돌려준다. false면 앱이 닫힌다.
  const dialogOpen = optionsOpen || searchOpen || arNoticeOpen || hintOpen;
  useEffect(() => {
    const androidWindow = window as AndroidBackWindow;
    androidWindow.onAndroidBack = () => {
      if (arOpen) {
        if (selectedId) setSelectedId(null);
        else setArOpen(false);
        return true;
      }
      if (dialogOpen) {
        setOptionsOpen(false);
        setSearchOpen(false);
        setArNotice(null);
        setHintOpen(false);
        return true;
      }
      if (selectedId) {
        setSelectedId(null);
        return true;
      }
      return false;
    };
    return () => {
      delete androidWindow.onAndroidBack;
    };
  }, [arOpen, dialogOpen, selectedId]);

  const lstDeg = observer && now ? lstDegrees(now, observer.lonDeg) : null;

  // 선택한 별자리는 하늘을 돌리거나 지평선 아래로 내려가도 닫을 때까지 선택된 상태로 남는다.
  const selected = useMemo(
    () => (data && selectedId ? (data.constellations.find((c) => c.id === selectedId) ?? null) : null),
    [data, selectedId]
  );

  if (failed) {
    return <p className="text-sm text-destructive p-4">별 데이터를 불러오지 못했습니다. 새로고침해 주세요.</p>;
  }

  if (!observer || !now || !data || lstDeg === null) {
    return <p className="text-sm text-slate-300 p-4">하늘을 계산하는 중입니다…</p>;
  }

  // 위치·시각 줄과 별자리 팝업은 지금 보이는 화면(하늘지도 또는 AR 화면)에만 둔다.
  const header = (
    <div
      className="flex items-start justify-between gap-3 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-1 text-xs text-slate-100"
      data-testid="sky-status"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-medium">
          <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
          {observer.isFallback ? "서울 (위치를 확인하지 못해 기본값 사용)" : "현재 위치"}
        </span>
        <span className="text-slate-400">
          {formatCoordinates(observer.latDeg, observer.lonDeg)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 text-right">
        <span className="font-medium">
          {now.toLocaleTimeString("ko-KR", { timeStyle: "short" })}
        </span>
        <span className="text-slate-400">
          {now.toLocaleDateString("ko-KR", { dateStyle: "medium" })}
        </span>
      </div>
    </div>
  );
  const popup = (
    selected ? (
      <ConstellationPopup
        constellation={selected}
        lines={data.lines
          .filter((line) => line.id === selected.id)
          .flatMap((line) => line.geometry.coordinates)}
        description={data.descriptions[selected.id]}
        onClose={() => setSelectedId(null)}
      />
    ) : null
  );

  return (
    <>
      <SkyChart
        data={data}
        latDeg={observer.latDeg}
        lstDeg={lstDeg}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showAsterisms={showAsterisms}
        showOtherStars={showOtherStars}
        chartRef={chartRef}
        rotateMode={rotateMode}
        onPanBlocked={handlePanBlocked}
        onRecenter={relocate}
        header={arOpen ? null : header}
        menu={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label="AR 모드"
              className="rounded-full shadow-lg"
              onClick={openArNotice}
            >
              <CameraIcon />
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label="찾기"
              className="rounded-full shadow-lg"
              onClick={openSearch}
            >
              <SearchIcon />
            </Button>
            <Button
              variant={rotateMode ? "default" : "secondary"}
              size="icon-lg"
              aria-label="돌리기 모드"
              aria-pressed={rotateMode}
              className="rounded-full shadow-lg"
              onClick={() => setRotateMode((on) => !on)}
            >
              <Rotate3dIcon />
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label="옵션"
              className="rounded-full shadow-lg"
              onClick={openOptions}
            >
              <SlidersHorizontalIcon />
            </Button>
          </div>
        }
        dialog={
          optionsOpen ? (
            <OptionsPanel
              showAsterisms={showAsterisms}
              onShowAsterismsChange={setShowAsterisms}
              showOtherStars={showOtherStars}
              onShowOtherStarsChange={setShowOtherStars}
              onClose={closeOptions}
            />
          ) : arNotice ? (
            <ArNotice reason={arNotice} onClose={closeArNotice} />
          ) : searchOpen ? (
            <SearchPanel
              constellations={data.constellations}
              onPick={(id) => {
                chartRef.current?.focusOn(id);
                setSelectedId(id);
                setSearchOpen(false);
              }}
              onClose={closeSearch}
            />
          ) : hintOpen ? (
            <RotateHint
              onEnable={(dontShowAgain) => closeHint(dontShowAgain, true)}
              onClose={(dontShowAgain) => closeHint(dontShowAgain, false)}
            />
          ) : null
        }
        popup={arOpen ? null : popup}
      />
      {arOpen && (
        <ArView
          data={data}
          latDeg={observer.latDeg}
          lstDeg={lstDeg}
          selectedId={selectedId}
          onSelect={setSelectedId}
          showAsterisms={showAsterisms}
          header={header}
          popup={popup}
          azimuthOffset={arAzimuthOffset}
          onAzimuthOffsetChange={setArAzimuthOffset}
          onClose={closeAr}
          onCameraUnavailable={handleCameraUnavailable}
        />
      )}
    </>
  );
}

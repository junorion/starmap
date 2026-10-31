import { DEFAULT_LONG_FOV_DEG } from "@/features/starmap/ar-projection";

// 안드로이드 앱(android/)이 WebView 에 붙이는 연결. 웹 표준에 없는 카메라 화각과 자기 편각을 알려 준다.
// magneticDeclination 은 나중에 붙었으므로 옛 앱에는 없을 수 있다.
type StarmapNative = { cameraFov: () => string; magneticDeclination?: (latDeg: number, lonDeg: number) => number };

function nativeApp(): StarmapNative | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { StarmapNative?: StarmapNative }).StarmapNative;
  return bridge && typeof bridge.cameraFov === "function" ? bridge : null;
}

// 안드로이드 앱 안에서 열렸는지. 브라우저에서는 AR 을 제공하지 않는다.
export function isAndroidApp(): boolean {
  return nativeApp() !== null;
}

// 후면 카메라 영상 긴 변의 화각(도). 앱이 알려 주지 못하면 기본값을 쓴다.
export function cameraLongFov(): number {
  try {
    const raw = nativeApp()?.cameraFov();
    const long = raw ? Number(JSON.parse(raw).long) : NaN;
    return long > 10 && long < 170 ? long : DEFAULT_LONG_FOV_DEG;
  } catch {
    return DEFAULT_LONG_FOV_DEG;
  }
}

// 그 위치의 자기 편각(도, 동쪽 +). 앱이 알려 주지 못하면 null.
export function magneticDeclination(latDeg: number, lonDeg: number): number | null {
  try {
    const value = Number(nativeApp()?.magneticDeclination?.(latDeg, lonDeg));
    return Number.isFinite(value) && Math.abs(value) <= 180 ? value : null;
  } catch {
    return null;
  }
}

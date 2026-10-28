import type { HorizontalCoords, Point } from "@/features/starmap/sky-math";

// AR 화면: 폰 방향과 카메라 화각으로 하늘의 고도·방위를 카메라 화면 좌표로 바꾼다.
//
// 세계 좌표계는 동(E)·북(N)·위(U), 기기 좌표계는 W3C·안드로이드와 같다: 세로로 든 폰의
// x 는 오른쪽, y 는 위, z 는 화면에서 사용자 쪽이다. 후면 카메라는 -z 방향을 본다.
// 회전 행렬은 기기→세계(행 우선, 길이 9): v_세계 = R · v_기기.
export type Matrix3 = readonly number[];

const DEG = Math.PI / 180;
// 카메라 바로 옆이나 뒤에 있는 점은 그리지 않는다.
const MIN_DEPTH = 1e-3;

// 안드로이드가 화각을 알려 주지 못할 때 쓰는 영상 긴 변의 화각.
// 4:3 센서에서 세로 화면의 가로(짧은 변) 화각이 60° 가 되는 값이다(약 75°).
export const DEFAULT_LONG_FOV_DEG = (2 * Math.atan(Math.tan(30 * DEG) * (4 / 3))) / DEG;

export type ScreenProjection = {
  width: number;
  height: number;
  // screen.orientation.angle: 세로가 0, 반시계로 눕힌 가로가 90.
  screenAngle: number;
  // 화면 픽셀 기준 초점거리.
  focalPx: number;
  // 나침반 오차를 맞추는 방위 보정(도). +면 그만큼 동쪽에 있는 점이 가운데로 온다.
  azimuthOffset?: number;
  // 기울기 보정(도). +면 화면 가운데보다 그만큼 위에 있던 점이 가운데로 온다.
  pitchOffset?: number;
  // 크기 배율. 카메라 화각 오차를 메운다(지표별 맞추기).
  scale?: number;
};

// 지표별 맞추기로 정하는 보정 세 가지.
export type ArCorrection = { azimuthOffset: number; pitchOffset: number; scale: number };

function worldVector({ alt, az }: HorizontalCoords, azimuthOffset: number): [number, number, number] {
  const a = (az - azimuthOffset) * DEG;
  const horizontal = Math.cos(alt * DEG);
  return [horizontal * Math.sin(a), horizontal * Math.cos(a), Math.sin(alt * DEG)];
}

// 하늘의 한 점을 카메라 화면 좌표로 바꾼다. 카메라 뒤쪽이면 null.
export function projectToScreen(
  coords: HorizontalCoords,
  deviceToWorld: Matrix3,
  { width, height, screenAngle, focalPx, azimuthOffset = 0, pitchOffset = 0, scale = 1 }: ScreenProjection
): Point | null {
  const [e, n, u] = worldVector(coords, azimuthOffset);
  const r = deviceToWorld;
  // 세계 → 기기는 전치 행렬.
  const dx = r[0] * e + r[3] * n + r[6] * u;
  const dy = r[1] * e + r[4] * n + r[7] * u;
  const dz = r[2] * e + r[5] * n + r[8] * u;

  // 화면을 돌려 든 만큼 기기 x·y 를 화면 x·y 로 돌린다(세로 0°, 반시계 가로 90°).
  const o = screenAngle * DEG;
  const sx = dx * Math.cos(o) - dy * Math.sin(o);
  const up = dx * Math.sin(o) + dy * Math.cos(o);
  // 기울기 보정: 카메라를 화면 위쪽으로 그만큼 고개 든 것처럼 돌린다.
  const p = pitchOffset * DEG;
  const sy = up * Math.cos(p) + dz * Math.sin(p);
  const depth = -dz * Math.cos(p) + up * Math.sin(p);
  if (depth < MIN_DEPTH) return null;

  const f = focalPx * scale;
  return { x: width / 2 + (f * sx) / depth, y: height / 2 - (f * sy) / depth };
}

// 카메라가 보는 방향의 고도(도).
export function viewAltitude(deviceToWorld: Matrix3): number {
  return Math.asin(Math.max(-1, Math.min(1, -deviceToWorld[8]))) / DEG;
}

// AbsoluteOrientationSensor 의 쿼터니언 [x, y, z, w] → 기기→세계 회전 행렬.
export function quaternionToMatrix([x, y, z, w]: readonly number[]): Matrix3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

// deviceorientationabsolute 의 알파·베타·감마(도) → 기기→세계 회전 행렬(W3C: Z·X'·Y'' 순서).
export function eulerToMatrix(alpha: number, beta: number, gamma: number): Matrix3 {
  const [cA, sA] = [Math.cos(alpha * DEG), Math.sin(alpha * DEG)];
  const [cB, sB] = [Math.cos(beta * DEG), Math.sin(beta * DEG)];
  const [cG, sG] = [Math.cos(gamma * DEG), Math.sin(gamma * DEG)];
  return [
    cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG,
    sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG,
    -cB * sG, sB, cB * cG,
  ];
}

// 화면을 덮도록(비율 유지, 넘치는 쪽은 잘라) 그린 카메라 영상의 화면 픽셀 기준 초점거리.
// 영상 크기를 아직 모르면 화면 긴 변을 영상 긴 변으로 본다.
export function focalLengthPx({
  width,
  height,
  videoWidth,
  videoHeight,
  longFovDeg,
}: {
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  longFovDeg: number;
}): number {
  const halfTan = Math.tan((longFovDeg / 2) * DEG);
  if (videoWidth <= 0 || videoHeight <= 0) return Math.max(width, height) / 2 / halfTan;
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return (Math.max(videoWidth, videoHeight) / 2 / halfTan) * scale;
}

// 화면을 좌우로 dx px 끌었을 때 바꿀 방위 보정(도). 가운데 근처의 그림이 손가락을 1:1 로 따라온다.
// 하늘 높이 볼수록 방위 1° 가 화면에서 짧아지므로 그만큼 더 돌린다(천정 근처는 5배로 묶는다).
export function calibrationStep(dx: number, focalPx: number, viewAltDeg: number): number {
  const degrees = Math.atan(dx / focalPx) / DEG;
  return -degrees / Math.max(Math.cos(viewAltDeg * DEG), 0.2);
}

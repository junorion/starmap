import { describe, expect, it } from "vitest";

import {
  calibrationStep,
  eulerToMatrix,
  focalLengthPx,
  projectToScreen,
  quaternionToMatrix,
  type Matrix3,
} from "@/features/starmap/ar-projection";

const DEG = Math.PI / 180;

// 세로로 든 폰이 정북 지평선을 향할 때(기기→세계 회전, 세계는 동·북·위).
// 기기 x(오른쪽)=동, 기기 y(위)=위, 기기 z(화면에서 나를 향함)=남. 후면 카메라는 -z, 곧 북을 본다.
const PORTRAIT_FACING_NORTH: Matrix3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
// 같은 자세에서 폰을 반시계로 눕혀 가로로 들 때(screen.orientation.angle = 90).
// 기기 y(원래 위)=서, 기기 x=위, 기기 z=남.
const LANDSCAPE_FACING_NORTH: Matrix3 = [0, -1, 0, 0, 0, -1, 1, 0, 0];

const portrait = { width: 400, height: 800, screenAngle: 0, focalPx: 400 };
const landscape = { width: 800, height: 400, screenAngle: 90, focalPx: 400 };

describe("projectToScreen", () => {
  it("정북 지평선을 향하면 방위 0°·고도 0° 지점이 화면 가운데에 온다", () => {
    const p = projectToScreen({ alt: 0, az: 0 }, PORTRAIT_FACING_NORTH, portrait);
    expect(p?.x).toBeCloseTo(200);
    expect(p?.y).toBeCloseTo(400);
  });

  it("고도가 세로 화각의 절반인 점이 화면 위 끝에 온다", () => {
    const halfVertical = Math.atan(portrait.height / 2 / portrait.focalPx) / DEG;
    const p = projectToScreen({ alt: halfVertical, az: 0 }, PORTRAIT_FACING_NORTH, portrait);
    expect(p?.x).toBeCloseTo(200);
    expect(p?.y).toBeCloseTo(0);
  });

  it("북을 향할 때 동쪽은 오른쪽, 서쪽은 왼쪽에 보인다", () => {
    const east = projectToScreen({ alt: 0, az: 10 }, PORTRAIT_FACING_NORTH, portrait);
    const west = projectToScreen({ alt: 0, az: 350 }, PORTRAIT_FACING_NORTH, portrait);
    expect(east!.x).toBeGreaterThan(200);
    expect(west!.x).toBeLessThan(200);
  });

  it("방위 보정 +10°를 주면 방위 10°인 점이 가운데로 온다", () => {
    const p = projectToScreen({ alt: 0, az: 10 }, PORTRAIT_FACING_NORTH, { ...portrait, azimuthOffset: 10 });
    expect(p?.x).toBeCloseTo(200);
    expect(p?.y).toBeCloseTo(400);
  });

  it("카메라 뒤쪽(남쪽)에 있는 점은 그리지 않는다", () => {
    expect(projectToScreen({ alt: 0, az: 180 }, PORTRAIT_FACING_NORTH, portrait)).toBeNull();
  });

  it("가로 화면에서도 같은 결과다: 북이 가운데, 위가 위, 동이 오른쪽", () => {
    const center = projectToScreen({ alt: 0, az: 0 }, LANDSCAPE_FACING_NORTH, landscape);
    expect(center?.x).toBeCloseTo(400);
    expect(center?.y).toBeCloseTo(200);

    const halfVertical = Math.atan(landscape.height / 2 / landscape.focalPx) / DEG;
    const top = projectToScreen({ alt: halfVertical, az: 0 }, LANDSCAPE_FACING_NORTH, landscape);
    expect(top?.x).toBeCloseTo(400);
    expect(top?.y).toBeCloseTo(0);

    const east = projectToScreen({ alt: 0, az: 10 }, LANDSCAPE_FACING_NORTH, landscape);
    expect(east!.x).toBeGreaterThan(400);

    const shifted = projectToScreen({ alt: 0, az: 10 }, LANDSCAPE_FACING_NORTH, { ...landscape, azimuthOffset: 10 });
    expect(shifted?.x).toBeCloseTo(400);
  });
});

describe("기기 방향을 회전 행렬로", () => {
  it("단위 쿼터니언은 단위 행렬이다", () => {
    expect(quaternionToMatrix([0, 0, 0, 1])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("x 축으로 90° 돌린 쿼터니언은 세로로 세운 폰(북을 향함)과 같다", () => {
    const s = Math.SQRT1_2;
    const m = quaternionToMatrix([s, 0, 0, s]);
    PORTRAIT_FACING_NORTH.forEach((v, i) => expect(m[i]).toBeCloseTo(v));
  });

  it("deviceorientation 각도(알파 0, 베타 90, 감마 0)도 세로로 세워 북을 향한 폰이다", () => {
    const m = eulerToMatrix(0, 90, 0);
    PORTRAIT_FACING_NORTH.forEach((v, i) => expect(m[i]).toBeCloseTo(v));
  });

  it("알파는 시계 반대로 돈다: 알파 90이면 같은 자세로 서쪽을 향한다", () => {
    const m = eulerToMatrix(90, 90, 0);
    const west = projectToScreen({ alt: 0, az: 270 }, m, portrait);
    expect(west?.x).toBeCloseTo(200);
    expect(west?.y).toBeCloseTo(400);
  });
});

describe("focalLengthPx", () => {
  it("화면을 덮도록 잘린 영상에서도 영상 긴 변의 화각이 그대로 유지된다", () => {
    // 세로 화면(400×800)에 세로 영상(720×1280)을 꽉 채우면 영상 긴 변(1280)이 화면 높이 800으로 줄어든다.
    // 긴 변 화각이 90°면 영상 기준 초점거리 640, 화면 기준 640 × (800/1280) = 400.
    expect(focalLengthPx({ width: 400, height: 800, videoWidth: 720, videoHeight: 1280, longFovDeg: 90 })).toBeCloseTo(400);
  });

  it("영상 크기를 아직 모르면 화면 긴 변에 긴 변 화각을 맞춘다", () => {
    expect(focalLengthPx({ width: 400, height: 800, videoWidth: 0, videoHeight: 0, longFovDeg: 90 })).toBeCloseTo(400);
  });
});

describe("calibrationStep", () => {
  it("오른쪽으로 끌면 그림이 오른쪽으로 따라오도록 보정이 줄어든다(가운데 근처 1:1)", () => {
    // 초점거리 400px에서 수평선 근처를 볼 때 1° ≈ 6.98px. 약 7px 끌면 약 -1°.
    expect(calibrationStep(400 * Math.tan(DEG), 400, 0)).toBeCloseTo(-1, 1);
  });

  it("하늘 높이 볼수록 같은 거리를 끌어도 더 많이 돈다", () => {
    expect(Math.abs(calibrationStep(10, 400, 60))).toBeGreaterThan(Math.abs(calibrationStep(10, 400, 0)));
  });
});

describe("기울기 보정과 크기 배율", () => {
  it("기울기 보정 +10° 를 주면 고도 10° 인 점이 가운데로 온다", () => {
    const p = projectToScreen({ alt: 10, az: 0 }, PORTRAIT_FACING_NORTH, { ...portrait, pitchOffset: 10 });
    expect(p?.x).toBeCloseTo(200);
    expect(p?.y).toBeCloseTo(400);
  });

  it("크기 배율 1.5 면 가운데에서 떨어진 거리가 1.5배가 된다", () => {
    const base = projectToScreen({ alt: 5, az: 5 }, PORTRAIT_FACING_NORTH, portrait)!;
    const scaled = projectToScreen({ alt: 5, az: 5 }, PORTRAIT_FACING_NORTH, { ...portrait, scale: 1.5 })!;
    expect(scaled.x - 200).toBeCloseTo((base.x - 200) * 1.5);
    expect(scaled.y - 400).toBeCloseTo((base.y - 400) * 1.5);
  });
});

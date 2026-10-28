import { describe, expect, it } from "vitest";

import { findBrightSpots, matchAsterism, solveAlignment, type AlignmentStar } from "@/features/starmap/ar-alignment";
import { projectToScreen, type Matrix3, type ScreenProjection } from "@/features/starmap/ar-projection";

// 밤하늘처럼 어두운 영상(밝기 0–255)에 별을 몇 개 찍는다. 별은 가운데가 가장 밝은 작은 덩어리다.
function nightImage(width: number, height: number, stars: { x: number; y: number; peak: number }[]) {
  const pixels = new Uint8ClampedArray(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = 12 + ((i * 7919) % 9); // 잡음 섞인 어두운 배경
  for (const { x, y, peak } of stars) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const v = peak * Math.exp(-(dx * dx + dy * dy) / 1.5);
        const i = (y + dy) * width + (x + dx);
        pixels[i] = Math.max(pixels[i], Math.round(v));
      }
    }
  }
  return pixels;
}

describe("findBrightSpots", () => {
  it("어두운 배경에서 별의 위치를 찾고 밝은 순으로 돌려준다", () => {
    const image = nightImage(200, 120, [
      { x: 40, y: 30, peak: 200 },
      { x: 150, y: 90, peak: 250 },
    ]);
    const spots = findBrightSpots(image, 200, 120);
    expect(spots).toHaveLength(2);
    expect(spots[0].x).toBeCloseTo(150, 0);
    expect(spots[0].y).toBeCloseTo(90, 0);
    expect(spots[1].x).toBeCloseTo(40, 0);
  });

  it("큰 덩어리(가로등·건물 불빛)는 별로 보지 않는다", () => {
    const image = nightImage(200, 120, [{ x: 40, y: 30, peak: 220 }]);
    for (let y = 60; y < 80; y++) for (let x = 100; x < 130; x++) image[y * 200 + x] = 240;
    const spots = findBrightSpots(image, 200, 120);
    expect(spots).toHaveLength(1);
    expect(spots[0].x).toBeCloseTo(40, 0);
  });

  it("별이 없으면 빈 목록이다", () => {
    expect(findBrightSpots(nightImage(100, 100, []), 100, 100)).toEqual([]);
  });
});

const TRIANGLE: AlignmentStar[] = [
  { name: "베가", x: 100, y: 100, at: { alt: 0, az: 0 } },
  { name: "데네브", x: 200, y: 80, at: { alt: 0, az: 0 } },
  { name: "알타이르", x: 160, y: 260, at: { alt: 0, az: 0 } },
];

describe("matchAsterism", () => {
  it("모양(거리 비율과 방향)이 맞는 점들을 꼭짓점과 짝짓는다", () => {
    // 꼭짓점 전체를 (30, 20) 만큼 옮기고 1.1배 키운 자리에 별이 있고, 엉뚱한 밝은 점도 하나 있다.
    const moved = TRIANGLE.map(({ x, y }) => ({ x: 100 + (x - 100) * 1.1 + 30, y: 100 + (y - 100) * 1.1 + 20 }));
    const spots = [{ x: 300, y: 300 }, ...moved];
    const match = matchAsterism([{ name: "여름의 대삼각형", stars: TRIANGLE }], spots, 120);
    expect(match?.name).toBe("여름의 대삼각형");
    expect(match?.pairs).toHaveLength(3);
    match!.pairs.forEach(({ star, spot }, i) => {
      expect(star.name).toBe(TRIANGLE.find((s) => s.name === star.name)!.name);
      expect(spot.x).toBeCloseTo(moved[TRIANGLE.indexOf(star)].x);
      expect(i).toBeLessThan(3);
    });
  });

  it("거리 비율이 다른 점들은 고르지 않는다", () => {
    // 두 점 사이가 꼭짓점 사이보다 3배 멀다(크기 범위 0.5–2배 밖).
    const spots = [{ x: 100, y: 100 }, { x: 400, y: 40 }];
    expect(matchAsterism([{ name: "여름의 대삼각형", stars: TRIANGLE.slice(0, 2) }], spots, 400)).toBeNull();
  });

  it("찾는 범위 밖의 점은 쓰지 않는다", () => {
    const spots = TRIANGLE.map(({ x, y }) => ({ x: x + 200, y }));
    expect(matchAsterism([{ name: "여름의 대삼각형", stars: TRIANGLE }], spots, 100)).toBeNull();
  });
});

describe("solveAlignment", () => {
  // 세로로 든 폰이 정북 지평선을 향한 자세.
  const NORTH: Matrix3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
  const base: ScreenProjection = { width: 400, height: 800, screenAngle: 0, focalPx: 600 };

  it("크기 1.2배·방위 3° 어긋난 실제 별 자리에서 크기 약 1.2, 방위 약 3° 를 구한다", () => {
    const stars = [
      { alt: 8, az: -6 },
      { alt: 14, az: 7 },
      { alt: 2, az: 3 },
    ];
    // 실제 하늘: 방위 보정 3°, 크기 1.2배로 그려야 맞는 자리.
    const truth = { ...base, azimuthOffset: 3, scale: 1.2 };
    const targets = stars.map((at) => projectToScreen(at, NORTH, truth)!);

    const result = solveAlignment(
      (correction) => stars.map((at) => projectToScreen(at, NORTH, { ...base, ...correction })),
      targets,
      { azimuthOffset: 0, pitchOffset: 0, scale: 1 },
      { focalPx: base.focalPx, viewAltDeg: 0 }
    );
    expect(result.correction.scale).toBeCloseTo(1.2, 2);
    expect(result.correction.azimuthOffset).toBeCloseTo(3, 1);
    expect(Math.abs(result.correction.pitchOffset)).toBeLessThan(0.3);
    expect(result.maxResidualPx).toBeLessThan(2);
  });
});

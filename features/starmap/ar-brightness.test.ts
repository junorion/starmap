import { describe, expect, it } from "vitest";

import { contrastForLuminance, nextContrast, overlayStyle } from "@/features/starmap/ar-brightness";

describe("contrastForLuminance", () => {
  it("어두운 밤 영상(40 이하)은 대비 0, 밝은 영상(160 이상)은 1, 그 사이는 고르게 바뀐다", () => {
    expect(contrastForLuminance(10)).toBe(0);
    expect(contrastForLuminance(40)).toBe(0);
    expect(contrastForLuminance(100)).toBeCloseTo(0.5);
    expect(contrastForLuminance(160)).toBe(1);
    expect(contrastForLuminance(250)).toBe(1);
  });
});

describe("nextContrast", () => {
  it("새 값 쪽으로 30% 씩 다가가 깜빡이지 않는다", () => {
    expect(nextContrast(0, 1)).toBeCloseTo(0.3);
    expect(nextContrast(0.3, 1)).toBeCloseTo(0.51);
    expect(nextContrast(1, 0)).toBeCloseTo(0.7);
  });
});

describe("overlayStyle", () => {
  it("대비 0 이면 지금 모습(검은 막 없음), 1 이면 검은 막 45% 에 선·별이 가장 진하다", () => {
    const night = overlayStyle(0);
    const bright = overlayStyle(1);
    expect(night.scrim).toBe(0);
    expect(bright.scrim).toBeCloseTo(0.45);
    expect(bright.lineAlpha).toBeGreaterThan(night.lineAlpha);
    expect(bright.lineWidth).toBeGreaterThan(night.lineWidth);
    expect(bright.starScale).toBeGreaterThan(night.starScale);
    expect(night.starOutline).toBe(0);
    expect(bright.starOutline).toBeGreaterThan(0);
  });
});

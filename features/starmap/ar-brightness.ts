"use client";

import { useEffect, useState, type RefObject } from "react";

// AR 화면: 카메라 영상이 밝을수록 겹친 그림이 묻혀 희미해 보이므로, 영상 밝기에 맞춰 대비를 자동으로 올린다.

// 평균 밝기(0–255)가 이 사이에서 대비가 0 → 1 로 고르게 바뀐다. 어두운 밤 영상은 지금 모습 그대로다.
const DARK_LUMINANCE = 40;
const BRIGHT_LUMINANCE = 160;
// 새로 잰 값 쪽으로 이만큼씩 다가가 깜빡이지 않게 한다.
const SMOOTHING = 0.3;
const SAMPLE_MS = 500;
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 24;

export function contrastForLuminance(mean: number): number {
  return Math.min(1, Math.max(0, (mean - DARK_LUMINANCE) / (BRIGHT_LUMINANCE - DARK_LUMINANCE)));
}

export function nextContrast(current: number, target: number): number {
  return current + (target - current) * SMOOTHING;
}

// 대비(0–1)에 따른 그리기 값. 0 이면 밤하늘용 기본 모습이다.
export function overlayStyle(contrast: number) {
  return {
    // 영상 위에 까는 검은 막의 불투명도.
    scrim: 0.45 * contrast,
    lineAlpha: 0.6 + 0.35 * contrast,
    lineWidth: 1.5 + contrast,
    starScale: 1.2 + 0.5 * contrast,
    // 별 둘레의 어두운 테두리 굵기(px).
    starOutline: 2.5 * contrast,
    labelAlpha: 0.9 + 0.1 * contrast,
    labelBold: contrast > 0.5,
    shadowBlur: 4 + 4 * contrast,
  };
}

export type OverlayStyle = ReturnType<typeof overlayStyle>;

// 영상 한 장을 아주 작게 줄여 평균 밝기(0–255)를 잰다. 잴 수 없으면 null.
function measureMeanLuminance(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

// 카메라 영상 밝기를 0.5초마다 재서 부드럽게 바뀌는 대비(0–1)를 돌려준다.
export function useOverlayContrast(videoRef: RefObject<HTMLVideoElement | null>): number {
  const [contrast, setContrast] = useState(0);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const mean = video ? measureMeanLuminance(video, canvas) : null;
      if (mean === null) return;
      const target = contrastForLuminance(mean);
      setContrast((current) => {
        const next = nextContrast(current, target);
        return Math.abs(next - current) < 0.005 ? current : next;
      });
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [videoRef]);

  return contrast;
}

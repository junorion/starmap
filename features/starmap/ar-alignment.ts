import { calibrationStep, type ArCorrection } from "@/features/starmap/ar-projection";
import type { HorizontalCoords, Point } from "@/features/starmap/sky-math";

// AR 지표별 맞추기: 카메라 영상에서 밝은 점을 찾고, 지표별 도형과 모양이 맞는 점을 짝지어,
// 그 점들에 지표별이 겹치도록 방위·기울기·크기 보정을 구한다.

const DEG = Math.PI / 180;

// 별로 보는 밝은 덩어리의 넓이(픽셀). 이보다 크면 가로등·건물 불빛·달로 본다.
const MAX_SPOT_AREA = 80;
const MAX_SPOTS = 40;
// 짝지을 때 허용하는 크기 범위와 방향 차이, 나머지 꼭짓점의 허용 오차(px).
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
const MAX_ANGLE_DIFF_DEG = 15;
export const MATCH_TOLERANCE_PX = 12;

export type BrightSpot = Point & { peak: number; area: number };
// 화면에 그려진 지표별 꼭짓점 하나(화면 좌표와 하늘 좌표).
export type AlignmentStar = Point & { name: string; at: HorizontalCoords };
export type AlignmentTarget = { name: string; stars: AlignmentStar[] };
export type AsterismMatch = { name: string; pairs: { star: AlignmentStar; spot: Point }[] };

// 밝기 영상(0–255, 행 우선)에서 주변보다 확연히 밝은 작은 덩어리를 찾아 밝은 순으로 돌려준다.
export function findBrightSpots(luminance: ArrayLike<number>, width: number, height: number): BrightSpot[] {
  const n = width * height;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += luminance[i];
    sumSq += luminance[i] * luminance[i];
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const threshold = Math.min(250, Math.max(mean + 5 * std, mean + 60));

  const seen = new Uint8Array(n);
  const spots: BrightSpot[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || luminance[start] < threshold) continue;
    // 이어진 밝은 픽셀을 한 덩어리로 모은다(8방향).
    let area = 0;
    let weight = 0;
    let wx = 0;
    let wy = 0;
    let peak = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      const w = luminance[i] - threshold + 1;
      area += 1;
      weight += w;
      wx += x * w;
      wy += y * w;
      peak = Math.max(peak, luminance[i]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!seen[j] && luminance[j] >= threshold) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (area <= MAX_SPOT_AREA) spots.push({ x: wx / weight, y: wy / weight, peak, area });
  }

  return spots.sort((a, b) => b.peak - a.peak || b.area - a.area).slice(0, MAX_SPOTS);
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// 지표별 도형의 꼭짓점과 모양(거리 비율·방향)이 맞는 밝은 점들을 짝짓는다.
// 꼭짓점마다 searchRadius 안의 점만 쓴다. 두 꼭짓점 이상 짝지은 것 중 가장 많이, 가장 가깝게 맞는 도형을 고른다.
export function matchAsterism(
  targets: AlignmentTarget[],
  spots: Point[],
  searchRadius: number
): AsterismMatch | null {
  let best: { match: AsterismMatch; score: number } | null = null;

  for (const { name, stars } of targets) {
    if (stars.length < 2) continue;
    const near = stars.map((star) => spots.filter((spot) => distance(star, spot) <= searchRadius));

    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const vp = { x: stars[j].x - stars[i].x, y: stars[j].y - stars[i].y };
        const lengthP = Math.hypot(vp.x, vp.y);
        if (lengthP < 1) continue;

        for (const a of near[i]) {
          for (const b of near[j]) {
            if (a === b) continue;
            const vq = { x: b.x - a.x, y: b.y - a.y };
            const ratio = Math.hypot(vq.x, vq.y) / lengthP;
            if (ratio < MIN_SCALE || ratio > MAX_SCALE) continue;
            const turn = Math.atan2(vq.y, vq.x) - Math.atan2(vp.y, vp.x);
            const turnDeg = Math.abs(((turn / DEG + 540) % 360) - 180);
            if (turnDeg > MAX_ANGLE_DIFF_DEG) continue;

            // 두 점으로 정한 닮음 변환으로 나머지 꼭짓점의 자리를 예상하고, 그 근처의 점을 짝짓는다.
            const [cos, sin] = [Math.cos(turn) * ratio, Math.sin(turn) * ratio];
            const used = new Set<Point>([a, b]);
            const pairs = [
              { star: stars[i], spot: a },
              { star: stars[j], spot: b },
            ];
            let residual = 0;
            stars.forEach((star, k) => {
              if (k === i || k === j) return;
              const rx = star.x - stars[i].x;
              const ry = star.y - stars[i].y;
              const expected = { x: a.x + cos * rx - sin * ry, y: a.y + sin * rx + cos * ry };
              let nearest: Point | null = null;
              for (const spot of spots) {
                if (used.has(spot)) continue;
                if (distance(spot, expected) <= MATCH_TOLERANCE_PX && (!nearest || distance(spot, expected) < distance(nearest, expected))) {
                  nearest = spot;
                }
              }
              if (nearest) {
                used.add(nearest);
                residual += distance(nearest, expected);
                pairs.push({ star, spot: nearest });
              }
            });

            const score = pairs.length * 1000 - residual;
            if (!best || score > best.score) {
              pairs.sort((p, q) => stars.indexOf(p.star) - stars.indexOf(q.star));
              best = { match: { name, pairs }, score };
            }
          }
        }
      }
    }
  }

  return best?.match ?? null;
}

// 지금 보정으로 그린 꼭짓점들이 targets(찾은 점)에 겹치도록 보정을 구한다.
// 크기는 점 사이 거리의 비율로, 방위·기울기는 무게중심의 차이로 몇 번 되풀이해 맞춘다. 화면 회전(롤)은 맞추지 않는다.
export function solveAlignment(
  project: (correction: ArCorrection) => (Point | null)[],
  targets: Point[],
  start: ArCorrection,
  { focalPx, viewAltDeg }: { focalPx: number; viewAltDeg: number }
): { correction: ArCorrection; maxResidualPx: number } {
  const correction = { ...start };

  const projected = () => {
    const points = project(correction);
    return points.every((p) => p !== null) ? (points as Point[]) : null;
  };

  for (let round = 0; round < 8; round++) {
    let points = projected();
    if (!points) break;

    if (points.length >= 2) {
      let ratioSum = 0;
      let count = 0;
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const p = distance(points[i], points[j]);
          if (p < 1) continue;
          ratioSum += distance(targets[i], targets[j]) / p;
          count += 1;
        }
      }
      if (count > 0) correction.scale *= ratioSum / count;
      points = projected();
      if (!points) break;
    }

    const mean = (list: Point[]) => ({
      x: list.reduce((s, p) => s + p.x, 0) / list.length,
      y: list.reduce((s, p) => s + p.y, 0) / list.length,
    });
    const want = mean(targets);
    const have = mean(points);
    const f = focalPx * correction.scale;
    // 그림을 (dx, dy) 만큼 옮기는 보정: 끌기와 같은 방향이다.
    correction.azimuthOffset += calibrationStep(want.x - have.x, f, viewAltDeg);
    correction.pitchOffset += Math.atan((want.y - have.y) / f) / DEG;
  }

  const final = projected();
  const maxResidualPx = final
    ? Math.max(...final.map((p, i) => distance(p, targets[i])))
    : Infinity;
  return { correction, maxResidualPx };
}

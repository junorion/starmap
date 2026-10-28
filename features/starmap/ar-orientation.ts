"use client";

import { useEffect, useRef, useState } from "react";

import { eulerToMatrix, quaternionToMatrix, type Matrix3 } from "@/features/starmap/ar-projection";

// 방향 값이 이만큼 오지 않으면 센서를 쓸 수 없다고 본다.
const NO_READING_MS = 3000;

type OrientationSensorLike = {
  quaternion?: number[] | null;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};
type SensorConstructor = new (options: { frequency: number; referenceFrame: "device" }) => OrientationSensorLike;

// 기기의 절대 방향(나침반 기준)을 기기→세계 회전 행렬로 받는다. 화면을 그릴 때마다 읽을 수 있게 ref 에 둔다.
// AbsoluteOrientationSensor 를 먼저 쓴다. 회전을 쿼터니언 한 덩어리로 줘서, 폰을 천정 근처로 들 때도
// 각도 세 개(알파·베타·감마)처럼 값이 튀지 않는다. 쓸 수 없으면 deviceorientationabsolute 로 받는다.
export function useDeviceRotation() {
  const rotation = useRef<Matrix3 | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let lastReadingAt = Date.now();
    const accept = (matrix: Matrix3) => {
      rotation.current = matrix;
      lastReadingAt = Date.now();
      setAvailable(true);
    };

    const handleEvent = (event: Event) => {
      const { alpha, beta, gamma } = event as DeviceOrientationEvent;
      if (alpha === null || beta === null || gamma === null) return;
      accept(eulerToMatrix(alpha, beta, gamma));
    };
    let listening = false;
    const listenToEvents = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("deviceorientationabsolute", handleEvent);
    };

    let sensor: OrientationSensorLike | null = null;
    const Sensor = (window as Window & { AbsoluteOrientationSensor?: SensorConstructor }).AbsoluteOrientationSensor;
    if (Sensor) {
      try {
        sensor = new Sensor({ frequency: 60, referenceFrame: "device" });
        const current = sensor;
        current.addEventListener("reading", () => {
          if (current.quaternion) accept(quaternionToMatrix(current.quaternion));
        });
        current.addEventListener("error", () => {
          current.stop();
          listenToEvents();
        });
        current.start();
      } catch {
        listenToEvents();
      }
    } else {
      listenToEvents();
    }

    const watchdog = setInterval(() => {
      if (Date.now() - lastReadingAt > NO_READING_MS) setAvailable(false);
    }, 500);

    return () => {
      clearInterval(watchdog);
      sensor?.stop();
      if (listening) window.removeEventListener("deviceorientationabsolute", handleEvent);
    };
  }, []);

  return { rotation, available };
}

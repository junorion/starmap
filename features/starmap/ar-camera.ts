"use client";

import { useEffect, useState, type RefObject } from "react";

export type CameraState = "starting" | "live" | "denied" | "failed";

// 후면 카메라 영상을 video 에 연결한다. 영상은 화면에 보여 주기만 하고 저장하거나 보내지 않는다.
// 앱에서는 이 요청이 안드로이드 카메라 권한 대화상자를 띄운다. 화면이 닫히면 카메라를 끈다.
export function useRearCamera(videoRef: RefObject<HTMLVideoElement | null>): CameraState {
  const [state, setState] = useState<CameraState>("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const video = videoRef.current;
    const media = navigator.mediaDevices;

    if (!media?.getUserMedia) {
      queueMicrotask(() => setState("failed"));
      return;
    }
    media
      .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } })
      .then(
        (granted) => {
          if (cancelled) {
            granted.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = granted;
          if (video) {
            video.srcObject = granted;
            Promise.resolve()
              .then(() => video.play())
              .catch(() => {});
          }
          setState("live");
        },
        (error: { name?: string }) => {
          if (cancelled) return;
          setState(error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "denied" : "failed");
        }
      );

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [videoRef]);

  return state;
}

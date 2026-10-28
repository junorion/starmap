"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// browser: 브라우저에서는 AR 을 제공하지 않는다(카메라를 켜거나 권한을 요청하지 않는다).
// camera-denied·camera-failed: 앱에서 카메라 권한을 거부했거나 카메라를 켤 수 없었다.
export type ArNoticeReason = "browser" | "camera-denied" | "camera-failed";

const MESSAGES: Record<ArNoticeReason, string> = {
  browser: "휴대폰 카메라로 밤하늘을 비추면 별자리를 겹쳐 보여 주는 기능입니다. AR 모드는 Starmap 안드로이드 앱에서 쓸 수 있습니다.",
  "camera-denied":
    "카메라 권한이 있어야 AR 모드를 쓸 수 있습니다. AR 모드 버튼을 다시 누르면 권한을 다시 묻습니다. 묻지 않으면 설정 → 애플리케이션 → Starmap → 권한에서 카메라를 허용해 주세요.",
  "camera-failed": "카메라를 켤 수 없어 AR 모드를 열지 못했습니다. 다른 앱이 카메라를 쓰고 있지 않은지 확인해 주세요.",
};

type ArNoticeProps = {
  reason: ArNoticeReason;
  onClose: () => void;
};

export function ArNotice({ reason, onClose }: ArNoticeProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Card
      role="dialog"
      aria-label="AR 모드 안내"
      className="bg-slate-950/60 text-white shadow-lg ring-white/15 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
    >
      <CardHeader>
        <CardTitle>AR 모드</CardTitle>
        <CardDescription className="text-slate-300">
          {MESSAGES[reason]}
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button variant="secondary" onClick={onClose}>
          확인
        </Button>
      </CardFooter>
    </Card>
  );
}

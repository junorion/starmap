"use client";

import { useEffect } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

type OptionsPanelProps = {
  showAsterisms: boolean;
  onShowAsterismsChange: (checked: boolean) => void;
  showOtherStars: boolean;
  onShowOtherStarsChange: (checked: boolean) => void;
  // 진북 보정(AR). 안드로이드 앱에서만 넘긴다. declination 은 지금 위치의 편각(모르면 null).
  trueNorth?: { checked: boolean; declination: number | null; onChange: (checked: boolean) => void };
  onClose: () => void;
};

export function OptionsPanel({
  showAsterisms,
  onShowAsterismsChange,
  showOtherStars,
  onShowOtherStarsChange,
  trueNorth,
  onClose,
}: OptionsPanelProps) {
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
      aria-label="옵션"
      className="bg-slate-950/60 text-white shadow-lg ring-white/15 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
    >
      <CardHeader>
        <CardTitle>옵션</CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="닫기"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id="option-asterisms"
              className="border-white/60"
              checked={showAsterisms}
              onCheckedChange={(checked) => onShowAsterismsChange(checked === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="option-asterisms">지표별 추가</FieldLabel>
              <FieldDescription className="text-slate-300">
                계절별 대삼각형처럼 별자리를 찾는 길잡이 별을 지도에 표시합니다.
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="option-other-stars"
              className="border-white/60"
              checked={showOtherStars}
              onCheckedChange={(checked) => onShowOtherStarsChange(checked === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="option-other-stars">별자리 외 별 표시</FieldLabel>
              <FieldDescription className="text-slate-300">
                끄면 별자리를 이루는 별만 남겨 별자리 모양을 또렷하게 봅니다.
              </FieldDescription>
            </FieldContent>
          </Field>
          {trueNorth && (
            <Field orientation="horizontal">
              <Checkbox
                id="option-true-north"
                className="border-white/60"
                checked={trueNorth.checked}
                onCheckedChange={(checked) => trueNorth.onChange(checked === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor="option-true-north">AR 진북 보정</FieldLabel>
                <FieldDescription className="text-slate-300">
                  나침반이 가리키는 자북과 실제 북쪽(진북)의 차이를 AR 화면에서 자동으로 메웁니다.
                  {trueNorth.declination === null
                    ? " 이 기기에서는 편각을 알 수 없어 적용되지 않습니다."
                    : ` 현재 위치의 편각은 ${formatDeclination(trueNorth.declination)}입니다.`}
                </FieldDescription>
              </FieldContent>
            </Field>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

// -8.6 → "서쪽 8.6°", 3.2 → "동쪽 3.2°"
function formatDeclination(deg: number): string {
  return `${deg < 0 ? "서쪽" : "동쪽"} ${Math.abs(deg).toFixed(1)}°`;
}

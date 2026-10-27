import { Starmap } from "@/features/starmap";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 max-sm:gap-0 max-sm:p-0 sm:px-6">
      {/* 휴대폰(640px 미만)과 안드로이드 앱에서는 지도가 화면 전체를 쓰므로 제목을 화면에서 숨긴다. */}
      <header className="flex flex-col gap-1 max-sm:sr-only">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Starmap</h1>
        <p className="text-muted-foreground">지금 이 시간, 이 위치의 하늘에 보이는 별자리 지도</p>
      </header>
      <Starmap />
    </main>
  );
}

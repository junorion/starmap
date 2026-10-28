import { Starmap } from "@/features/starmap";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-[#0b1020]">
      {/* 지도가 화면 전체를 쓰므로 제목은 화면에 그리지 않고 스크린 리더에만 남긴다. */}
      <header className="sr-only">
        <h1>Starmap</h1>
        <p>지금 이 시간, 이 위치의 하늘에 보이는 별자리 지도</p>
      </header>
      <Starmap />
    </main>
  );
}

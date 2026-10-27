import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Starmap } from "@/features/starmap";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", async (path: string) => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(join(process.cwd(), "public", path), "utf8")),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

// 오른쪽 아래의 옵션 버튼을 눌러 옵션 창을 연다.
async function clickOptionsButton() {
  fireEvent.click(await screen.findByRole("button", { name: "옵션" }));
}

afterEach(() => {
  // 메뉴(Base UI)는 언마운트될 때도 ResizeObserver를 쓰므로, 스텁을 풀기 전에 먼저 언마운트한다.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("위치 권한을 허용하면 그 위치 기준이라고 알린다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: 35.1796, longitude: 129.0756 } } as GeolocationPosition),
    },
  });

  render(<Starmap />);

  const status = await screen.findByTestId("sky-status");
  expect(status).toHaveTextContent("현재 위치");
  expect(status).toHaveTextContent("북위 35.18° · 동경 129.08°");
});

test("오른쪽 아래에 AR 모드, 찾기, 돌리기 모드, 옵션 버튼이 나란히 있고, 돌리기 모드는 처음에 꺼져 있다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  const rotateButton = await screen.findByRole("button", { name: "돌리기 모드" });
  const optionsButton = screen.getByRole("button", { name: "옵션" });
  expect(rotateButton).toHaveAttribute("aria-pressed", "false");
  const searchButton = screen.getByRole("button", { name: "찾기" });
  const arButton = screen.getByRole("button", { name: "AR 모드" });
  // 네 버튼은 같은 줄에 나란히 놓인다(같은 부모 안에서 왼쪽부터 AR 모드, 찾기, 돌리기 모드, 옵션).
  expect(arButton.parentElement).toBe(searchButton.parentElement);
  expect(searchButton.parentElement).toBe(rotateButton.parentElement);
  expect(rotateButton.parentElement).toBe(optionsButton.parentElement);
  const follows = (a: HTMLElement, b: HTMLElement) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(arButton, searchButton)).toBe(true);
  expect(follows(searchButton, rotateButton)).toBe(true);
  expect(follows(rotateButton, optionsButton)).toBe(true);
});

test("메뉴의 옵션을 누르면 옵션 창이 열리고, 지표별 추가 체크 상태는 창을 다시 열어도 유지된다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  async function openOptions() {
    await clickOptionsButton();
    return screen.findByRole("dialog", { name: "옵션" }, { timeout: 4000 });
  }

  await openOptions();
  const checkbox = screen.getByRole("checkbox", { name: "지표별 추가" });
  expect(checkbox).not.toBeChecked();

  fireEvent.click(checkbox);
  expect(screen.getByRole("checkbox", { name: "지표별 추가" })).toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("dialog", { name: "옵션" })).not.toBeInTheDocument();

  await openOptions();
  expect(screen.getByRole("checkbox", { name: "지표별 추가" })).toBeChecked();
});

test("별자리 외 별 표시는 처음에 켜져 있고, 끈 상태는 옵션 창을 다시 열어도 유지된다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  async function openOptions() {
    await clickOptionsButton();
    await screen.findByRole("dialog", { name: "옵션" }, { timeout: 4000 });
  }

  await openOptions();
  const checkbox = screen.getByRole("checkbox", { name: "별자리 외 별 표시" });
  expect(checkbox).toBeChecked();

  fireEvent.click(checkbox);
  expect(screen.getByRole("checkbox", { name: "별자리 외 별 표시" })).not.toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await openOptions();
  expect(screen.getByRole("checkbox", { name: "별자리 외 별 표시" })).not.toBeChecked();
});

test("현재 위치로 버튼은 확대를 처음 배율로 되돌리고 위치를 다시 받는다", async () => {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: 35.1796, longitude: 129.0756 } } as GeolocationPosition)
  );
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

  render(<Starmap />);

  // jsdom에서는 지도 크기가 0이라 처음 배율은 1배이고, 그래서 축소 버튼이 비활성화되어 있다.
  const zoomOutButton = await screen.findByRole("button", { name: "축소" });
  expect(zoomOutButton).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "확대" }));
  expect(screen.getByRole("button", { name: "축소" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "현재 위치로" }));
  expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();
  expect(getCurrentPosition).toHaveBeenCalledTimes(2);
});

test("지도 위에서 휠을 굴리면 페이지 스크롤 없이 확대·축소된다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  // jsdom에서는 지도 크기가 0이라 처음 배율이 1배이고, 그래서 축소 버튼이 비활성화되어 있다.
  expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();

  // 휠 리스너는 지도가 나타난 직후 붙으므로, 붙을 때까지 기다린다(deltaY 0은 배율을 바꾸지 않는다).
  await waitFor(() => expect(fireEvent.wheel(map, { deltaY: 0 })).toBe(false));

  // 위로 굴리면(deltaY < 0) 확대. 기본 동작(페이지 스크롤)이 막혀야 한다.
  const notPrevented = fireEvent.wheel(map, { deltaY: -200 });
  expect(notPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "축소" })).toBeEnabled();

  // 충분히 확대하면 확대 버튼이 비활성화되고(8배 한계), 아래로 많이 굴리면 1배로 돌아온다.
  fireEvent.wheel(map, { deltaY: -100000 });
  expect(screen.getByRole("button", { name: "확대" })).toBeDisabled();
  fireEvent.wheel(map, { deltaY: 100000 });
  expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();
});

function stubSeoulFallback() {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });
}

// 지금 화면 가운데에 보이는 하늘의 고도·방위. 돌리기 전에는 천정(고도 90°)이다.
const viewOf = (map: HTMLElement) => ({
  alt: Number(map.getAttribute("data-view-alt")),
  az: Number(map.getAttribute("data-view-az")),
});

function pointer(
  map: HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  init: { id: number; x: number; y?: number; button?: number; pointerType?: string }
) {
  fireEvent[type](map, {
    pointerId: init.id,
    clientX: init.x,
    clientY: init.y ?? 100,
    button: init.button ?? 0,
    pointerType: init.pointerType ?? "mouse",
  });
}

// 오른쪽 버튼으로 (0,0)에서 (dx, dy)만큼 끈다.
function rightDrag(map: HTMLElement, id: number, dx: number, dy: number) {
  pointer(map, "pointerDown", { id, x: 100, y: 100, button: 2 });
  pointer(map, "pointerMove", { id, x: 100 + dx, y: 100 + dy, button: 2 });
  pointer(map, "pointerUp", { id, x: 100 + dx, y: 100 + dy, button: 2 });
}

// 225px = 90도(1px당 0.4도).
test("마우스 오른쪽 버튼으로 끌면 끄는 방향의 하늘이 가운데로 오고, 왼쪽 버튼으로 끌면 돌지 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });

  // 왼쪽 버튼 드래그는 지도 이동이지 하늘 돌리기가 아니다.
  pointer(map, "pointerDown", { id: 1, x: 100 });
  pointer(map, "pointerMove", { id: 1, x: 325 });
  pointer(map, "pointerUp", { id: 1, x: 325 });
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });

  // 오른쪽으로 끌면 왼쪽(동쪽)에 있던 하늘이 가운데로 온다.
  rightDrag(map, 2, 225, 0);
  expect(viewOf(map)).toEqual({ alt: 0, az: 90 });

  // 이어서 왼쪽으로 같은 거리를 끌면 다시 천정으로 돌아온다.
  rightDrag(map, 3, -225, 0);
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });
});

test("위아래로 끌어도 하늘이 돌아서 북쪽·남쪽 지평선과 지평선 아래까지 가운데로 올 수 있다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  rightDrag(map, 1, 0, 225); // 아래로: 북쪽 하늘이 가운데로
  expect(viewOf(map)).toEqual({ alt: 0, az: 0 });

  rightDrag(map, 2, 0, 225); // 같은 방향으로 더 끌면: 지평선을 지나 천정의 반대편(천저)까지
  expect(viewOf(map).alt).toBe(-90);

  rightDrag(map, 3, 0, 225); // 더 끌면 남쪽 지평선 쪽을 지나 올라온다
  expect(viewOf(map)).toEqual({ alt: 0, az: 180 });
});

test("확대할수록 같은 거리를 끌어도 하늘이 덜 돈다 (배율에 맞춰 손에 붙는 속도)", async () => {
  stubSeoulFallback();
  // 지도 크기를 390×795로 알려 줘서 실제 배율과 반지름이 계산되게 한다.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 390, height: 795 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      disconnect() {}
    }
  );
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  // 지도 크기가 반영되면 처음 배율이 약 2.2배가 되어 축소 버튼이 활성화된다. 그때까지 기다린다.
  await waitFor(() => expect(screen.getByRole("button", { name: "축소" })).toBeEnabled());

  // 처음 배율(약 2.2배)에서 오른쪽으로 100px: 가운데 하늘이 약 31도 멀어진다(고도 90° → 약 59°).
  rightDrag(map, 1, 100, 0);
  const atInitialZoom = viewOf(map).alt;
  expect(atInitialZoom).toBeGreaterThan(55);
  expect(atInitialZoom).toBeLessThan(63);

  // 처음으로 돌아가 3단계 확대(약 7.5배)한 뒤 같은 100px을 끌면 훨씬 덜 돈다(약 9도).
  fireEvent.click(screen.getByRole("button", { name: "현재 위치로" }));
  for (let step = 0; step < 3; step++) fireEvent.click(screen.getByRole("button", { name: "확대" }));
  rightDrag(map, 2, 100, 0);
  const zoomedIn = viewOf(map).alt;
  expect(zoomedIn).toBeGreaterThan(atInitialZoom);
  expect(zoomedIn).toBeGreaterThan(78);
});

test("지도 위에서는 오른쪽 클릭 메뉴가 뜨지 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  expect(fireEvent.contextMenu(map)).toBe(false);
});

test("두 손가락을 같은 방향으로 움직이면 하늘이 돌고, 간격을 벌리면 돌지 않고 확대한다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  const touch = { pointerType: "touch" };

  // 나란히 오른쪽으로 40px씩 이동 (손가락마다 이벤트가 따로 들어온다).
  pointer(map, "pointerDown", { id: 1, x: 100, ...touch });
  pointer(map, "pointerDown", { id: 2, x: 160, ...touch });
  for (let step = 1; step <= 8; step++) {
    pointer(map, "pointerMove", { id: 1, x: 100 + step * 5, ...touch });
    pointer(map, "pointerMove", { id: 2, x: 160 + step * 5, ...touch });
  }
  pointer(map, "pointerUp", { id: 1, x: 140, ...touch });
  pointer(map, "pointerUp", { id: 2, x: 200, ...touch });
  expect(viewOf(map).alt).toBeLessThan(90);
  expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();

  // 간격을 벌리면(핀치) 확대되고 보는 방향은 바뀌지 않는다.
  const before = viewOf(map);
  pointer(map, "pointerDown", { id: 3, x: 100, ...touch });
  pointer(map, "pointerDown", { id: 4, x: 140, ...touch });
  for (let step = 1; step <= 8; step++) {
    pointer(map, "pointerMove", { id: 3, x: 100 - step * 5, ...touch });
    pointer(map, "pointerMove", { id: 4, x: 140 + step * 5, ...touch });
  }
  pointer(map, "pointerUp", { id: 3, x: 60, ...touch });
  pointer(map, "pointerUp", { id: 4, x: 180, ...touch });
  expect(viewOf(map)).toEqual(before);
  expect(screen.getByRole("button", { name: "축소" })).toBeEnabled();
});

test("돌리기 모드를 켜면 왼쪽 버튼 드래그가 하늘 돌리기가 되고, 끄면 다시 이동이 된다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  const modeButton = screen.getByRole("button", { name: "돌리기 모드" });

  fireEvent.click(modeButton);
  expect(modeButton).toHaveAttribute("aria-pressed", "true");

  // 켠 동안의 왼쪽 버튼 드래그(225px = 90도)는 하늘을 돌린다.
  pointer(map, "pointerDown", { id: 1, x: 100 });
  pointer(map, "pointerMove", { id: 1, x: 325 });
  pointer(map, "pointerUp", { id: 1, x: 325 });
  expect(viewOf(map)).toEqual({ alt: 0, az: 90 });

  // 끄면 같은 드래그가 하늘을 돌리지 않는다.
  fireEvent.click(modeButton);
  expect(modeButton).toHaveAttribute("aria-pressed", "false");
  pointer(map, "pointerDown", { id: 2, x: 100 });
  pointer(map, "pointerMove", { id: 2, x: 325 });
  pointer(map, "pointerUp", { id: 2, x: 325 });
  expect(viewOf(map)).toEqual({ alt: 0, az: 90 });
});

const HINT_DIALOG = { name: "하늘 돌리기 안내" };

// 1배라서 지도를 끌어도 움직이지 않는 상태에서 왼쪽 버튼으로 끈다(안내 창이 뜨는 조건).
function dragMapThatCannotMove(map: HTMLElement, id: number) {
  pointer(map, "pointerDown", { id, x: 100 });
  pointer(map, "pointerMove", { id, x: 160 });
  pointer(map, "pointerUp", { id, x: 160 });
}

test("지도를 끌어도 더 움직이지 않으면 안내 창이 뜨고, 돌리기 켜기를 누르면 모드가 켜진다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();

  dragMapThatCannotMove(map, 1);
  expect(await screen.findByRole("dialog", HINT_DIALOG)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "더 이상 안내하지 않기" })).not.toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "돌리기 켜기" }));
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "돌리기 모드" })).toHaveAttribute("aria-pressed", "true");
});

test("체크하지 않고 닫으면 이 방문에서는 다시 뜨지 않고, 저장하지도 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  dragMapThatCannotMove(map, 1);
  await screen.findByRole("dialog", HINT_DIALOG);
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "돌리기 모드" })).toHaveAttribute("aria-pressed", "false");

  dragMapThatCannotMove(map, 2);
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
  expect(window.localStorage.getItem("starmap:rotate-hint-dismissed")).toBeNull();
});

test("더 이상 안내하지 않기를 체크하고 닫으면 저장되어, 다시 열어도 뜨지 않는다", async () => {
  stubSeoulFallback();
  const first = render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  dragMapThatCannotMove(map, 1);
  await screen.findByRole("dialog", HINT_DIALOG);
  fireEvent.click(screen.getByRole("checkbox", { name: "더 이상 안내하지 않기" }));
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(window.localStorage.getItem("starmap:rotate-hint-dismissed")).toBe("1");

  // 새로 열었을 때(새 방문)에도 뜨지 않는다.
  first.unmount();
  render(<Starmap />);
  const reopened = await screen.findByLabelText("현재 하늘의 별자리 지도");
  dragMapThatCannotMove(reopened, 2);
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
});

test("돌리기 모드가 켜져 있거나 옵션 창이 열려 있으면 안내 창이 뜨지 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  // 옵션 창이 열려 있을 때
  await clickOptionsButton();
  await screen.findByRole("dialog", { name: "옵션" });
  dragMapThatCannotMove(map, 1);
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  // 돌리기 모드가 켜져 있을 때
  fireEvent.click(screen.getByRole("button", { name: "돌리기 모드" }));
  dragMapThatCannotMove(map, 2);
  expect(screen.queryByRole("dialog", HINT_DIALOG)).not.toBeInTheDocument();
});

test("현재 위치로 버튼은 보는 방향도 처음(천정이 가운데)으로 되돌린다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  rightDrag(map, 1, 200, 80);
  expect(viewOf(map).alt).toBeLessThan(90);

  fireEvent.click(screen.getByRole("button", { name: "현재 위치로" }));
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });
});

async function openSearch() {
  fireEvent.click(await screen.findByRole("button", { name: "찾기" }));
  return screen.findByRole("dialog", { name: "별자리 찾기" });
}

const typeInSearch = (text: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: "별자리 이름" }), { target: { value: text } });

test("찾기 버튼을 누르면 찾기 창이 열리고 입력 칸에 커서가 있다", async () => {
  stubSeoulFallback();
  render(<Starmap />);

  await openSearch();

  expect(screen.getByRole("textbox", { name: "별자리 이름" })).toHaveFocus();
  expect(screen.getByText("이름의 일부만 써도 찾을 수 있어요.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "찾은 별자리" })).not.toBeInTheDocument();
});

test("이름을 입력하고 목록에서 고르면 창이 닫히고 그 별자리가 선택되어 가운데로 온다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });

  await openSearch();
  typeInSearch("오리온");
  const result = await screen.findByRole("button", { name: /오리온자리/ });

  fireEvent.click(result);

  expect(screen.queryByRole("dialog", { name: "별자리 찾기" })).not.toBeInTheDocument();
  expect(await screen.findByRole("dialog", { name: "오리온자리 정보" })).toBeInTheDocument();
  // 하늘이 돌아 오리온자리가 가운데에 왔다(지금 시각에 지평선 아래여도 된다).
  expect(viewOf(map)).not.toEqual({ alt: 90, az: 0 });
});

test("Enter를 누르면 맨 위 결과를 고른다", async () => {
  stubSeoulFallback();
  render(<Starmap />);

  await openSearch();
  typeInSearch("뱀");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "별자리 이름" }), { key: "Enter" });

  // "뱀"으로 시작하는 별자리 중 이름이 가장 짧은 뱀자리가 맨 위다.
  expect(await screen.findByRole("dialog", { name: "뱀자리 정보" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "별자리 찾기" })).not.toBeInTheDocument();
});

test("없는 이름이면 찾을 수 없다고 알리고 Enter를 눌러도 아무것도 바뀌지 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  await openSearch();
  typeInSearch("없는이름");
  expect(screen.getByText("찾을 수 없습니다")).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("textbox", { name: "별자리 이름" }), { key: "Enter" });
  expect(screen.getByRole("dialog", { name: "별자리 찾기" })).toBeInTheDocument();
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });

  // 입력을 지우면 안내 문구로 돌아가고 목록이 없다.
  typeInSearch("");
  expect(screen.queryByText("찾을 수 없습니다")).not.toBeInTheDocument();
  expect(screen.getByText("이름의 일부만 써도 찾을 수 있어요.")).toBeInTheDocument();
});

test("찾기 창은 닫기 버튼이나 Esc로 닫히고, 옵션을 열면 찾기 창은 닫힌다", async () => {
  stubSeoulFallback();
  render(<Starmap />);

  await openSearch();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("dialog", { name: "별자리 찾기" })).not.toBeInTheDocument();

  await openSearch();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "별자리 찾기" })).not.toBeInTheDocument();

  await openSearch();
  fireEvent.click(screen.getByRole("button", { name: "옵션" }));
  expect(await screen.findByRole("dialog", { name: "옵션" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "별자리 찾기" })).not.toBeInTheDocument();
});

const AR_DIALOG = { name: "AR 모드 안내" };

// 카메라를 요청하는지 지켜볼 수 있게 getUserMedia를 가진 navigator를 쓴다.
function stubNavigatorWithCamera() {
  const getUserMedia = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });
  return getUserMedia;
}

test("AR 모드 버튼을 누르면 웹에서는 지원하지 않는다는 안내가 뜨고, 확인으로 닫히며, 카메라는 요청하지 않는다", async () => {
  const getUserMedia = stubNavigatorWithCamera();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");
  expect(screen.queryByRole("dialog", AR_DIALOG)).not.toBeInTheDocument();

  fireEvent.click(await screen.findByRole("button", { name: "AR 모드" }));

  const notice = await screen.findByRole("dialog", AR_DIALOG);
  expect(notice).toHaveTextContent("현재는 웹에서는 지원하지 않고");
  expect(notice).toHaveTextContent("모바일 앱에서 지원할 예정");

  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  expect(screen.queryByRole("dialog", AR_DIALOG)).not.toBeInTheDocument();

  // 안내만 할 뿐 카메라를 켜거나 권한을 요청하지 않고, 지도도 바뀌지 않는다.
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(viewOf(map)).toEqual({ alt: 90, az: 0 });
  expect(screen.getByRole("button", { name: "돌리기 모드" })).toHaveAttribute("aria-pressed", "false");
});

test("AR 안내는 Esc로 닫히고, 다른 창을 열면 닫히며, 열려 있는 동안에는 돌리기 안내가 뜨지 않는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);
  const map = await screen.findByLabelText("현재 하늘의 별자리 지도");

  fireEvent.click(await screen.findByRole("button", { name: "AR 모드" }));
  await screen.findByRole("dialog", AR_DIALOG);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", AR_DIALOG)).not.toBeInTheDocument();

  // 열려 있는 동안 지도를 끌어도(1배라 안 움직임) 돌리기 안내는 뜨지 않는다.
  fireEvent.click(screen.getByRole("button", { name: "AR 모드" }));
  await screen.findByRole("dialog", AR_DIALOG);
  dragMapThatCannotMove(map, 1);
  expect(screen.queryByRole("dialog", { name: "하늘 돌리기 안내" })).not.toBeInTheDocument();

  // 옵션을 열면 AR 안내는 닫힌다.
  fireEvent.click(screen.getByRole("button", { name: "옵션" }));
  expect(await screen.findByRole("dialog", { name: "옵션" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", AR_DIALOG)).not.toBeInTheDocument();
});

test("옵션 창은 Esc로 닫힌다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  await clickOptionsButton();
  await screen.findByRole("dialog", { name: "옵션" }, { timeout: 4000 });

  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "옵션" })).not.toBeInTheDocument();
});

test("위치를 얻지 못하면 서울 기준으로 알린다", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
    },
  });

  render(<Starmap />);

  const status = await screen.findByTestId("sky-status");
  expect(status).toHaveTextContent("서울 (위치를 확인하지 못해 기본값 사용)");
  expect(status).toHaveTextContent("북위 37.57° · 동경 126.98°");
});

// 안드로이드 앱(android/)의 뒤로 가기 버튼은 먼저 window.onAndroidBack()을 부른다.
// true면 웹이 처리한 것이고, false면 앱이 닫힌다.
function pressAndroidBack() {
  let handled: boolean | undefined;
  act(() => {
    handled = (window as Window & { onAndroidBack?: () => boolean }).onAndroidBack?.();
  });
  return handled;
}

test("뒤로 가기는 열린 가운데 창부터 닫는다", async () => {
  stubSeoulFallback();
  render(<Starmap />);

  await clickOptionsButton();
  await screen.findByRole("dialog", { name: "옵션" }, { timeout: 4000 });

  expect(pressAndroidBack()).toBe(true);
  expect(screen.queryByRole("dialog", { name: "옵션" })).not.toBeInTheDocument();
});

test("뒤로 가기는 가운데 창이 없으면 별자리 팝업을 닫고, 아무것도 없으면 앱에 넘긴다", async () => {
  stubSeoulFallback();
  render(<Starmap />);

  await openSearch();
  typeInSearch("오리온");
  fireEvent.click(await screen.findByRole("button", { name: /오리온자리/ }));
  await screen.findByRole("dialog", { name: "오리온자리 정보" });

  expect(pressAndroidBack()).toBe(true);
  expect(screen.queryByRole("dialog", { name: "오리온자리 정보" })).not.toBeInTheDocument();

  expect(pressAndroidBack()).toBe(false);
});

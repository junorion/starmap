# AR: 방향 센서가 값을 보내지 않으면 대체 경로로 넘어가지 않음

- **증상:** `AbsoluteOrientationSensor` 가 시작은 되지만 값을 끝내 보내지 않으면(권한 상태나 기기 특성), `deviceorientationabsolute` 이벤트로 넘어가지 않아 3초 뒤 "방향 센서를 쓸 수 없어" 안내가 뜬다. 이벤트 경로로는 동작했을 수 있다.
- **근거:** AR 모드 구현 리뷰(`code-review low`, 2026-10-29)의 지적. `features/starmap/ar-orientation.ts` 는 센서의 `error` 이벤트나 생성 실패 때만 이벤트 경로로 바꾼다. 데스크톱 헤드리스 Chrome 에서는 센서가 오류를 내서 이벤트 경로로 정상 전환됐고, 값이 오지 않는 경우는 재현하지 못했다.
- **스펙 기준:** `docs/specs/ar-mode/spec.md` 가정 "방향은 AbsoluteOrientationSensor 를 먼저 쓰고, 안 되면 deviceorientationabsolute 를 쓴다", 인수 기준 "방향 값을 3초 동안 받지 못하면 … 안내".
- **다음 조치:** 실기기(갤럭시 탭 A8)에서 센서가 있는데도 안내가 뜨면, 시작 후 1초 안에 센서 값이 없을 때 이벤트 경로도 함께 듣도록 바꾼다(센서 값이 오면 그쪽을 우선).

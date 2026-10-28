# AR: 카메라 권한 대화상자 중 두 번째 요청이 오면 앞 요청이 끝나지 않음

- **증상:** 안드로이드 카메라 권한 대화상자가 떠 있는 동안 웹이 카메라를 한 번 더 요청하면, `MainActivity` 의 대기 중인 요청이 새 요청으로 바뀌어 앞 요청은 허용도 거부도 되지 않는다. 그 `getUserMedia` 는 끝나지 않는다.
- **근거:** AR 모드 구현 리뷰(`code-review low`, 2026-10-29)의 지적. `android/app/src/main/java/com/junorion/starmap/MainActivity.java` 의 `onPermissionRequest` 가 `pendingCameraRequest` 를 덮어쓴다. AR 화면은 열릴 때 한 번만 요청하므로 정적 빌드(앱)에서는 재현되지 않았고, 개발 모드(React StrictMode 의 효과 두 번 실행)에서만 두 번 요청할 수 있다.
- **스펙 기준:** 없음(주 경로에서 재현되지 않음).
- **다음 조치:** 새 요청이 오면 대기 중인 앞 요청을 `deny()` 하거나, 대기 요청을 목록으로 두고 권한 결과를 모두에 적용한다.

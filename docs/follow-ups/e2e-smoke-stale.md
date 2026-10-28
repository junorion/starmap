# E2E 스모크 테스트가 Next.js 시작 화면을 기대함

- **증상:** `e2e/smoke.spec.ts` 가 페이지 제목 "Create Next App" 과 "To get started" 제목을 기대한다. 지금 앱의 제목은 "Starmap" 이고 그런 문구가 없어 `bun run test:e2e` 는 실패할 것이다.
- **근거:** 테스트 파일 내용과 `app/layout.tsx` 의 `metadata.title`("Starmap"), `app/page.tsx` 를 비교했다. 이 개발 환경에는 Playwright 브라우저가 없어 실제로 돌려 보지는 않았다. 템플릿 단계에서 남은 테스트로 보인다.
- **스펙 기준:** 없음. 두 스펙 모두 E2E 를 요구하지 않는다.
- **다음 조치:** 앱이 열리면 하늘지도(`aria-label="현재 하늘의 별자리 지도"`)가 보이는지 확인하는 스모크 테스트로 바꾸거나 지운다.

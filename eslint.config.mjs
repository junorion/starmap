import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent skills are vendored copies managed by skills-lock.json, and
    // .claude/worktrees holds duplicate checkouts of this app.
    ".claude/**",
    ".agents/**",
    // android/ 의 빌드 결과에는 out/ 을 복사한 사본이 들어 있다.
    "android/**/build/**",
  ]),
]);

export default eslintConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 없이 out/ 에 정적 파일로 내보낸다. 안드로이드 앱(android/)이 이 결과를 그대로 담는다.
  output: "export",
};

export default nextConfig;

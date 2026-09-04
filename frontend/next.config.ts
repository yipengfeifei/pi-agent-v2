import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: {}, // Next 16 默认 Turbopack：无 turbopack 配置时 webpack 块会硬报错拒启
  // dev 模式下 127.0.0.1 访问时 HMR websocket 不被跨域拦截
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // 打包：FLY 桌面 App 用静态导出（NEXT_OUTPUT=export + 独立 distDir，不碰 dev 的 .next）
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // webpack 模式下 tsconfig 的 @/ paths 别名不自动生效，这里显式注册（webpack-only；Turbopack 原生支持 paths，此块仅 webpack 用）
  webpack: (config) => {
    const root = path.join(process.cwd());
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/": root,
      "@": root,
    };
    return config;
  },
};

export default nextConfig;

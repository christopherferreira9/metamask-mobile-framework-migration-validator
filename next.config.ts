import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/metamask-mobile-framework-migration-validator',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Remove the distDir setting as it's causing confusion
  basePath: process.env.GITHUB_ACTIONS ? '/metamask-mobile-framework-migration-validator' : '',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

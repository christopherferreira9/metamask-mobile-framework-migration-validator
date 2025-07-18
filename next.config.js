/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: process.env.GITHUB_ACTIONS ? '/metamask-mobile-framework-migration-validator' : '',
  reactStrictMode: true,
};

module.exports = nextConfig; 
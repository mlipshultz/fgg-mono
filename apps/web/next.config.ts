import type { NextConfig } from 'next';

// Static export: the site is served from S3 + CloudFront (docs/PLAN.md §3.2).
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@fgg/tokens', '@fgg/types'],
};

export default nextConfig;

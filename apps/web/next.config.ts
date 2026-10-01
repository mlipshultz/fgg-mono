import type { NextConfig } from 'next';

// Static export: the site is served from S3 + CloudFront (docs/PLAN.md §3.2).
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@fgg/tokens', '@fgg/types', '@fgg/game'],
  // Chrome resolves localhost to ::1, which another dev server may own; allow the IPv4 loopback too.
  allowedDevOrigins: ['127.0.0.1'],
  // Don't generate AGENTS.md / CLAUDE.md in apps/web; the repo-level CLAUDE.md is the guide.
  agentRules: false,
};

export default nextConfig;

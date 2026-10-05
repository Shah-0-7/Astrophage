import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config to acknowledge Turbopack usage
  turbopack: {},
  serverExternalPackages: ['pg', 'pg-cloudflare'],
};

export default nextConfig;


import type { NextConfig } from "next";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  /**
   * Proxy /api/* → Go backend so browser calls stay same-origin,
   * avoiding CORS preflight in development.
   */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

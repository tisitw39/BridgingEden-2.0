import type { NextConfig } from "next";
import { MAX_ACTION_BODY } from "./src/lib/limits";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: MAX_ACTION_BODY,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;

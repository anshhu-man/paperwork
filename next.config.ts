import type { NextConfig } from 'next';
import { securityHeadersV1 } from './core/security-headers';

const production = process.env.NODE_ENV === 'production';
const securityHeaders = Object.entries(securityHeadersV1(production))
  .map(([key, value]) => ({ key, value }));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

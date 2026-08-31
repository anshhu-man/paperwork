import { NextResponse } from 'next/server';

import { securityHeadersV1 } from '@/core/security-headers';

export function proxy() {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeadersV1(process.env.NODE_ENV === 'production'))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = { matcher: '/:path*' };

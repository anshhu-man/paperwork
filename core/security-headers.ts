export function securityHeadersV1(production: boolean) {
  const connectSources = production
    ? "connect-src 'self'"
    : "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
    "worker-src 'self' blob:",
    connectSources,
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return Object.freeze({
    'Content-Security-Policy': contentSecurityPolicy,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  });
}

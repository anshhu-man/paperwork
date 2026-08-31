import assert from 'node:assert/strict';
import { test } from 'node:test';

import { securityHeadersV1 } from './security-headers';

test('production security headers deny framing and limit browser capabilities', () => {
  const headers = securityHeadersV1(true);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.doesNotMatch(headers['Content-Security-Policy'], /127\.0\.0\.1/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000');
});

test('local headers permit only explicit loopback model connections', () => {
  const headers = securityHeadersV1(false);
  assert.match(headers['Content-Security-Policy'], /http:\/\/127\.0\.0\.1:\*/);
  assert.match(headers['Content-Security-Policy'], /http:\/\/localhost:\*/);
  assert.equal('Strict-Transport-Security' in headers, false);
});

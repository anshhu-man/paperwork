import { parseModelCouncilCatalogV1 } from '@/core/model-council/v1';
import { getPublicProviderCatalogV1 } from '@/server/model-council/registry';

const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export async function GET() {
  const parsed = parseModelCouncilCatalogV1(getPublicProviderCatalogV1());
  if (!parsed.ok) {
    return new Response(JSON.stringify({ issue: 'Provider catalog validation failed.' }), { status: 503, headers: HEADERS });
  }
  return new Response(JSON.stringify(parsed.value), { status: 200, headers: HEADERS });
}

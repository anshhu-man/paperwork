import { parseModelCouncilCatalogV1 } from '@/core/model-council/v1';
import { getPublicProviderCatalogV1 } from '@/server/model-council/registry';
import { ensureGatewaySchemaV1, loadGatewayDatabaseV1 } from '@/server/document-agent/gateway-admission';
import { checkDocumentGatewayBoundaryV1, documentGatewayModeV1 } from '@/server/document-agent/gateway-config';

const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export async function GET(request: Request) {
  const mode = documentGatewayModeV1();
  const headers = { ...HEADERS, 'x-paperwork-gateway-mode': mode };
  if (mode !== 'disabled') {
    const boundary = checkDocumentGatewayBoundaryV1(request);
    if (!boundary.ok) return new Response(JSON.stringify({ issue: boundary.issue }), { status: boundary.status, headers: { ...HEADERS, 'x-paperwork-gateway-mode': 'disabled' } });
    if (boundary.configuration.mode === 'invite') {
      const database = await loadGatewayDatabaseV1();
      if (!database) return new Response(JSON.stringify({ issue: 'The hosted admission store is unavailable.' }), { status: 503, headers: { ...HEADERS, 'x-paperwork-gateway-mode': 'disabled' } });
      try { await ensureGatewaySchemaV1(database); } catch {
        return new Response(JSON.stringify({ issue: 'The hosted admission store is unavailable.' }), { status: 503, headers: { ...HEADERS, 'x-paperwork-gateway-mode': 'disabled' } });
      }
    }
  }
  const parsed = parseModelCouncilCatalogV1(getPublicProviderCatalogV1(process.env, undefined, 'document_agent'));
  if (!parsed.ok) {
    return new Response(JSON.stringify({ issue: 'Provider catalog validation failed.' }), { status: 503, headers });
  }
  return new Response(JSON.stringify(parsed.value), { status: 200, headers });
}

# Hosting PaperWork safely

PaperWork's first online mode is an **invite-only private beta**, not an
anonymous public model proxy. The original PDF is never uploaded. PDF.js parses
it in the browser, the user sees the exact extracted passages, and only the
approved, digest-bound text is sent through the same-origin PaperWork gateway
to one operator-selected hosted provider.

## Production request path

```text
PDF bytes
  -> browser-only PDF.js extraction
  -> exact passage preview + provider/model/recipient
  -> fresh SHA-256-bound consent
  -> anonymous HTTP-only gateway session
  -> one-use D1-backed run grant bound to request + target + digest
  -> atomic D1 quota, budget, replay and concurrency reservation
  -> PaperWork HTTPS gateway
  -> one fixed hosted provider endpoint
  -> server schema/evidence/receipt validation
  -> independent browser validation
  -> code-owned webpage
```

Ollama is deliberately a different route. It remains available only when
PaperWork itself is served from canonical loopback HTTP, and the browser calls
the exact loopback Ollama origin directly. A public Cloudflare Worker cannot
reach a visitor's `127.0.0.1`, and PaperWork never silently changes an Ollama
selection into a hosted-provider call.

## What D1 stores

The logical `DB` binding is declared in `.openai/hosting.json`, and the schema
migration is in `drizzle/0000_public_gateway_admission.sql`. D1 stores only:

- SHA-256 hashes of anonymous session and one-use grant credentials;
- a random request ID;
- provider, model and recipient configuration;
- the approved payload digest and byte count;
- issue, consent, expiry, consumption and completion timestamps;
- conservative quota/cost units and a short concurrency lease; and
- delivery state such as `completed`, `failed`, or `delivery_unknown`.

D1 never receives PDF bytes, extracted passages, filenames, source
fingerprints, prompts, provider output, raw access passes, raw session/grant
tokens, or raw IP addresses. Sessions and unused grants become eligible for
opportunistic pruning 24 hours after issuance by default; consumed grants use
their later consumption time so rolling quota evidence is not removed early.
That threshold is not a guaranteed deletion deadline: pruning runs during
later session or grant issuance, so a strict deadline requires an
operator-scheduled D1 cleanup job. The hosting platform
may separately create infrastructure logs outside the application boundary.

R2 is intentionally absent because PaperWork does not store document blobs.

## Required hosted values

Configure runtime values and secrets through the hosting service, not in Git:

```dotenv
NODE_ENV=production
NEXT_PUBLIC_SITE_ORIGIN=https://your-exact-production-origin.example
PAPERWORK_DOCUMENT_AGENT_ENABLED=true
PAPERWORK_PUBLIC_GATEWAY_MODE=invite
PAPERWORK_PUBLIC_APP_ORIGIN=https://your-exact-production-origin.example
PAPERWORK_PUBLIC_PROVIDER=openai
PAPERWORK_GATEWAY_ACCESS_TOKEN_SHA256=<sha256-of-a-strong-private-pass>
PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED=true

OPENAI_API_KEY=<restricted-project-key>
OPENAI_MODEL=<exact-model-id>
```

`PAPERWORK_PUBLIC_PROVIDER` accepts one of `openai`, `anthropic`, `mistral`, or
`deepseek`. Configure the matching key and exact model ID. Other configured
providers stay disabled on the public route. OpenAI and Claude are commercial
APIs; hosted Mistral and DeepSeek are metered even when the chosen model is
open-weight.

Generate a random pass locally, give the raw value only to invited testers, and
place only its lowercase SHA-256 digest in the hosted secret. Do not publish the
pass or embed it in the client bundle. `PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED`
is an operator acknowledgement, not technical proof: set it to `true` only
after the provider project has a real hard budget, restricted key and alerts.

The optional quota values documented in `.env.example` have deliberately low
defaults. Cost units use twice the approved payload's UTF-8 size plus fixed
prompt/schema framing and maximum output as a deliberately high admission
bound. They are not the provider's tokenizer or a spend ceiling. The provider's
hard project cap remains essential. Attempted calls are not refunded when
delivery is uncertain. Separate per-session and global grant-issuance limits
also bound expired unused-grant churn before any provider call. Network and
timeout failures are stored and receipted as `delivery_unknown`. If the
completion write itself fails, an expired `in_flight` lease stops counting
toward concurrency and is reconciled to `delivery_unknown` during later
admission cleanup.

## Launch gate

Before sharing the hosted URL:

1. Confirm the exact HTTPS origin and security headers in production.
2. Confirm the `DB` migration exists and D1 admission fails closed when the
   binding is unavailable.
3. Use one restricted provider project/key and set its external hard spend cap.
4. Test the synthetic PDF through session, grant, model, validation and receipt.
5. Verify wrong origins, bad passes, stale consent, changed targets, reused
   grants, quota exhaustion and invalid provider JSON contact no unintended
   provider.
6. If you promise a fixed deletion deadline, schedule the same D1 expiry
   predicates independently instead of relying on traffic-triggered pruning.
7. Tell invitees that extracted text goes to the named provider and that
   provider/host infrastructure retention policies still apply.

For a broadly advertised anonymous launch, add a separately reviewed abuse
layer—such as server-validated bot protection or real identity—plus edge burst
limits. A shared invite pass is intentionally not the final public-auth model.

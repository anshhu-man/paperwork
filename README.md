# PaperWork

PaperWork turns confusing documents, images, and links into clear,
evidence-backed action plans.

This repository currently contains the interactive product prototype. It
demonstrates source staging, an explicit processing receipt, action planning,
claim-level evidence, uncertainty labels, progress tracking, and the privacy
receipt. The AI analysis engine is intentionally not connected yet, and the UI
states that limitation wherever a user could otherwise mistake illustrative
output for a real analysis.

## Product rules

- No important claim without evidence.
- Keep source facts separate from inferences and suggested actions.
- Say "not confirmed" when the sources are insufficient.
- Show where data will go before processing begins.
- Do not store documents by default.
- Never describe an AI interpretation as professional legal, medical, or
  financial advice.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Current architecture

- Next.js-compatible app rendered through Vinext
- React and TypeScript interaction layer
- Tailwind build pipeline with product-specific CSS
- Cloudflare Worker-compatible output through Sites
- No database, object storage, account system, telemetry, or AI API calls

The next engineering milestone is a provider-neutral analysis interface with
local extraction, explicit outbound-data previews, structured evidence output,
and citation validation.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Security and
privacy issues should follow [SECURITY.md](SECURITY.md).

## License

MIT

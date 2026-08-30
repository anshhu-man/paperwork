# Changelog

PaperWork follows [Semantic Versioning](https://semver.org/) once functional releases begin. Until then, changes are recorded under `Unreleased`.

## Unreleased

### Added

- Professional source-staging and sample Action Pack interface.
- Evidence labels for source facts, inferences, suggestions, and unconfirmed claims.
- Visible sample-mode and privacy disclosures.
- Public roadmap, architecture, privacy threat model, contribution templates, and launch kit.
- Strict, versioned Action Pack v1 contracts for canonical sources, model drafts, validated claims, actions, receipts, consent, transfers, and corrections.
- Runtime validation and adversarial contract tests for exact evidence spans, normalized deadline values, claim graphs, action safety attestations, corrections, consent-bound transfers, and event-derived receipts.
- A non-renderable structural transport type that prevents imported or provider-authored validation and receipt claims from being mistaken for trusted PaperWork output.
- Complete browser-local native-text PDF extraction, deterministic offer-letter
  assembly, independent semantic/action/event validation, and private
  identity-based trusted-pack registration.
- A disabled-by-default Model Council for OpenAI, Claude, Mistral, DeepSeek,
  and self-hosted Ollama: exact passage selection, canonical payload digest,
  explicit provider consent, fixed-endpoint server adapters, one strict
  seven-field output contract, field-specific source-value validation, exact
  model/recipient binding, replay rejection, untrusted agreement comparison,
  and a separate transfer receipt. Provider calls require an explicit
  development environment and loopback application origin; all other runtime
  modes fail closed.
- A browser-direct Ollama path restricted to exact HTTP loopback origins, with
  synchronous consent snapshots, no browser credentials/tools/retrieval/PDF
  bytes, bounded output and time, server-side Ollama rejection, and receipts
  that distinguish `browser_to_provider` from `gateway_to_provider`.

### Changed

- The product's Open source action now links directly to the public GitHub repository.
- Updated the React, Vinext, Vite, Cloudflare, Wrangler, and related build dependencies to patched releases with a clean npm security audit.
- Live files and links can no longer be mistaken for the synthetic sample analysis path.

### Not yet available

- OCR, image/link/DOCX ingestion, arbitrary document types, provider-enriched
  trusted Action Packs, accounts, storage, telemetry, public model-gateway
  abuse controls, and public production hosting.

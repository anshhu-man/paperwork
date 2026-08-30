# PaperWork

> Turn a supported PDF into clear next steps—with evidence for every important claim.

[![MIT license](https://img.shields.io/badge/license-MIT-164f3c.svg)](LICENSE)
[![Project status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-a56427.svg)](ROADMAP.md)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-315d70.svg)](CONTRIBUTING.md)

![PaperWork — from confusing paper to clear next steps](public/og.jpg)

PaperWork is an open-source workspace for understanding consequential paperwork. It is being designed to show four things clearly: what the source says, what PaperWork inferred, what it recommends, and where the user's data went.

## Project status

**PaperWork v0.1 performs a narrow, real browser-local analysis.** It accepts
English-language offer letters and structured résumés with selectable text,
extracts every page using a bundled inline PDF worker, creates immutable
page-region segments, applies document-specific deterministic rules, and
renders a plan only after citations, claim semantics, action safety, the event
ledger, and the strict Action Pack contract all pass.

An optional, disabled-by-default **Model Council** can compare the same seven
offer-letter fields across explicitly selected OpenAI, Claude, Mistral,
DeepSeek, and self-hosted Ollama models. It is a separate untrusted review
layer: the user chooses unchanged extracted passages, previews and hashes the
exact logical payload and instruction-profile version, approves named
recipients, and receives only a strict
schema whose citations are rechecked against the transmitted passages. Model
agreement never becomes a trusted source fact and never changes local actions.
Hosted APIs use the disabled-by-default PaperWork gateway; an exact HTTP
loopback Ollama target is contacted directly by the browser and must be run
separately from hosted providers.

PaperWork still does not perform OCR, accept links/images/DOCX, or claim to
analyze arbitrary document types. Scans, password-protected PDFs, partial
extraction, genuinely ambiguous or overprinted text, and unrecognized document
structures are safely withheld instead of producing a guess. Résumé analysis
currently verifies structure and section headings; the model council remains
offer-letter-only until a separate résumé output contract is validated. This is
an early milestone, not professional career, employment, or legal advice.

## What PaperWork will give users

| User question | PaperWork output |
| --- | --- |
| What is this? | A plain-language document identity and purpose |
| Do I need to act? | Urgency, obligations, deadlines, and unresolved items |
| What should I do first? | A prioritized, checkable action plan |
| What proves it? | An exact cited passage or image region for each important claim |
| What is uncertain? | Explicit inference, suggestion, conflict, and unconfirmed labels |
| Where did my data go? | A human-readable processing receipt and technical event log |

## Try it locally

Requirements: Node.js 22.13 or later. Browser analysis requires a current
evergreen browser with module workers, Web Crypto, `structuredClone`, and
`Promise.withResolvers`; PaperWork reports the local extractor as unavailable
before reading file bytes when those capabilities are missing.

```bash
git clone https://github.com/anshhu-man/paperwork.git
cd paperwork
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), choose **Analyze the
synthetic sample**, approve both local operations, and inspect its observed run
receipt. You can then try a compatible PDF. Review the threat model before
using a genuinely sensitive document; browser extensions, the device, and the
host that serves application assets remain outside PaperWork's code boundary.

### Optional model council

The trusted local path requires no provider key. To test provider review in a
self-hosted development environment, copy [`.env.example`](.env.example) to a
local `.env`, set `PAPERWORK_MODEL_COUNCIL_ENABLED=true`, and configure exact
model IDs. Hosted providers also need their server-side API credentials. Local
Ollama needs only an exact loopback origin and an installed model. Never commit
the environment file.

OpenAI and Claude are commercial APIs. Some Mistral and DeepSeek releases are
open-weight, but using their hosted APIs is still metered; Ollama is the
self-hosted path for operator-chosen compatible models. “Open-weight” describes
model licensing, not free compute or a privacy guarantee.

All live review requires `NODE_ENV=development` and a loopback application
origin. Hosted calls go browser → PaperWork gateway → provider; the analysis
route accepts only `localhost`, `127.0.0.1`, or `::1`. Ollama goes browser →
the exact configured `http://localhost[:port]` or
`http://127.0.0.1[:port]`, sends no credential or PDF bytes, bypasses the
gateway, and is selected alone in v1. Missing, test, production, and unexpected
environment values fail closed. Public hosted use first needs real user
authorization, distributed quotas, replay protection, and provider spend caps.

## Non-negotiable product rules

- No important claim without exact evidence.
- Keep source facts separate from inferences and suggested actions.
- Say **Not confirmed** when the supplied sources are insufficient.
- Show the complete data flow before any external transmission.
- Do not store documents by default.
- Never present an AI interpretation as professional legal, medical, or financial advice.

## Architecture and trust

The application uses React, TypeScript, Vinext, and an exact-pinned
`pdfjs-dist` browser worker inlined into the authorization-gated parser module.
It has no database, account system, telemetry, or
object storage. The optional server gateway has fixed provider endpoints,
server-only credentials, no tools, bounded request/response sizes, strict
structured output, source-quote validation, and `no-store` responses.
The browser-direct Ollama adapter accepts only canonical HTTP loopback origins,
omits credentials, tools, retrieval and PDF bytes, caps time and output, and
records the gateway as `not_sent`.

The only renderable domain object is `TrustedActionPackV1`. The public live
entry point accepts a browser `File`; no public operation can mark an imported
pack, model draft, receipt, or self-attested JSON object as trusted. A private
WeakSet registers only the final deep-frozen clone after PaperWork independently
rechecks canonical evidence spans, deterministic claim templates, normalized
dates and money, conflict alternatives, allowlisted manual actions, the
six-event local ledger (two local authorizations, source admission, extraction,
analysis, and validation), and the strict runtime contract. Authorization is
fresh, ordered, bound to a one-use run UUID, and recorded before file reading.
Serialization,
spreading, or cloning removes that identity-based trust.

The Model Council never receives or returns a `TrustedActionPackV1`. Its public
contract has seven nullable, typed offer-letter fields and exact passage
evidence; it has no summary, advice, arbitrary claims, suggested questions, or
generated actions. Each configured provider adapter emits the same contract,
and the browser validates either the gateway result or direct Ollama result
again before rendering it in a separate tab.

Read the contributor-facing [architecture](docs/ARCHITECTURE.md) and [privacy threat model](docs/PRIVACY-THREAT-MODEL.md) before changing the processing boundary. The [roadmap](ROADMAP.md) defines the gates for the first useful release.

## Help build it

Useful next contributions include accessibility reviews, adversarial PDF
fixtures, browser network-isolation tests, safe OCR with source coordinates,
citation evaluation, privacy analysis, translations, dedicated model contracts,
and additional narrowly verified document types.

- Start with an issue labeled [`good first issue`](https://github.com/anshhu-man/paperwork/labels/good%20first%20issue).
- Propose a document type with the structured issue form.
- Use [Discussions](https://github.com/anshhu-man/paperwork/discussions) for questions and early ideas.
- Read [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before contributing.

The prepared [launch kit](docs/LAUNCH-KIT.md) contains faceless demo and community-post templates. Public promotion is intentionally gated on a genuinely usable hosted build.

## License

PaperWork is available under the [MIT License](LICENSE).

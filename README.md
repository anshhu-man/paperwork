# PaperWork

> Turn a supported PDF into clear next steps—with evidence for every important claim.

[![MIT license](https://img.shields.io/badge/license-MIT-164f3c.svg)](LICENSE)
[![Project status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-a56427.svg)](ROADMAP.md)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-315d70.svg)](CONTRIBUTING.md)

![PaperWork — from confusing paper to clear next steps](public/og.jpg)

PaperWork is an open-source workspace for understanding consequential paperwork. It is being designed to show four things clearly: what the source says, what PaperWork inferred, what it recommends, and where the user's data went.

## Project status

**PaperWork v0.1 now uses an LLM-first document agent.** It accepts one PDF with
selectable text, extracts every page locally with a bundled PDF.js worker, and
creates immutable page-addressed passages. PDF.js does not interpret the
document. One model selected by the user classifies it and returns typed facts,
deadlines, source-imposed requirements, conflicts, and bounded suggestion
intents for PaperWork's webpage.

Before any model receives text, PaperWork shows the exact passages, provider,
model, recipient, route, canonical byte count, and SHA-256 digest. A separate,
fresh approval is required to send that reviewed payload. The response must
match a closed, versioned schema and every material value must resolve to an
exact source revision, segment, page, span, and unchanged quote. PaperWork
withholds the entire result when the payload, consent, model identity, response,
receipt, or evidence fails validation. Models return data only; PaperWork owns
all rendered copy and components.

The hosted architecture is an invite-only private beta. It exchanges a strong
access pass for a short-lived anonymous HTTP-only session, issues a one-use run
grant bound to the exact request digest and model target, and atomically applies
D1-backed replay, quota, budget, and concurrency controls before contacting one
operator-selected provider. D1 stores bounded admission metadata only—not PDF
bytes, passages, prompts, filenames, or model output. The localhost build keeps
browser-direct Ollama as a separate path.

The generic contract covers résumés, offers, contracts, invoices, receipts,
forms, letters, legal notices, financial, academic, identity, and medical
documents, with an `other` fallback. This is still an early human-review tool,
not professional legal, medical, financial, career, or employment advice.
PaperWork does not yet perform OCR or accept links, images, or DOCX. Scans,
password-protected PDFs, partial extraction, unsupported model output, and
ambiguous evidence are safely withheld instead of guessed.

## What PaperWork will give users

| User question | PaperWork output |
| --- | --- |
| What is this? | A plain-language document identity and purpose |
| Do I need to act? | Urgency, obligations, deadlines, and unresolved items |
| What should I do first? | A prioritized, checkable action plan |
| What proves it? | An exact cited passage or image region for each important claim |
| What is uncertain? | Explicit inference, suggestion, conflict, and unconfirmed labels |
| Where did my data go? | A human-readable processing and model-transfer receipt |

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

Copy [`.env.example`](.env.example) to `.env.local`, enable the document agent,
and select an installed model. The recommended local starting point is:

```dotenv
PAPERWORK_DOCUMENT_AGENT_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b-instruct
```

Install [Ollama](https://ollama.com), run `ollama pull qwen3:4b-instruct`, then
open [http://localhost:3000](http://localhost:3000). Choose a compatible PDF,
grant local-read permission, inspect the exact model payload, approve that
specific transfer, and run the agent. Review the threat model before using a
genuinely sensitive document; browser extensions, the device, Ollama, any
selected hosted provider, and the host serving application assets remain
outside PaperWork's code boundary.

### Model providers

Local Ollama needs only an exact loopback origin and an installed compatible
model. Hosted OpenAI, Claude, Mistral, and DeepSeek adapters require an exact
model ID plus a server-side API credential. Never commit the environment file.

OpenAI and Claude are commercial APIs. Some Mistral and DeepSeek releases are
open-weight, but using their hosted APIs is still metered; Ollama is the
self-hosted path for operator-chosen compatible models. “Open-weight” describes
model licensing, not free compute or a privacy guarantee.

Local live runs require `NODE_ENV=development` and a loopback application
origin. Hosted private-beta calls go browser → PaperWork gateway → the one
selected provider after an anonymous session and one-use D1 grant. Production
accepts only the configured canonical HTTPS origin and only the single provider
named by the operator. Ollama goes browser →
the exact configured `http://localhost[:port]` or
`http://127.0.0.1[:port]`, sends no credential or PDF bytes, bypasses the
gateway, and is selected alone in v1. Missing, test, production, and unexpected
environment values fail closed unless the complete hosted boundary is present.

See the [hosting runbook](docs/HOSTING.md) for the exact production path,
runtime values, D1 metadata schema, spend-cap requirement, and launch gate. The
raw invite pass and provider keys belong only in hosted secrets and must never
be committed. A shared invite pass is for a bounded beta; broadly anonymous
access still needs a separately reviewed identity/bot and edge-abuse layer.

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
It has no document database, account system, telemetry, or object storage. The
hosted beta uses D1 only for short-lived anonymous admission metadata. The
server gateway has fixed provider endpoints, server-only credentials, one-use
grants, distributed quotas, no tools, bounded request/response sizes, strict
structured output, source-quote validation, and `no-store` responses.
The browser-direct Ollama adapter accepts only canonical HTTP loopback origins,
omits credentials, tools, retrieval and PDF bytes, caps time and output, and
records the gateway as `not_sent`.

The primary contract is `ProviderDocumentAnalysisV1`. It permits only enumerated
document types, field IDs, typed values, exact evidence, source-imposed
requirements, explicit conflicts, and bounded suggestion intents. It forbids
arbitrary prose, HTML, URLs, tools, and executable actions. The browser validates
the provider response again before constructing the code-owned view model and
marks every accepted interpretation as requiring human review.

The earlier deterministic `TrustedActionPackV1` assembler and offer-letter
Model Council remain in the repository for compatibility and regression tests;
they are not the current webpage execution path.

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

The prepared [launch kit](docs/LAUNCH-KIT.md) contains faceless demo and community-post templates. Promote the invite beta only after the [hosting launch gate](docs/HOSTING.md#launch-gate) passes; do not advertise the shared-pass mode as unrestricted anonymous access.

## License

PaperWork is available under the [MIT License](LICENSE).

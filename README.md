# PaperWork

> Turn confusing documents, images, and links into clear next steps—with evidence for every important claim.

[![MIT license](https://img.shields.io/badge/license-MIT-164f3c.svg)](LICENSE)
[![Project status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-a56427.svg)](ROADMAP.md)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-315d70.svg)](CONTRIBUTING.md)

![PaperWork — from confusing paper to clear next steps](public/og.jpg)

PaperWork is an open-source workspace for understanding consequential paperwork. It is being designed to show four things clearly: what the source says, what PaperWork inferred, what it recommends, and where the user's data went.

## Project status

**PaperWork is currently a working sample experience, not a document analyzer.** You can explore upload and link staging, a pre-analysis data-flow receipt, an evidence-backed sample offer-letter plan, source citations, uncertainty labels, and responsive interactions. Selected file contents are not read or transmitted. OCR, AI analysis, citation validation, and production hosting are not connected yet.

That boundary is deliberate: the interface is public now so the community can inspect and shape the trust model before sensitive processing is introduced.

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

Requirements: Node.js 22.13 or later.

```bash
git clone https://github.com/anshhu-man/paperwork.git
cd paperwork
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), choose **Try a sample offer letter**, and inspect the sample Action Pack. Do not use a real confidential document yet; the current build cannot analyze it.

## Non-negotiable product rules

- No important claim without exact evidence.
- Keep source facts separate from inferences and suggested actions.
- Say **Not confirmed** when the supplied sources are insufficient.
- Show the complete data flow before any external transmission.
- Do not store documents by default.
- Never present an AI interpretation as professional legal, medical, or financial advice.

## Architecture and trust

The current application uses React, TypeScript, Vinext, and a Cloudflare Worker-compatible build. It has no database, account system, telemetry, object storage, document parser, or AI API call.

Read the contributor-facing [architecture](docs/ARCHITECTURE.md) and [privacy threat model](docs/PRIVACY-THREAT-MODEL.md) before changing the processing boundary. The [roadmap](ROADMAP.md) defines the gates for the first useful release.

## Help build it

Useful early contributions include accessibility reviews, local PDF extraction, OCR with source coordinates, citation evaluation, privacy analysis, synthetic document fixtures, translations, and research into specific document types.

- Start with an issue labeled [`good first issue`](https://github.com/anshhu-man/paperwork/labels/good%20first%20issue).
- Propose a document type with the structured issue form.
- Use [Discussions](https://github.com/anshhu-man/paperwork/discussions) for questions and early ideas.
- Read [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before contributing.

The prepared [launch kit](docs/LAUNCH-KIT.md) contains faceless demo and community-post templates. Public promotion is intentionally gated on a genuinely usable hosted build.

## License

PaperWork is available under the [MIT License](LICENSE).

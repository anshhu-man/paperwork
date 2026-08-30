# Security policy

PaperWork is designed for documents that may contain sensitive information. Never disclose a vulnerability, exploit, credential, personal data, or private document in a public issue or discussion.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/anshhu-man/paperwork/security/advisories/new). Include the affected version or commit, impact, reproduction steps using synthetic data, and any suggested mitigation. The report is handled through a private repository security advisory rather than a public issue.

Please allow maintainers a reasonable opportunity to investigate before public disclosure. We will acknowledge a report, assess its impact, and coordinate next steps through the private advisory.

## Current security boundary

The current v0.1 build reads compatible PDF bytes only after two explicit local
permissions made in order. The trusted assembler rejects stale, future,
reversed, malformed, and replayed authorization and records both observations
against a one-use run UUID before source admission. It performs bounded
native-text extraction in an exact-pinned,
same-origin browser worker and deterministic offer-letter assembly in the page.
It does not upload selected document content or extracted text to an AI
provider or PaperWork backend. It has no application database, account system,
telemetry, object storage, URL fetcher, OCR service, or document-processing
backend. Hosting infrastructure, normal application-asset requests, browser
extensions, device facilities, and the network used to receive the app remain
outside that application boundary.

Any future OCR, URL fetching, AI call, server-side processing, storage,
telemetry, export, or sharing capability must update the [privacy threat
model](docs/PRIVACY-THREAT-MODEL.md), user-facing data-flow receipt, and
negative transmission tests before release.

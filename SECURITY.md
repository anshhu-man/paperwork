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
The trusted local path does not upload selected document content or extracted
text to an AI provider or PaperWork backend. An optional model-comparison
gateway exists but is disabled by default, requires an explicit development
environment and loopback application origin, and ships with no credentials.
During local adapter testing, the browser sends only explicitly selected,
previewed, digest-bound text passages. Hosted calls go through the gateway to
named providers. An Ollama call instead goes directly from an HTTP loopback
PaperWork page to the exact configured HTTP loopback Ollama origin; it is
selected alone, uses no PaperWork gateway or provider credential, and records
the gateway hop as `not_sent`. The original PDF is never sent. Provider output
is strict, quote-validated, untrusted, and cannot modify the trusted Action
Pack.

PaperWork has no application database, account system, telemetry, object
storage, URL fetcher, or OCR service. Hosting infrastructure, configured model
providers, normal application-asset requests, browser extensions, device
facilities, and the network used to receive the app remain outside the local
application boundary. Missing, test, production, and unexpected environment
values fail closed, and non-loopback analysis requests are rejected. A
future public design must first add real authentication or invite quotas,
distributed rate limits, replay protection, and provider spend caps, then pass
a separate security review.

Browser-direct Ollama accepts only canonical `localhost` or `127.0.0.1` HTTP
origins and omits browser credentials, redirects, referrers, tools, retrieval,
the source fingerprint, and PDF bytes. A network error, cancellation, or
timeout stops PaperWork from waiting but does not prove that the local Ollama
process stopped or discarded a request it already received.

Any future OCR, URL fetching, public model-gateway enablement, persistent
server-side processing, storage, telemetry, export, or sharing capability must
update the [privacy threat model](docs/PRIVACY-THREAT-MODEL.md), user-facing
data-flow receipt, and negative transmission tests before release.

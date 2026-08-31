# Security policy

PaperWork is designed for documents that may contain sensitive information. Never disclose a vulnerability, exploit, credential, personal data, or private document in a public issue or discussion.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/anshhu-man/paperwork/security/advisories/new). Include the affected version or commit, impact, reproduction steps using synthetic data, and any suggested mitigation. The report is handled through a private repository security advisory rather than a public issue.

Please allow maintainers a reasonable opportunity to investigate before public disclosure. We will acknowledge a report, assess its impact, and coordinate next steps through the private advisory.

## Current security boundary

The current v0.1 build reads compatible PDF bytes only after explicit local-read
permission. It performs bounded native-text extraction in an exact-pinned,
bundled inline browser worker and creates canonical page-addressed passages.
The original PDF bytes stay in the browser, but the primary workflow is
LLM-first: extracted passages are deliberately sent to exactly one selected
model after a separate outbound-data approval.

PaperWork pauses after extraction and displays the exact passages, provider,
model, recipient, route, canonical byte count, and SHA-256 digest. A fresh
approval binds the request ID and approval timestamp inside that digest. Hosted
calls go through the PaperWork gateway to the named provider. An Ollama call
instead goes directly from an HTTP loopback PaperWork page to the exact
configured HTTP loopback Ollama origin, uses no PaperWork gateway or provider
credential, and records the gateway hop as `not_sent`.

Document text is always untrusted data, never policy or authorization. Provider
requests have fixed instructions, no tools or retrieval, and a closed output
schema. Provider output cannot supply HTML, JSX, arbitrary URLs, or executable
actions. Before rendering, PaperWork rechecks the response schema, provider and
model identity, consent digest, receipt, source revision, segment, page, span,
unchanged quote, and value-to-evidence binding. A failed invariant withholds the
entire analysis. Passing these checks proves traceability to the approved text,
not that the model interpreted that text correctly; accepted results require
human review.

PaperWork has no document database, account system, telemetry, object storage,
URL fetcher, or OCR service. The hosted invite beta uses D1 only for bounded
admission metadata: hashes of anonymous session/grant credentials, a random
request ID, target configuration, approved payload digest and byte count,
timestamps, conservative cost units, short concurrency leases, and delivery
state. It does not store PDF bytes, passages, filenames, prompts, model output,
raw access passes, raw credentials, or raw IP addresses. The selected model
receives the approved extracted passages and fixed instruction framing, not the original PDF. Hosting
infrastructure, the PaperWork gateway on hosted runs, configured model
providers, normal application-asset requests, browser extensions, device
facilities, and network infrastructure remain separate trust boundaries. Their
operators may retain logs under policies PaperWork cannot verify or delete.
`Cache-Control: no-store` and the application's metadata limits are not proof
of infrastructure-level non-retention.

Missing, test, malformed, and incomplete production values fail closed. Local
analysis requires loopback development. Production requires one exact HTTPS
origin, one explicitly selected hosted provider, a strong invite-pass digest,
a restricted server-only provider key, an operator-confirmed provider hard
spend cap, and the D1 binding. A short-lived `Secure; HttpOnly;
SameSite=Strict` anonymous session is exchanged for a one-use run grant bound
to the request ID, provider/model/recipient, digest, byte count, and consent
time. D1 atomically consumes the grant and reserves per-session/global budget
and concurrency before delivery. Attempts with uncertain delivery are not
refunded.

The application also sends a restrictive CSP, `frame-ancestors 'none'`, HSTS
in production, `nosniff`, no-referrer, cross-origin isolation hints, and a
narrow Permissions Policy. The route requires its configured exact origin and
same-origin browser fetch metadata; these CSRF controls complement rather than
replace the anonymous session and grant.

The shared invite pass is not intended for an unrestricted public launch. A
broadly advertised anonymous service still requires a separately reviewed
identity or bot challenge and edge burst limit. The
`PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED` value records operator intent only;
it cannot verify the provider-side cap.

The browser-direct Ollama recipient accepts only canonical `localhost` or
`127.0.0.1` HTTP origins; the PaperWork page may also use the IPv6 loopback
`[::1]`. The request omits browser credentials, redirects, referrers, tools,
retrieval, the source fingerprint, and PDF bytes. A network error,
cancellation, or timeout stops PaperWork from waiting but does not prove that
the local Ollama process stopped or discarded a request it already received.

Any future OCR, URL fetching, unrestricted public model access, persistent
document processing, storage, telemetry, export, or sharing capability must
update the [privacy threat model](docs/PRIVACY-THREAT-MODEL.md), user-facing
data-flow receipt, and negative transmission tests before release.

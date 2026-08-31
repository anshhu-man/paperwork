# PaperWork privacy threat model

Status: draft for the v0.1 LLM-first document agent and invite-only hosted beta.

This document separates behavior that exists today from intended behavior. A
planned control is not a security or privacy guarantee.

## Current v0.1 boundary

PaperWork reads a selected PDF in the current browser tab only after explicit
local-read permission. It verifies file signature and limits, computes SHA-256,
and sends a private byte copy to a bundled inline `pdfjs-dist` module worker.
Every page must produce meaningful native text. The original PDF bytes remain
in the browser; PDF.js only parses and addresses text, it does not interpret the
document.

The primary workflow deliberately transfers extracted text to exactly one
selected model. PaperWork first stops and displays the exact logical passages,
provider, model, recipient, and route. A separate approval binds the request
ID, approval timestamp, prompt/output-contract versions, source fingerprint,
payload byte count, and SHA-256 digest. Hosted providers are reached through the
PaperWork gateway. An exact HTTP loopback Ollama recipient is reached directly
from the browser, with the gateway recorded as `not_sent`.

The provider receives approved extracted passages and fixed instruction
framing, not original PDF bytes. It must return a closed typed report. PaperWork
then validates schema, response target, receipt, digest, source revision,
segment, page, span, unchanged quote, and value-to-evidence grounding. Invalid,
incomplete, mismatched, or unsupported output is withheld. Accepted output is
rendered only through escaped, code-owned components and remains marked for
human review. Citation matching proves traceability to approved text, not the
correctness of the model's classification or interpretation.

The hosted gateway does not intentionally persist or log document bodies, and
responses use `Cache-Control: no-store`. Invite mode has one application
database purpose: D1 stores short-lived admission metadata—hashed anonymous
session and grant credentials, random request ID, exact target, approved payload
digest and byte count, timestamps, conservative cost units, lease, and delivery
state. It does not store PDF bytes, passages, filenames, source fingerprints,
prompts, model output, raw passes/tokens, or raw IP addresses. Records become
eligible for opportunistic pruning after 24 hours by default. This is not a
guaranteed deletion deadline without an operator-scheduled D1 cleanup job.

These controls do not prove that provider, gateway-host, or network
infrastructure retained nothing. Their logs, retention, training controls, and
deletion capabilities are governed by their operators. There is no document
store, object store, account system, telemetry integration, URL fetcher, or OCR
service. Page state remains in memory for the current lifecycle, and PaperWork
does not claim independently verifiable memory deletion.

The host still serves the application and may receive ordinary web-request
metadata such as an IP address, user agent, requested path, and time. Browser
extensions, browser history, caches, operating-system facilities, and hosting
infrastructure are outside PaperWork's application-level controls. The current
UI does not create a verifiable deletion record.

### Current data flow

```text
Application assets: hosting service -> browser
                                   (ordinary request metadata may exist)

Selected PDF -> browser-local signature/limit checks
             -> browser-local PDF.js extraction
             -> canonical segments + source fingerprint

Nothing sent yet
  -> user inspects exact logical payload
  -> user approves one named provider/model/recipient
  -> request ID + approval time + contracts + payload are SHA-256 bound

Approved extracted passages
       hosted: anonymous HTTP-only session
               -> one-use request/target/digest grant
               -> atomic D1 quota/budget/concurrency reservation
               -> PaperWork model gateway -> fixed provider endpoint
       local:  browser -> exact HTTP loopback Ollama origin
               PaperWork model gateway -X-> not sent
  -> closed ProviderDocumentAnalysisV1
  -> schema + revision + segment + page + span + quote validation
  -> response + receipt + target + digest validation
  -> code-owned webpage, human review required

Original PDF bytes -X-> never enter the provider path
Provider output    -X-> cannot author UI, execute actions, or bypass validation
```

Current trust boundaries are the user's device and browser, the served
application code and dependencies, and the hosting/CDN layer used to deliver
that code. A hosted run adds the PaperWork gateway, metadata-only D1 admission
store, and the one explicitly selected hosted provider. Direct Ollama instead adds the exact loopback Ollama
process without adding the gateway to the document-text path.
The self-host operator controls credentials, logs, retention, and compute.
PaperWork does not control the user's browser extensions, device,
network, provider infrastructure, or infrastructure-level logs.

## Assets to protect now and in future modes

- Original file bytes, images, links, and document metadata.
- Extracted text, OCR output, page images, and source coordinates.
- Names, identifiers, financial, health, legal, employment, and other sensitive
  content found in sources.
- Questions, corrections, notes, action completion, and generated results.
- Provider credentials and local-model configuration.
- Analysis receipts, which may themselves reveal sensitive metadata.

## Current trust boundaries and planned modes

Native-text PDF parsing is local. Interpretation is performed by one selected
model after payload preview and approval. Hosted models use the gateway;
loopback Ollama is browser-direct. OCR, URL fetching, persistence, analytics,
exports, and sharing remain design targets rather than current behavior:

```text
source
  -> ingestion and type/size checks
  -> browser-local native-text extraction (implemented) or isolated OCR (planned)
  -> normalized, addressable source segments
  -> outbound-data preview and explicit user choice
  -> one selected provider/model/recipient
  -> closed typed findings, requirements, conflicts and suggestion intents
  -> schema, citation, value, target, consent and receipt validation
  -> code-owned document view and transfer receipt
```

Each arrow is a trust boundary that must have an explicit data contract. Before
shipping a processing mode, the product must state where each stage runs,
exactly what crosses the network, who receives it, what is retained, and how a
user can remove it. "Local," "encrypted," "not retained," and "deleted" must
not appear as product promises until they are implemented and testable.

## Primary risks and required mitigations

| Risk | Required mitigation before production |
| --- | --- |
| Stale consent or payload mutation | Put request ID and approval time inside the canonical payload digest; require a fresh preview and approval whenever source passages, contracts, or provider target change. |
| Wrong provider, model, or recipient | Bind one exact target into consent and recheck it immediately before transfer and again when validating the response receipt. |
| A model cites unrelated text | Require exact revision, segment, page, span, and unchanged quote; bind each normalized value to one evidence item and withhold the full result on mismatch. |
| Synthetic output is mistaken for a private-document run | Label the sample PDF, recognize its immutable byte digest even after re-upload, process it through the same real local pipeline, emit `sample_fixture` provenance, and derive the receipt from observed events rather than fixture assurances. |
| A sensitive source is transmitted unexpectedly | Default to no transfer; show the destination and exact outbound payload before consent; make the action button name the transfer. |
| A local-model URL is deceptive or becomes an internal-network fetch primitive | Permit browser-direct inference only from an HTTP loopback PaperWork page to an exact canonical HTTP `localhost` or `127.0.0.1` Ollama origin; reject aliases, suffix hosts, credentials, paths, queries, fragments, HTTPS and IPv6; never route Ollama through the server gateway. |
| A provider retains or trains on content | Display the provider, exact operator-selected model, access type, and separately attributed policy before transfer; minimize the payload; never imply PaperWork controls a provider's systems. Hosted DeepSeek is disclosed particularly conservatively. |
| A document contains prompt injection | Treat document text as untrusted data, never as system instructions; deny document-triggered tools or network calls; validate model output independently. |
| A pasted URL targets internal services or hostile content | Isolate fetching; block private/link-local destinations and non-approved schemes; limit redirects, size, time, and content types; never send browser credentials. |
| A parser or OCR library is exploited | Run untrusted parsing with least privilege and resource limits; validate file signatures; cap pages, pixels, archive expansion, and processing time; patch dependencies. |
| Temporary data or logs expose source content | Do not log source content by default; keep secrets out of URLs and errors; document every storage location and lifetime; test cleanup paths. |
| Generated advice is unsupported or misleading | Require structured claims, source anchors, and citation validation; block or downgrade unsupported claims; keep professional-advice warnings specific and visible. |
| A provider self-attests its own citations, safety checks, or receipt | Treat provider JSON as untrusted transport; independently validate the closed schema, source evidence, value grounding, target, consent, and receipt before constructing renderable output. |
| Citations point to the wrong passage | Preserve page/region/character anchors; verify that cited text supports each claim; allow OCR correction and revalidation. |
| Data leaks between users or sessions | Isolate sessions and caches; use unpredictable identifiers; authorize every read; add cross-tenant tests before introducing persistence. |
| Credentials are exposed | Keep provider keys out of source control, client bundles, logs, payload previews, and receipts; use scoped server secrets and clear self-host-operator boundaries. |
| Public callers drain hosted-model spend | Production enables only an invite mode with an exact HTTPS origin, strong access-pass digest, short-lived anonymous HTTP-only session, one-use target/digest-bound D1 grant, atomic per-session/global request and cost-unit limits, a global concurrency lease, one public provider, server-only key, and operator-confirmed provider hard spend cap. A shared pass is not sufficient for a broadly anonymous launch; add a separately reviewed bot/identity and edge burst boundary first. |
| A timeout is mistaken for proof that processing stopped | State only that PaperWork stopped waiting; a provider or local Ollama process may continue after receiving the request. Record the attempted hop and do not claim deletion or non-delivery. |
| A receipt overstates deletion | Record only observed events; use precise states such as `not stored`, `deletion requested`, `provider reported deletion`, or `status unavailable`; do not claim cryptographic or independent verification without it. |
| Shared/exported results reveal sensitive data | Preview exports, support redaction, warn that receipts contain metadata, and never publish a document analysis by default. |
| Dependencies or releases are compromised | Pin and review dependencies, scan releases, publish provenance where available, and maintain a private vulnerability-reporting path. |

## Legacy retained boundary

The repository retains the zero-transfer deterministic `TrustedActionPackV1`
assembler and the multi-provider offer-letter Model Council for compatibility
and regression tests. They are not the current primary webpage path; older
references to their receipt or authority model apply only to that retained
code.

## Evidence and interpretation policy

Evidence labels describe provenance, not truth or professional certainty:

- **From your source**: the source directly states the claim. The source may
  still be outdated, incomplete, or wrong.
- **PaperWork inference**: a conclusion derived from cited source facts. It must
  include a concise rationale.
- **Suggested next step**: PaperWork's recommendation, not a requirement stated
  by the source.
- **Not confirmed**: PaperWork did not establish the claim from the supported
  extraction and rules. This is not proof that the source is silent.
- **Conflict found**: cited sources disagree or cannot be reconciled.

Every material date, amount, eligibility condition, obligation, risk, and
action must carry one of these labels. A sentence must not silently combine a
source fact with an inference or recommendation. Percentage confidence must not
substitute for evidence.

## Current document-agent receipt and legacy receipt

The primary browser modal is projected from a validated
`DocumentAgentResponseV1`. It records the exact selected provider, returned
model identity, recipient, gateway/provider routes and states, approved payload
digest and byte count, consent and completion times, attributed provider-policy
disclosure, and schema/source-span validation. The browser validates it again
before rendering.

The retained legacy TrustedActionPack receipt is instead projected from its
observed event ledger and records the two run-bound local authorizations, zero
transfers, parser/validator versions, and browser-retention status. Future
provider and persistence receipts must also include:

- Source identifiers and privacy-preserving fingerprints, not source contents.
- Processing time, mode, and execution locations.
- Parsers, OCR tools, prompt/template versions, model, and provider used.
- The categories and exact preview/hash of content sent to each recipient.
- Redactions and external references used.
- Claim counts by evidence label and validation outcome.
- Retention settings and deletion status, with the party making each assertion.
- User corrections and the results invalidated or regenerated by them.

Receipts must distinguish application observations from provider statements.
They must be optional to export, because even filenames, hashes, timestamps,
and provider details can be sensitive.

## Release gates for real processing

Before any OCR, URL fetching, public model gateway, persistent server-side
document processing, storage, analytics, export, or sharing feature is enabled:

1. Update this threat model and the user-facing data-flow disclosure.
2. Add tests that prove what is and is not transmitted.
3. Add abuse limits, parser/fetch isolation, and citation validation.
   Structural schema validation alone does not satisfy this gate.
4. Document retention for PaperWork and every external processor.
5. Provide a payload preview and explicit consent for external transfer.
6. Complete a security review covering the newly introduced trust boundaries.

Security reports should follow the repository's `SECURITY.md` instructions.

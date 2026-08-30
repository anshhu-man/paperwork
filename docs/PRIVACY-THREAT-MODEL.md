# PaperWork privacy threat model

Status: draft for the v0.1 browser-local PDF milestone and planned extensions.

This document separates behavior that exists today from intended behavior. A
planned control is not a security or privacy guarantee.

## Current v0.1 boundary

PaperWork now has one narrow real-processing mode. After two explicit local
permissions, it reads a selected PDF in the current browser tab, verifies its
file signature and limits, computes SHA-256, and sends a private byte copy to a
same-origin bundled `pdfjs-dist` module worker. Every page must produce
meaningful native text. PaperWork then runs deterministic English offer-letter
rules, independent semantic/citation/action/event checks, and renders only a
privately registered `TrustedActionPackV1`.

No selected PDF bytes or extracted text are sent to an AI provider or
PaperWork document-processing server. There is no application database,
object store, account system, telemetry integration, URL fetcher, OCR service,
or AI integration in this repository. The file, extracted segments, trusted
pack, and task state remain in page memory for the current lifecycle. The app
does not claim independently verifiable memory deletion; its receipt therefore
uses the conservative browser state `status_unavailable`.

The synthetic sample is a real two-page PDF served as a normal application
asset and then passed through the same browser-local extraction and trust path.
It is not pre-trusted result JSON. Its exact SHA-256 digest is recognized by the
trusted assembler, so manually re-uploading identical bytes still produces a
`sample_fixture` result with a do-not-submit action rather than a live-offer
action.

The host still serves the application and may receive ordinary web-request
metadata such as an IP address, user agent, requested path, and time. Browser
extensions, browser history, caches, operating-system facilities, and hosting
infrastructure are outside PaperWork's application-level controls. The current
UI does not create a verifiable deletion record.

### Current data flow

```text
Application assets: hosting service -> browser
                                   (ordinary request metadata may exist)

Selected PDF: user -> browser file input -> explicit local permission
                   -> fresh, ordered, one-use authorization ledger
                   -> byte signature/limits/SHA-256
                   -> same-origin local PDF worker
                   -> immutable page-region source segments
                   -> deterministic offer-letter rules
                   -> independent semantic/action/event validation
                   -> private trusted-pack registration -> result UI

Document content -X-> no AI provider, PaperWork processing server, telemetry,
                      database, object storage, URL fetch, or external knowledge
```

Current trust boundaries are the user's device and browser, the served
application code and dependencies, and the hosting/CDN layer used to deliver
that code. PaperWork does not control the user's browser extensions, device,
network, or infrastructure-level logs.

## Assets to protect now and in future modes

- Original file bytes, images, links, and document metadata.
- Extracted text, OCR output, page images, and source coordinates.
- Names, identifiers, financial, health, legal, employment, and other sensitive
  content found in sources.
- Questions, corrections, notes, action completion, and generated results.
- Provider credentials and local-model configuration.
- Analysis receipts, which may themselves reveal sensitive metadata.

## Current trust boundaries and planned modes

The native-text PDF path through trusted assembly is implemented locally. OCR,
provider calls, server processing, persistence, analytics, exports, and sharing
remain design targets rather than current behavior:

```text
source
  -> ingestion and type/size checks
  -> browser-local native-text extraction (implemented) or isolated OCR (planned)
  -> normalized, addressable source segments
  -> outbound-data preview and explicit user choice
  -> deterministic local rules (implemented) or optional model/provider boundary (planned)
  -> structured claims and actions
  -> citation and policy validation
  -> trusted-ledger assembly
  -> Action Pack and analysis receipt
```

Each arrow is a trust boundary that must have an explicit data contract. Before
shipping a processing mode, the product must state where each stage runs,
exactly what crosses the network, who receives it, what is retained, and how a
user can remove it. "Local," "encrypted," "not retained," and "deleted" must
not appear as product promises until they are implemented and testable.

## Primary risks and required mitigations

| Risk | Required mitigation before production |
| --- | --- |
| Synthetic output is mistaken for a private-document run | Label the sample PDF, recognize its immutable byte digest even after re-upload, process it through the same real local pipeline, emit `sample_fixture` provenance, and derive the receipt from observed events rather than fixture assurances. |
| A sensitive source is transmitted unexpectedly | Default to no transfer; show the destination and exact outbound payload before consent; make the action button name the transfer. |
| A provider retains or trains on content | Display the provider, model, applicable retention/training terms, and configuration before transfer; minimize the payload; never imply PaperWork controls a provider's systems. |
| A document contains prompt injection | Treat document text as untrusted data, never as system instructions; deny document-triggered tools or network calls; validate model output independently. |
| A pasted URL targets internal services or hostile content | Isolate fetching; block private/link-local destinations and non-approved schemes; limit redirects, size, time, and content types; never send browser credentials. |
| A parser or OCR library is exploited | Run untrusted parsing with least privilege and resource limits; validate file signatures; cap pages, pixels, archive expansion, and processing time; patch dependencies. |
| Temporary data or logs expose source content | Do not log source content by default; keep secrets out of URLs and errors; document every storage location and lifetime; test cleanup paths. |
| Generated advice is unsupported or misleading | Require structured claims, source anchors, and citation validation; block or downgrade unsupported claims; keep professional-advice warnings specific and visible. |
| A provider self-attests its own citations, safety checks, or receipt | Treat provider and imported Action Pack JSON as structural transport only; assemble renderable output exclusively from separately trusted source, semantic-validation, action-safety, and event ledgers. |
| Citations point to the wrong passage | Preserve page/region/character anchors; verify that cited text supports each claim; allow OCR correction and revalidation. |
| Data leaks between users or sessions | Isolate sessions and caches; use unpredictable identifiers; authorize every read; add cross-tenant tests before introducing persistence. |
| Credentials are exposed | Keep provider keys out of source control, client bundles, logs, and receipts; use scoped secrets and clear bring-your-own-key boundaries. |
| A receipt overstates deletion | Record only observed events; use precise states such as `not stored`, `deletion requested`, `provider reported deletion`, or `status unavailable`; do not claim cryptographic or independent verification without it. |
| Shared/exported results reveal sensitive data | Preview exports, support redaction, warn that receipts contain metadata, and never publish an Action Pack by default. |
| Dependencies or releases are compromised | Pin and review dependencies, scan releases, publish provenance where available, and maintain a private vulnerability-reporting path. |

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

## Current local receipt and planned extensions

The current browser-local modal is projected from the trusted pack's observed
event ledger. It includes processing mode, parser and validator versions,
completion time, the two run-bound local authorization observations, validation
counts, zero transfer records, and a conservative
browser-retention state. Future provider and persistence receipts must also
include:

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

Before any OCR, URL fetching, model call, server-side document processing,
storage, analytics, export, or sharing feature is enabled:

1. Update this threat model and the user-facing data-flow disclosure.
2. Add tests that prove what is and is not transmitted.
3. Add abuse limits, parser/fetch isolation, and citation validation.
   Structural schema validation alone does not satisfy this gate.
4. Document retention for PaperWork and every external processor.
5. Provide a payload preview and explicit consent for external transfer.
6. Complete a security review covering the newly introduced trust boundaries.

Security reports should follow the repository's `SECURITY.md` instructions.

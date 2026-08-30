# PaperWork privacy threat model

Status: draft for the current prototype and its planned analysis system.

This document separates behavior that exists today from intended behavior. A
planned control is not a security or privacy guarantee.

## Current prototype

PaperWork is currently a sample-only frontend. Selecting a file gives the UI
its name, MIME type, and size. The application does not read the file bytes,
parse the document, perform OCR, upload the file, or send it to an AI provider.
A pasted link is kept in page state for display; PaperWork does not fetch it.

The progress sequence, Action Pack, citations, follow-up answer, evidence
counts, and transparency receipt are prepared sample content. They are not the
result of inspecting the selected source. There is no application database,
object store, account system, telemetry integration, or AI integration in this
repository.

The host still serves the application and may receive ordinary web-request
metadata such as an IP address, user agent, requested path, and time. Browser
extensions, browser history, caches, operating-system facilities, and hosting
infrastructure are outside PaperWork's application-level controls. The current
UI does not create a verifiable deletion record.

### Current data flow

```text
Application assets: hosting service -> browser
                                   (ordinary request metadata may exist)

Selected file: user -> browser file input
                     -> UI reads name, type, and size only
                     -X-> no parser, PaperWork backend, or AI provider

Pasted URL: user -> in-page React state -> displayed by the sample UI
                                      -X-> no URL fetch

Result: bundled sample fixtures -> browser UI
```

Current trust boundaries are the user's device and browser, the served
application code and dependencies, and the hosting/CDN layer used to deliver
that code. PaperWork does not control the user's browser extensions, device,
network, or infrastructure-level logs.

## Assets to protect in a future analysis system

- Original file bytes, images, links, and document metadata.
- Extracted text, OCR output, page images, and source coordinates.
- Names, identifiers, financial, health, legal, employment, and other sensitive
  content found in sources.
- Questions, corrections, notes, action completion, and generated results.
- Provider credentials and local-model configuration.
- Analysis receipts, which may themselves reveal sensitive metadata.

## Planned data flow and trust boundaries

The following is a design target, not implemented behavior:

```text
source
  -> ingestion and type/size checks
  -> isolated extraction or OCR
  -> normalized, addressable source segments
  -> outbound-data preview and explicit user choice
  -> optional model/provider boundary
  -> structured claims and actions
  -> citation and policy validation
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
| Sample output is mistaken for real analysis | Keep the sample banner visible throughout the result; never derive a user-specific-looking result from an unread source; test this disclosure. |
| A sensitive source is transmitted unexpectedly | Default to no transfer; show the destination and exact outbound payload before consent; make the action button name the transfer. |
| A provider retains or trains on content | Display the provider, model, applicable retention/training terms, and configuration before transfer; minimize the payload; never imply PaperWork controls a provider's systems. |
| A document contains prompt injection | Treat document text as untrusted data, never as system instructions; deny document-triggered tools or network calls; validate model output independently. |
| A pasted URL targets internal services or hostile content | Isolate fetching; block private/link-local destinations and non-approved schemes; limit redirects, size, time, and content types; never send browser credentials. |
| A parser or OCR library is exploited | Run untrusted parsing with least privilege and resource limits; validate file signatures; cap pages, pixels, archive expansion, and processing time; patch dependencies. |
| Temporary data or logs expose source content | Do not log source content by default; keep secrets out of URLs and errors; document every storage location and lifetime; test cleanup paths. |
| Generated advice is unsupported or misleading | Require structured claims, source anchors, and citation validation; block or downgrade unsupported claims; keep professional-advice warnings specific and visible. |
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
- **Not confirmed**: the supplied sources do not establish the claim.
- **Conflict found**: cited sources disagree or cannot be reconciled.

Every material date, amount, eligibility condition, obligation, risk, and
action must carry one of these labels. A sentence must not silently combine a
source fact with an inference or recommendation. Percentage confidence must not
substitute for evidence.

## Planned analysis receipt

The current modal is illustrative; it is not generated from an audit log. A
future receipt should be produced from observed processing events and include:

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

Before any source parsing, URL fetching, model call, storage, analytics, or
sharing feature is enabled:

1. Update this threat model and the user-facing data-flow disclosure.
2. Add tests that prove what is and is not transmitted.
3. Add abuse limits, parser/fetch isolation, and citation validation.
4. Document retention for PaperWork and every external processor.
5. Provide a payload preview and explicit consent for external transfer.
6. Complete a security review covering the newly introduced trust boundaries.

Security reports should follow the repository's `SECURITY.md` instructions.

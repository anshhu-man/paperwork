# PaperWork architecture

PaperWork aims to turn supplied sources into an evidence-backed Action Pack
while showing users what came from a source, what was inferred, what is only a
suggestion, and where their data went.

This document describes the implemented v0.1 browser-local PDF path, the
disabled-by-default provider comparison path, the v1 trust contracts, and later
production boundaries. Sections marked **Planned** are not implemented.

## What exists today

The repository contains one interactive React/TypeScript application. It is a
Next.js-compatible build using Vinext and Vite and is prepared for Cloudflare
Worker-compatible hosting.

| Capability | Current behavior |
| --- | --- |
| File input | Accepts one PDF up to 10 MB. MIME and extension are advisory; the extractor checks `%PDF-` bytes before parsing. |
| Permission | Reads no bytes until the user authorizes local text extraction and then local Action Pack assembly. Fresh ordered timestamps are bound to a one-use run UUID and retained as the first two receipt events. |
| Extraction | Exact-pinned `pdfjs-dist` runs in a same-origin module worker. All pages must yield meaningful native text; scans and partial results are withheld. |
| Canonical source | Computes SHA-256 from the bytes and creates immutable line segments with page-region anchors and extraction provenance. |
| Trusted analysis | Deterministic English offer-letter rules recognize explicit role, deadline, start date, salary, location, and probation terms. No model or external knowledge enters the trusted Action Pack. |
| Optional model review | After a trusted local result, users may select unchanged passages and configured OpenAI, Anthropic, Mistral, DeepSeek, or Ollama recipients. Exact payload preview, digest-bound consent, uniform structured output, duplicate quote checks, and a separate receipt are implemented. Hosted APIs use the disabled-by-default gateway; loopback Ollama is browser-direct and selected alone. |
| Results | The UI accepts only a privately registered `TrustedActionPackV1`; source facts, conflicts, unknowns, and suggestions remain distinct. |
| Transparency receipt | Projects completed local events, components, validation counts, transfer records, and conservative retention state from the trusted pack. |
| State | React component memory only. Task completion and other state disappear when the page lifecycle ends or reloads. |
| External systems | No provider credentials are shipped. A fixed-endpoint hosted-provider gateway is present but disabled by default. Browser-direct Ollama accepts only an exact HTTP loopback origin. There is no application database, object storage, account service, or telemetry integration. |

The host must still deliver HTML, JavaScript, CSS, fonts, and images. That
ordinary web traffic is distinct from document processing and may create
infrastructure logs outside this repository.

### Current component flow

```text
app/page.tsx
  ├─ PDF selection and explicit local permissions
  ├─ observed extraction/assembly progress and cancellation
  ├─ trusted Action Pack view model
  ├─ exact evidence, plan, source, failure, and receipt views
  └─ synthetic PDF entry point and public-repository link

app/model-council.tsx
  ├─ provider catalog, passage selection, exact payload preview and consent
  └─ separately labelled provider comparison and transfer receipt

core/local-analysis/v1/pdf.ts
  ├─ byte admission, fingerprint, limits, worker lifecycle
  └─ complete native-text extraction and canonical segments

core/action-pack/v1/trusted-assembler.ts
  ├─ deterministic offer-letter rules and independent checks
  ├─ observed event/receipt construction and final authority gate
  └─ private identity-based trust registration

core/model-council/v1
  ├─ one strict seven-field provider output schema
  ├─ canonical payload/digest and runtime parsers
  ├─ exact source-quote validation and untrusted agreement comparison
  └─ browser-direct, exact-loopback Ollama transport

server/model-council + app/api/model-council
  ├─ fixed provider registry and server-only credentials
  ├─ no-tool hosted structured-output adapters with bounded responses
  ├─ same-origin, no-store catalog and hosted analysis gateway
  └─ fail-closed rejection of Ollama on the server path

app/globals.css       product styling
app/layout.tsx        application shell and metadata
vite.config.ts        Vinext, Sites, and Cloudflare build integration
next.config.ts        Next-compatible configuration
```

The repository includes strict, versioned runtime contracts for canonical
sources, model drafts, validated analyses, Action Packs, processing events,
consent, transfers, corrections, and receipts in `core/action-pack/v1`. It also
includes the narrow local PDF extractor, trusted offer-letter assembler, and
optional model-comparison contracts/adapters. It does not include OCR, URL
ingestion, persistence, public gateway abuse controls, or provider-authored
trusted-pack assembly.

## Architectural invariants

Future contributions should preserve these rules:

1. No material claim without an evidence status.
2. Source facts, inferences, recommendations, conflicts, and unknowns remain
   distinct data types and distinct user-facing labels.
3. Document content is untrusted input and cannot change system policy or
   authorize tools, fetching, storage, or sharing.
4. No external transfer occurs before the user sees its destination and
   payload and explicitly chooses it.
5. Receipts report observed events and attributed provider statements, never
   invented assurances.
6. A failed validator produces a blocked or downgraded claim, not an uncited
   confident answer.
7. Adding persistence, telemetry, an AI provider, or an external source changes
   the threat model and requires updated disclosures and tests.

## Current local pipeline, optional comparison, and planned extensions

The browser-local PDF branch through the trusted Action Pack UI is implemented.
The optional provider-comparison branch, payload preview and consent UI are
implemented but disabled by default. Images, links, OCR, provider-enriched
trusted packs, persistence, and sharing remain planned extensions:

```text
[Source adapters]
 PDF file (implemented) | images and links (planned)
          |
          v
[Ingestion policy]
 type, signature, size, page and URL safety checks
          |
          v
[Local native-text extraction | isolated OCR planned]
          |
          v
[Normalized source model]
 immutable segments + page/region anchors + fingerprints
          |
          +------------------------+
          |                        |
          v                        v
[Consent/payload preview]     [Evidence view]
  (optional, implemented)       (implemented)
          |
          v
[Deterministic local rules] + [separate provider-neutral comparison]
          |
          v
[Structured claim graph]
          |
          v
[Citation and policy validator]
          |
          +------------------------+
          |                        |
          v                        v
[Action Pack UI]          [Event-derived analysis receipt]
```

The trusted v0.1 path runs extraction and deterministic analysis in the
browser. Optional hosted requests cross the PaperWork gateway and then the
explicitly selected provider. An Ollama request goes directly from an HTTP
loopback page to the exact consented HTTP loopback Ollama origin, bypasses the
gateway, and cannot be mixed with hosted providers in v1. Neither comparison
path can modify the trusted Action Pack. Future desktop or provider-enriched
Action Pack modes must document their real execution location and network path.

## Implemented v1 domain contracts

The `core/action-pack/v1` module keeps transport and provider details outside
the evidence model and rejects malformed or over-privileged data at runtime.
Its boundary is:

```text
untrusted provider response
        |
        v
strict ModelDraftV1 parser
        |
        v
PaperWork validation + canonical source/event ledgers
        |
        v
strict ActionPackV1 parser
        |
        v
structurally valid transport data
        |
        v
trusted local assembler + final authority gate
        |
        v
TrustedActionPackV1 -> renderable domain data
```

The current model council may propose only seven typed, nullable offer-letter
fields with exact evidence: role, acceptance deadline, start date, annual base
salary, work location, probation, and a source-stated action requirement. It
cannot author a summary, arbitrary claims, actions, questions, canonical source
records, validation attestations, consent, transfer history, retention status,
corrections, or an Action Pack. Unknown fields are rejected rather than
ignored. Structural parsing never turns external JSON into trusted render
input. The implemented assembler registers only the final deep-frozen local
pack after independent semantic-support, action-safety, canonical-source, and
event-ledger checks. No registration primitive is exported.

- `SourceDescriptor`: user-visible identity, media type, size, origin, and a
  source fingerprint.
- `SourceSegment`: immutable extracted content with page, paragraph, character,
  or image-region coordinates and extraction provenance.
- `EvidenceRef`: one or more segment identifiers plus the exact supporting
  span.
- `Claim`: statement, typed dates/amounts/durations, evidence status, evidence
  references, concise rationale, and citation/semantic validation state.
- `Action`: user task, priority, due date, consequence, required inputs, and the
  claim or suggestion that justifies it, plus basis/timing/safety validation.
- `ActionPack`: brief, facts, actions, risks, missing information, conflicts,
  questions, and source manifest.
- `ProcessingEvent`: timestamped observation emitted by a real pipeline stage.
- `AnalysisReceipt`: a projection of processing events, transfer disclosures,
  versions, validation results, and attributed retention/deletion states.

The v1 schemas are fixed to `1.0.0`, validate every object strictly, clone and
deep-freeze accepted input, and model corrections as append-only revisions.
Later schema changes require explicit migration followed by full revalidation.

## Evidence lifecycle

1. Extraction creates addressable, immutable source segments.
2. Analysis returns structured claims and referenced segment identifiers.
3. Validation confirms that references exist and that quoted spans match.
4. A support check classifies each claim:
   - **From your source**: directly stated.
   - **PaperWork inference**: derived from cited facts, with rationale.
   - **Suggested next step**: recommended by PaperWork, not imposed by source.
   - **Not confirmed**: insufficient evidence.
   - **Conflict found**: sources disagree.
5. The UI renders the label in text and iconography, not color alone, and opens
   the exact supporting passage or image region.
6. Corrections invalidate dependent claims and actions before regeneration.

"From your source" means provenance, not that the source is correct or current.
External knowledge, if later supported, must be opt-in and cited separately
from user-supplied material.

## Implemented optional provider-comparison boundary

Provider adapters accept only an explicit, reviewable payload and return one
versioned structured response. Before a request, the UI displays:

- Which exact processor recipient and model will receive data; both are bound
  into the consented payload digest and rechecked immediately before transfer.
- Which fixed instruction-profile version will govern extraction; it is also
  inside the digest, so changing instructions requires a fresh preview.
- Whether the full source, page images, extracted text, or redacted excerpts
  will be sent.
- The exact payload preview and any metadata included.
- PaperWork's retention behavior and the provider's separately attributed
  retention/training terms.
- A button that names the action, such as **Send redacted text and analyze**.

Provider output is untrusted. It is rendered as escaped React text in a
separate tab and cannot execute tools, change privacy settings, create external
requests, modify the trusted local plan, or bypass citation validation. Model
agreement is a deterministic comparison of identical normalized values, never
a truth vote.

There are two mutually exclusive transport paths:

```text
hosted: browser -> PaperWork gateway -> selected hosted provider(s)
local:  browser -> exact loopback Ollama origin
                  PaperWork gateway: not_sent
```

The direct path accepts only canonical `http://localhost[:port]` or
`http://127.0.0.1[:port]` recipients from an HTTP loopback PaperWork page. It
revalidates the complete digest-bound request from a synchronous private
snapshot immediately before fetch, omits credentials, redirects, referrers,
tools, retrieval, the source fingerprint and PDF bytes, and caps response size
and wait time. A browser abort or timeout does not prove that Ollama stopped a
request it already received.

Provider calls require an explicit development environment and a loopback
application origin; missing, test, production, unexpected, and public-origin
requests fail closed. Local adapter testing also has bounded request sizes,
one-use request IDs and a small process-local concurrency cap, but those are not
substitutes for public authentication, distributed quotas or provider spend
controls.

## Receipt architecture

The current local receipt is generated from completed `ProcessingEvent` records
and the final trusted pack. It identifies the source by user-readable name and
SHA-256 fingerprint, records parser/rules/validator versions, lists transfers
and external references, summarizes validation, and conservatively reports
browser retention as `status_unavailable`. Future provider and deletion modes
must preserve this observed-event rule.

A successful local receipt has six contiguous browser observations:
`local_read_authorized`, `local_plan_authorized`, `source_admitted`,
`extraction_completed`, `analysis_completed`, and `validation_completed`.
Both authorization events identify the same run UUID; the assembler rejects
stale, future, reversed, malformed, or replayed authorization before reading
file bytes.

Deletion should be a state machine rather than a boolean, for example:

```text
not_stored | deletion_requested | provider_reported_deleted |
locally_cleared | status_unavailable
```

These names do not imply independent verification. If stronger verification is
introduced, its mechanism and limits must be documented and tested.

## Suggested module boundaries

When production work begins, prefer independent packages or directories for:

```text
core/          versioned source, claim, action, and receipt schemas
ingestion/     file/link admission policies and safe adapters
extractors/    isolated PDF, office, image, and OCR implementations
providers/     explicit model/provider adapters
analysis/      document routing and structured Action Pack generation
validation/    citations, unsupported claims, conflicts, and policy checks
receipts/      event collection and human/machine-readable projections
ui/            source review, payload consent, evidence viewer, and Action Pack
evals/         citation, extraction, injection, privacy, and regression suites
```

`core/action-pack/v1` and `core/local-analysis/v1` exist today. The remaining
directories are proposed. Interfaces should permit fake providers and fixture
sources so privacy and evidence behavior can be tested without transmitting
real documents.

## Contributor checklist

For any change that touches document data, contributors should answer:

- What new data enters the system, and is it necessary?
- Where is it processed, transmitted, logged, cached, and retained?
- Which user-facing disclosure changes?
- What trust boundary or external processor is added?
- How are source facts kept separate from inference and suggestions?
- What happens when extraction, analysis, citation validation, or deletion
  fails?
- Which tests prove the stated behavior, including negative transmission tests?
- Does `docs/PRIVACY-THREAT-MODEL.md` need to change?

Architecture decisions involving processing location, persistence, provider
selection, key handling, or URL fetching should be recorded before
implementation because they materially change PaperWork's privacy claims.

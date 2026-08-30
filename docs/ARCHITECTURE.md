# PaperWork architecture

PaperWork aims to turn supplied sources into an evidence-backed Action Pack
while showing users what came from a source, what was inferred, what is only a
suggestion, and where their data went.

This document describes the current sample frontend, the implemented v1 trust
contracts, and a proposed production architecture. Sections marked **Planned**
are not implemented.

## What exists today

The repository contains one interactive React/TypeScript product prototype.
It is a Next.js-compatible application built with Vinext and Vite and prepared
for Cloudflare Worker-compatible hosting.

| Capability | Current behavior |
| --- | --- |
| File input | Reads the selected file's name, MIME type, and size for display. It does not read file contents. |
| Link input | Stores and displays the entered URL in page state. It does not fetch the URL. |
| Processing | A timer advances through illustrative steps. No extraction, OCR, or analysis occurs. |
| Results | A fixed sample offer-letter Action Pack is available only through the clearly labeled sample path. Live analysis of staged sources is not connected. |
| Follow-up question | Returns a prepared sample answer; it does not inspect the question or source. |
| Transparency receipt | Displays static facts about sample mode; it is not an audit-generated receipt or deletion proof. |
| State | React component memory only. Task completion and other state disappear when the page lifecycle ends or reloads. |
| External systems | No AI provider, application database, object storage, account service, or telemetry integration is configured. |

The host must still deliver HTML, JavaScript, CSS, fonts, and images. That
ordinary web traffic is distinct from document processing and may create
infrastructure logs outside this repository.

### Current component flow

```text
app/page.tsx
  ├─ source selection and metadata display
  ├─ sample review and processing states
  ├─ bundled evidence and task fixtures
  ├─ sample Action Pack interaction
  └─ static transparency receipt and public-repository link

app/globals.css       product styling
app/layout.tsx        application shell and metadata
vite.config.ts        Vinext, Sites, and Cloudflare build integration
next.config.ts        Next-compatible configuration
```

The repository includes strict, versioned runtime contracts for canonical
sources, model drafts, validated analyses, Action Packs, processing events,
consent, transfers, corrections, and receipts in `core/action-pack/v1`. It does
not yet include ingestion, extraction, model-provider, persistence, or server
API modules. The current result UI still uses its presentation fixture while
the validated domain bundle is integrated incrementally.

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

## Planned production pipeline

The following is a proposed separation of responsibilities, not current
functionality:

```text
[Source adapters]
 files | images | links
          |
          v
[Ingestion policy]
 type, signature, size, page and URL safety checks
          |
          v
[Isolated extraction/OCR]
          |
          v
[Normalized source model]
 immutable segments + page/region anchors + fingerprints
          |
          +------------------------+
          |                        |
          v                        v
[Consent/payload preview]     [Source viewer]
          |
          v
[Provider-neutral analyzer]  (optional external trust boundary)
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

Whether extraction or analysis runs in a browser, a desktop process, a
PaperWork service, or a third-party provider is intentionally undecided here.
Each shipped mode must document its real execution location and network path;
contributors must not label a mode "local" merely because its UI is local.

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
trusted-ledger assembler (not implemented)
        |
        v
TrustedActionPackV1 -> renderable domain data
```

The model may propose claims, actions, questions, and section membership. It
cannot author canonical source records, claim validation attestations, consent,
transfer history, retention status, corrections, or receipts. Unknown fields
are rejected rather than ignored. Structural parsing never turns external JSON
into trusted render input; only a PaperWork-owned assembler may do that after
independent semantic-support, action-safety, canonical-source, and event-ledger
checks. That assembler is intentionally still unavailable.

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

## Planned provider boundary

Provider adapters should accept only an explicit, reviewable payload and return
a versioned structured response. Before a request, the UI should display:

- Which processor and model will receive data.
- Whether the full source, page images, extracted text, or redacted excerpts
  will be sent.
- The exact payload preview and any metadata included.
- PaperWork's retention behavior and the provider's separately attributed
  retention/training terms.
- A button that names the action, such as **Send redacted text and analyze**.

Provider output is untrusted. It must not be rendered as HTML, execute tools,
change privacy settings, create external requests, or bypass citation
validation.

## Planned receipt architecture

The current transparency modal is static sample UI. A production receipt should
be generated only from `ProcessingEvent` records emitted by completed stages.
It should identify sources by user-readable names and privacy-conscious
fingerprints, record software/model/template versions, list transfers and
external references, summarize evidence validation, and attribute retention or
deletion statements to the system that reported them.

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

Only `core/action-pack/v1` exists from this target organization today. The
remaining directories are proposed. Interfaces should permit fake providers
and fixture sources so privacy and evidence behavior can be tested without
transmitting real documents.

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

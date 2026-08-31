# PaperWork architecture

PaperWork turns a locally parsed PDF into a model-reviewed, evidence-addressed
webpage while showing users what text leaves the browser, which model receives
it, what the model returned, and what PaperWork independently validated.

This document describes the implemented LLM-first v0.1 path, retained legacy
components, and later production boundaries. Sections marked **Planned** are
not implemented.

## What exists today

The repository contains one interactive React/TypeScript application. It is a
Next.js-compatible build using Vinext and Vite and is prepared for Cloudflare
Worker-compatible hosting.

| Capability | Current behavior |
| --- | --- |
| File input | Accepts one PDF up to 10 MB. MIME and extension are advisory; the extractor checks `%PDF-` bytes before parsing. |
| Permission | Reads no bytes until the user authorizes local extraction. After extraction it shows the exact outbound payload and requires a separate fresh model-send approval. |
| Extraction | Exact-pinned `pdfjs-dist` runs in a bundled inline module worker. All pages must yield meaningful native text; scans and partial results are withheld. |
| Canonical source | Computes SHA-256 from the bytes and creates immutable line segments with page-region anchors and extraction provenance. |
| LLM interpretation | One explicitly selected Ollama, OpenAI, Anthropic, Mistral, or DeepSeek model returns a closed `ProviderDocumentAnalysisV1` containing typed findings, source-imposed requirements, conflicts, and bounded suggestion intents. |
| Consent | Request ID, approval time, prompt/output-contract versions, source passages, fingerprint, provider, model, recipient, digest, and byte count are bound together and rechecked before transfer. |
| Results | PaperWork validates the complete schema, source revision, segment, page, span, quote, normalized value, response target, receipt, digest, and byte count before constructing a code-owned view model. Any failed invariant withholds the result. |
| Transparency receipt | Shows the exact provider/model/recipient, route, payload digest and byte count, validation boundary, and provider-attributed retention/training disclosure. |
| State | React component memory only. Task completion and other state disappear when the page lifecycle ends or reloads. |
| External systems | No provider credentials are shipped. A fixed-endpoint hosted-provider gateway is present but disabled by default. Browser-direct Ollama accepts only an exact HTTP loopback origin. There is no application database, object storage, account service, or telemetry integration. |

The host must still deliver HTML, JavaScript, CSS, fonts, and images. That
ordinary web traffic is distinct from document processing and may create
infrastructure logs outside this repository.

### Current component flow

```text
app/page.tsx
  ├─ PDF selection and explicit local-read permission
  ├─ exact outbound payload preview and fresh model-send consent
  ├─ singular provider execution and validated document-agent response
  └─ code-owned overview, details, requirements, evidence, and receipt views

core/local-analysis/v1/pdf.ts
  ├─ byte admission, fingerprint, limits, worker lifecycle
  └─ complete native-text extraction and canonical segments

core/document-agent/v1
  ├─ canonical payload/digest, fixed prompt, and closed report schema
  ├─ exact revision/segment/page/span/quote and value grounding
  ├─ request/response/receipt/target validation and code-owned view model
  └─ browser-direct, exact-loopback Ollama transport

server/document-agent + app/api/document-agent
  ├─ fixed provider registry and server-only credentials
  ├─ no-tool hosted structured-output adapters with bounded responses
  ├─ same-origin, no-store catalog and hosted analysis gateway
  └─ fail-closed rejection of Ollama on the server path

app/globals.css       product styling
app/layout.tsx        application shell and metadata
vite.config.ts        Vinext, Sites, and Cloudflare build integration
next.config.ts        Next-compatible configuration
```

The repository also retains the earlier `core/action-pack/v1` deterministic
assembler, `core/model-council/v1`, and `app/model-council.tsx` for compatibility
and regression tests. They are not the primary webpage execution path. It does
not include OCR, URL ingestion, persistence, accounts, telemetry, or public
gateway abuse controls.

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
6. A failed validator withholds the analysis rather than rendering an uncited
   or internally inconsistent answer.
7. Adding persistence, telemetry, an AI provider, or an external source changes
   the threat model and requires updated disclosures and tests.

## Current LLM-first pipeline and planned extensions

Browser-local PDF parsing, payload preview, singular provider execution,
strict response validation, and code-owned rendering are implemented. Images,
links, OCR, persistence, and sharing remain planned extensions:

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
[Normalized source model: immutable segments + page anchors + fingerprint]
          |
          v
[Exact payload preview for one provider/model/recipient]
          |
          v
[Fresh digest-bound consent]
          |
          +-> hosted: browser -> PaperWork gateway -> selected provider
          +-> local:  browser -> exact loopback Ollama; gateway not_sent
          |
          v
[Closed ProviderDocumentAnalysisV1]
          |
          v
[Schema + evidence + target + receipt + digest validation]
          |
          v
[Code-owned webpage + human-review label]
```

PDF bytes never enter a provider request. Hosted requests contain the approved
logical passages and cross the PaperWork gateway before the selected provider.
An Ollama request goes directly from an HTTP loopback page to the exact
consented HTTP loopback Ollama origin and bypasses the gateway. There is no
hidden fallback provider or multi-provider fan-out. A valid citation proves
source-location integrity, not that the model's interpretation is correct.

The hosted document-agent route remains loopback-development-only. A public
asset deployment without an approved configured analysis engine fails closed;
public hosted inference still requires authentication, distributed quotas,
replay protection, secret management, and spend controls.

## Legacy retained architecture

`core/action-pack/v1/trusted-assembler.ts`, `core/action-pack/v1`,
`core/model-council/v1`, and `app/model-council.tsx` describe the earlier
zero-transfer deterministic Action Pack and seven-field offer comparison. They
remain useful test and design history, but `TrustedActionPackV1` is not the
current model-reviewed webpage contract.

## Retained v1 Action Pack contracts

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

The retained model council may propose only seven typed, nullable offer-letter
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

## Retained provider-comparison boundary

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
requests, modify its retained trusted local plan, or bypass citation validation. Model
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
analysis/      document routing and structured document-report generation
validation/    citations, unsupported claims, conflicts, and policy checks
receipts/      event collection and human/machine-readable projections
ui/            source review, payload consent, evidence viewer, and document view
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

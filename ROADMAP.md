# PaperWork roadmap

PaperWork turns difficult paperwork into an evidence-backed action plan. The
roadmap deliberately starts with one narrow, testable job: helping someone
understand a real employment offer letter without confusing generated guidance
with the words in the document.

## Now — v0.1: offer-letter analysis

### Milestone achieved — native-text PDF + trusted local assembler

- [x] Accept one real PDF, verify its byte signature, cap it at 10 MB and 50
  pages, compute SHA-256, and extract every page in a same-origin browser worker.
- [x] Preserve immutable native-text segments with exact UTF-16 evidence spans,
  normalized page regions, parser version, and observed extraction events.
- [x] Recognize a deliberately narrow set of explicit English offer terms with
  deterministic rules; detect conflicting probation durations and withhold
  scans, partial extraction, ambiguous/unsupported documents, and unsafe text.
- [x] Independently verify claim templates, typed dates/money/durations,
  citations, allowlisted manual-only actions, and the six-event local ledger,
  including two fresh one-use local authorization observations before reading.
- [x] Register only the final parsed and frozen Action Pack in a private trust
  registry. Imported, parsed, serialized, spread, or cloned packs remain
  non-renderable.
- [x] Render sample and user PDFs through the same trusted view-model boundary,
  with explicit local permissions, real progress/cancellation, safe failures,
  exact evidence, and an observed run receipt.
- [x] Recognize the public synthetic PDF by its immutable byte fingerprint,
  preserve `sample_fixture` provenance even after manual re-upload, and replace
  executable-looking document requirements with a do-not-submit sample action.

The remaining v0.1 release gates below still apply before broad promotion.

### Real analysis path

- Extend the implemented real native-text PDF path to a clear image or scan.
  Keep the real synthetic-PDF flow available so anyone can evaluate the product
  without sharing a private document.
- Add OCR with page locations, report unreadable areas, and let the user review
  or correct OCR before analysis.
- Produce a structured Offer Letter Action Pack:
  - what the document is and whether action is required;
  - role, employer, location, start date, compensation, probation, notice
    period, acceptance deadline, and other material facts;
  - prioritized actions, attention points, missing information, and questions
    to ask the employer;
  - a short plain-language explanation, not an open-ended AI summary.
- Keep analysis source-only. If the document does not support an answer, return
  **Not confirmed** instead of filling the gap with general knowledge.
- Allow a user to ask a small set of grounded follow-up questions and draft a
  clarification email whose factual statements remain linked to the source.

### Evidence contract

Every material fact, warning, and action must contain either:

1. a source ID, page, exact supporting excerpt, and source region when
   extraction provides one; or
2. an explicit **Inferred**, **Suggested action**, or **Not confirmed** label
   with a concise rationale.

The citation validator must reject missing excerpts, mismatched pages, and
claims that overstate their evidence. Clicking a citation must open the relevant
passage in the original source. User corrections must invalidate and regenerate
affected outputs.

### v0.1 release gates

#### Privacy gate

- No account, document database, or document-content analytics.
- Show the processing location, provider, transmitted content, retention, and
  external-knowledge setting before analysis begins.
- Require an explicit confirmation before any document content leaves the
  device.
- Redact secrets from logs and error reports; verify this with automated tests
  and a manual production-log review.
- Provide deletion controls and a processing receipt that truthfully records
  what was transmitted and retained.
- Publish the privacy model, limitations, and provider-specific retention facts.

#### Quality and safety gate

- Build a permitted test set covering different layouts, multi-page letters,
  scanned pages, missing annexures, ambiguous compensation, conflicting dates,
  and low-quality OCR.
- Require every material surfaced claim to have valid evidence or an explicit
  uncertainty label; silently unsupported claims are a release blocker.
- Reach at least 95% citation correctness on the curated test set, with separate
  reporting for extraction errors and reasoning errors.
- Correctly capture critical dates and monetary values in at least 90% of the
  applicable test cases, and visibly flag every unreadable test case.
- Test cancellation, timeouts, malformed files, prompt injection inside a
  document, inaccessible pages, and provider failures.
- State clearly that PaperWork is informational and is not legal, financial, or
  employment advice.

#### Deployment gate

- Deploy a usable public demo at a stable URL; a static mockup does not satisfy
  this gate.
- Complete successful sample and real-document runs on current mobile Safari,
  mobile Chrome, and desktop Chrome/Firefox.
- Add file-size/type limits, rate limiting, security headers, dependency scans,
  graceful failure states, and a documented incident/rollback path.
- Monitor availability, latency, extraction failures, and provider failures
  without collecting document content.
- Verify the deployed commit, privacy copy, data flow, deletion behavior, and
  source links in production.

**Promotion must wait until all three gates pass and the usable public demo is
available.** Until then, share only with explicitly invited testers and describe
the product as a work in progress.

## Next — v0.2 to v0.4

- Add DOCX, pasted text, public links, and stronger OCR while preserving the
  same evidence contract.
- Support multiple related sources, missing-attachment detection, version
  comparison, and clearly attributed conflicts.
- Add specialized packs for academic notices, applications, invoices, and
  employment policies only after each has its own evaluation set.
- Introduce provider-neutral adapters and bring-your-own-key mode with an
  accurate outbound-data preview.
- Export plans and privacy receipts as accessible PDF and JSON; share a plan
  without sharing its original sources.
- Publish evaluation results, known limitations, correction history, and a
  simple route for reporting a bad citation or unsafe recommendation.

## Later

- On-device OCR and local-model analysis, followed by a signed desktop app.
- Additional languages evaluated with native-speaker review, not translation
  quality assumptions.
- Calendar/task integrations that require explicit, per-action approval.
- Community-maintained document guides with provenance, review status, and
  version history.
- Audited enterprise/self-hosted deployment and configurable retention.
- Carefully scoped medical, government, insurance, and legal document packs
  only after domain review and higher safety thresholds are in place.

## Out of scope for the early releases

- Claims that a document is safe, valid, fair, or legally enforceable.
- Autonomous acceptance, signing, submission, payment, or messaging.
- Training on private uploads, behavioral advertising, or selling document data.
- A broad “analyze any document perfectly” promise.

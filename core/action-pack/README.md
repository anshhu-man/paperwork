# Action Pack runtime contracts

`v1/` contains the versioned TypeScript contract and strict runtime parsers for
PaperWork Action Packs. The parsers reject unknown fields and return a
deep-frozen clone on success. That success means **structurally valid for
transport**, not trusted or safe to render.

The intended boundary is:

```text
browser File + fresh local authorizations -> local PDF extractor
             -> canonical source + observed events
             -> deterministic offer-letter rules -> independent validators
             -> parseActionPackV1 -> final authority gate + private registration
             -> TrustedActionPackV1 -> UI view model
```

A future provider draft may propose claims, manual actions, questions, and
section membership. Canonical source records, validation attestations,
consent, transfers, corrections, retention states, and receipts must still be
constructed from PaperWork-owned source and event ledgers. Do not pass provider
output directly to `parseActionPackV1` and treat a structurally valid receipt
as proof of an observed event.

The implemented local offer-letter assembler exposes one live authority entry
point: `analyzeLocalOfferLetterPdfV1(File, options)`. Its trust registry is
private and has no registration export. Imported JSON, fixture objects,
`parseActionPackV1` results, object spreads, and structured clones therefore
remain untrusted by identity and cannot enter the result view model.

The options carry two ordered local approvals and a UUID. The assembler checks
freshness and one-use replay before importing the extractor or reading bytes,
then binds both approvals into the receipt ahead of source admission. These are
local authorization observations, not consent records for an external transfer.

Source text and exact quotes are preserved as untrusted evidence, including
markup-like or prompt-injection text. Renderers must escape every string. Model
statements and other generated UI copy reject active markup, tool-like fields,
unknown fields, and autonomous execution instructions outside the schema.

Material action descriptions, timing, and consequences are linked to claim
IDs. `document_requirement` actions may only be based on direct source facts;
PaperWork suggestions remain explicitly optional and manually executed.

The contract-level synthetic offer-letter fixture exports both transport
stages:

- `offerLetterModelDraftV1` represents source-only model output before claim
  validation.
- `offerLetterActionPackV1` is schema-valid illustrative data with canonical
  evidence, manual actions, and a synthetic receipt. It is not trusted render
  input and is not proof that a live extraction or validation run occurred.

The fixture contains no real person, employer, credential, or private document.
Its conflicting probation terms and unconfirmed relocation policy are
intentional examples of provenance that must remain visible to the user. The
downloadable two-page PDF under `public/samples/` is separately processed by
the real browser-local pipeline; it is not pre-trusted fixture output.

Run the focused contract tests with:

```bash
npm test -- core/action-pack/v1/action-pack.test.ts
```

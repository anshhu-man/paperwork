# Action Pack runtime contracts

`v1/` contains the versioned TypeScript contract and strict runtime parsers for
PaperWork Action Packs. The parsers reject unknown fields and return a
deep-frozen clone on success. That success means **structurally valid for
transport**, not trusted or safe to render.

The intended boundary is:

```text
provider JSON -> parseModelDraftV1 -> PaperWork-owned validators and ledgers
              -> parseActionPackV1 -> structurally valid transport object
              -> trusted assembler -> TrustedActionPackV1 -> UI view model
```

A provider draft may propose claims, manual actions, questions, and section
membership. Canonical source records, validation attestations, consent,
transfers, corrections, retention states, and receipts must be constructed
from PaperWork-owned source and event ledgers. Do not pass provider output
directly to `parseActionPackV1` and treat a structurally valid receipt as proof
of an observed event. `isTrustedActionPackV1` intentionally returns false for
every externally parsed object. The trusted assembler is not implemented yet,
so the current UI does not render these contracts.

Source text and exact quotes are preserved as untrusted evidence, including
markup-like or prompt-injection text. Renderers must escape every string. Model
statements and other generated UI copy reject active markup, tool-like fields,
unknown fields, and autonomous execution instructions outside the schema.

Material action descriptions, timing, and consequences are linked to claim
IDs. `document_requirement` actions may only be based on direct source facts;
PaperWork suggestions remain explicitly optional and manually executed.

The synthetic offer-letter fixture exports both stages of the contract:

- `offerLetterModelDraftV1` represents source-only model output before claim
  validation.
- `offerLetterActionPackV1` is schema-valid illustrative data with canonical
  evidence, manual actions, and a synthetic receipt. It is not trusted render
  input and is not proof that a live extraction or validation run occurred.

The fixture contains no real person, employer, credential, or private document.
Its conflicting probation terms and unconfirmed relocation policy are
intentional examples of provenance that must remain visible to the user.

Run the focused contract tests with:

```bash
npm test -- core/action-pack/v1/action-pack.test.ts
```

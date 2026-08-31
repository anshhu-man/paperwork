import type {
  ActionPackViewModelV1,
  ActionViewModelV1,
  ClaimViewModelV1,
} from '../../action-pack/v1/view-model';
import type { LocalPdfExtractionV1 } from '../../local-analysis/v1/pdf';
import type {
  DocumentAgentCompletedRunResultV1,
  DocumentAgentResponseV1,
  DocumentEvidenceV1,
  DocumentFieldValueV1,
  DocumentSuggestionIntentV1,
  ProviderDocumentFindingV1,
  ProviderDocumentRequirementV1,
} from './contracts';

export interface DocumentAgentViewModelV1 extends ActionPackViewModelV1 {
  readonly agent: {
    readonly provider: string;
    readonly model: string;
    readonly recipient: string;
    readonly channel: string;
    readonly payloadDigest: string;
    readonly payloadByteCount: number;
  };
}

const REQUIREMENT_COPY: Readonly<Record<ProviderDocumentRequirementV1['operation'], string>> = {
  accept: 'Review before accepting',
  sign: 'Review before signing',
  return: 'Prepare the requested return',
  pay: 'Verify the payment request',
  submit: 'Review before submitting',
  provide: 'Prepare the requested information',
  notify: 'Review the notification requirement',
  deliver: 'Prepare the requested delivery',
  renew: 'Review the renewal requirement',
  terminate: 'Review the termination requirement',
  respond: 'Prepare your response',
  retain: 'Keep the requested record',
  comply: 'Review the stated requirement',
};

const SUGGESTION_COPY: Readonly<Record<DocumentSuggestionIntentV1, { title: string; description: string; priority: string }>> = {
  review: { title: 'Review the extracted detail', description: 'Compare this model-extracted detail with the cited passage before relying on it.', priority: 'Normal' },
  verify: { title: 'Verify the extracted detail', description: 'Confirm this detail against the cited source and your own records.', priority: 'Normal' },
  clarify: { title: 'Clarify the highlighted detail', description: 'Resolve the highlighted ambiguity with the appropriate human source before acting.', priority: 'High' },
  correct: { title: 'Correct the highlighted detail', description: 'If the cited detail is inaccurate or outdated, update it before sharing or acting.', priority: 'Normal' },
  prepare: { title: 'Prepare for the highlighted item', description: 'Gather the information needed to handle this cited item manually.', priority: 'Normal' },
  compare: { title: 'Compare the highlighted detail', description: 'Compare this cited detail with the relevant record, version, or requirement.', priority: 'Normal' },
  seek_professional_advice: { title: 'Consider qualified professional review', description: 'This cited item may deserve review by a qualified professional before you make a consequential decision.', priority: 'High' },
};

function humanize(value: string) {
  return value.replace(/^[^.]+\./, '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function valueText(value: DocumentFieldValueV1) {
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.value;
  if (value.kind === 'money') return `${value.currency} ${new Intl.NumberFormat('en-IN').format(Number(value.amount))} · ${humanize(value.basis)}`;
  if (value.kind === 'duration') return `${value.value} ${value.unit}${value.value === 1 ? '' : 's'}`;
  if (value.kind === 'percentage') return `${value.value}%`;
  return value.value;
}

function evidenceLocation(extraction: LocalPdfExtractionV1, evidence: DocumentEvidenceV1) {
  const segment = extraction.canonicalSources.sourceSegments.find((item) => item.id === evidence.segmentId);
  if (!segment) return `Page ${evidence.page}`;
  if (segment.anchor.kind === 'page_region') return `Page ${segment.anchor.page} · extracted region`;
  if (segment.anchor.kind === 'page_text') return `Page ${segment.anchor.page} · block ${segment.anchor.block + 1}`;
  if (segment.anchor.kind === 'plain_text') return `Characters ${segment.anchor.characterStart + 1}–${segment.anchor.characterEnd}`;
  return 'Canonical source passage';
}

function quotes(extraction: LocalPdfExtractionV1, evidence: readonly DocumentEvidenceV1[]) {
  return evidence.map((item) => ({ quote: item.quote, location: evidenceLocation(extraction, item) }));
}

function findingClaim(
  extraction: LocalPdfExtractionV1,
  finding: ProviderDocumentFindingV1,
  index: number,
  validatedAt: string,
): ClaimViewModelV1 {
  const title = humanize(finding.fieldId);
  const value = valueText(finding.value);
  return {
    id: `claim.model.${index}`,
    provenance: 'inference',
    label: 'Model extracted · citation checked',
    title,
    statement: `The configured model extracted ${title.toLowerCase()} as ${value}.`,
    value,
    rationale: 'PaperWork verified the output shape and exact source span. The interpretation remains model-generated and should be reviewed.',
    validationState: 'needs_review',
    validatorVersion: 'document-agent-source-span-validator-1.0.0',
    validatedAt,
    quotes: quotes(extraction, finding.evidence),
  };
}

function requirementClaim(
  extraction: LocalPdfExtractionV1,
  requirement: ProviderDocumentRequirementV1,
  index: number,
  validatedAt: string,
): ClaimViewModelV1 {
  return {
    id: `claim.requirement.${index}`,
    provenance: 'inference',
    label: 'Model-identified requirement · review',
    title: humanize(requirement.operation),
    statement: requirement.text,
    rationale: 'The requirement text is an exact source substring, but a model selected its operation. Review the surrounding passage before acting.',
    validationState: 'needs_review',
    validatorVersion: 'document-agent-source-span-validator-1.0.0',
    validatedAt,
    quotes: quotes(extraction, requirement.evidence),
  };
}

function dueText(requirement: ProviderDocumentRequirementV1) {
  if (!requirement.due) return 'No date stated';
  if (requirement.due.kind === 'date') return requirement.due.value;
  return `${requirement.due.value} ${requirement.due.unit}${requirement.due.value === 1 ? '' : 's'}`;
}

function requirementAction(requirement: ProviderDocumentRequirementV1, index: number): ActionViewModelV1 {
  return {
    id: `action.requirement.${index}`,
    priority: requirement.due || ['pay', 'sign', 'terminate'].includes(requirement.operation) ? 'High' : 'Normal',
    title: REQUIREMENT_COPY[requirement.operation],
    description: requirement.text,
    due: dueText(requirement),
    provenance: 'document_requirement',
    evidenceClaimId: `claim.requirement.${index}`,
  };
}

function suggestionAction(
  intent: DocumentSuggestionIntentV1,
  basisIndexes: readonly number[],
  findingClaims: readonly ClaimViewModelV1[],
  index: number,
): ActionViewModelV1 {
  const copy = SUGGESTION_COPY[intent];
  const primaryBasis = findingClaims[basisIndexes[0]] ?? findingClaims[0];
  const focus = primaryBasis?.title ? `: ${primaryBasis.title}` : '';
  return {
    id: `action.suggestion.${index}`,
    priority: copy.priority,
    title: `${copy.title}${focus}`,
    description: copy.description,
    due: 'No date stated',
    provenance: 'paperwork_suggestion',
    evidenceClaimId: primaryBasis?.id ?? 'claim.document-type',
  };
}

function nearestDeadline(
  findings: readonly ProviderDocumentFindingV1[],
  requirements: readonly ProviderDocumentRequirementV1[],
) {
  const values = [
    ...findings.flatMap((finding) => finding.value.kind === 'date' && /deadline|due_date/.test(finding.fieldId) ? [finding.value.value] : []),
    ...requirements.flatMap((requirement) => requirement.due?.kind === 'date' ? [requirement.due.value] : []),
  ].sort();
  return values[0];
}

export function toDocumentAgentViewModelV1(
  extraction: LocalPdfExtractionV1,
  response: DocumentAgentResponseV1 & { readonly result: DocumentAgentCompletedRunResultV1 },
): DocumentAgentViewModelV1 {
  const analysis = response.result.analysis;
  const source = extraction.canonicalSources.sources[0];
  const validatedAt = response.result.completedAt;
  const documentTypeClaim: ClaimViewModelV1 = {
    id: 'claim.document-type',
    provenance: 'inference',
    label: 'Model classification · citation checked',
    title: 'Document type',
    statement: `The configured model classified this document as ${humanize(analysis.documentType)}.`,
    value: humanize(analysis.documentType),
    rationale: 'Classification evidence was checked against exact extracted spans. Classification remains a model judgment.',
    validationState: 'needs_review',
    validatorVersion: 'document-agent-source-span-validator-1.0.0',
    validatedAt,
    quotes: quotes(extraction, analysis.documentTypeEvidence),
  };
  const findingClaims = analysis.findings.map((finding, index) => findingClaim(extraction, finding, index, validatedAt));
  const requirementClaims = analysis.requirements.map((requirement, index) => requirementClaim(extraction, requirement, index, validatedAt));
  const conflictClaims: ClaimViewModelV1[] = analysis.conflicts.map((conflict, index) => ({
    id: `claim.conflict.${index}`,
    provenance: 'conflict',
    label: 'Model found conflicting source values',
    title: humanize(conflict.fieldId),
    statement: `Different cited passages contain ${conflict.alternatives.map((alternative) => valueText(alternative.value)).join(' and ')}.`,
    value: conflict.alternatives.map((alternative) => valueText(alternative.value)).join(' ↔ '),
    rationale: 'PaperWork preserved the distinct model-extracted alternatives instead of selecting one.',
    validationState: 'needs_review',
    validatorVersion: 'document-agent-source-span-validator-1.0.0',
    validatedAt,
    quotes: conflict.alternatives.flatMap((alternative) => quotes(extraction, alternative.evidence)),
  }));
  const requirementActions = analysis.requirements.map(requirementAction);
  const suggestionActions = analysis.suggestions.map((suggestion, index) => suggestionAction(
    suggestion.intent,
    suggestion.basisFindingIndexes,
    findingClaims,
    index,
  ));
  const actions = [...requirementActions, ...suggestionActions];
  const attentionIndexes = new Set(analysis.findings.flatMap((finding, index) => (
    /deadline|due_date|termination|renewal|amount_due|total|liability|indemnity/.test(finding.fieldId) ? [index] : []
  )));
  const attention = [
    ...findingClaims.filter((_, index) => attentionIndexes.has(index)),
    ...requirementClaims,
    ...conflictClaims,
  ];
  const topDetails = findingClaims.slice(0, 3).map((claim) => `${claim.title}: ${claim.value}`).join('; ');
  const brief = [
    `A configured ${response.result.provider} model classified this as ${humanize(analysis.documentType)} and returned ${analysis.findings.length} source-cited detail${analysis.findings.length === 1 ? '' : 's'}.`,
    topDetails ? `Key extracted details: ${topDetails}.` : '',
    analysis.requirements.length > 0 ? `${analysis.requirements.length} source-imposed requirement${analysis.requirements.length === 1 ? ' was' : 's were'} identified for review.` : 'No explicit source-imposed requirement was extracted.',
  ].filter(Boolean).join(' ');
  const pageCount = source?.pageCount ?? 0;
  const byteSize = source?.byteSize ?? 0;
  return {
    source: {
      name: source?.displayName ?? 'document.pdf',
      meta: `PDF · ${pageCount} page${pageCount === 1 ? '' : 's'} · ${byteSize < 1024 * 1024 ? `${Math.max(1, Math.round(byteSize / 1024))} KB` : `${(byteSize / 1024 / 1024).toFixed(1)} MB`}`,
      pageCount,
      fingerprint: extraction.fingerprint,
    },
    documentType: humanize(analysis.documentType),
    brief,
    nearestDeadline: nearestDeadline(analysis.findings, analysis.requirements),
    claims: [documentTypeClaim, ...findingClaims, ...requirementClaims, ...conflictClaims],
    facts: findingClaims,
    attention,
    missingInformation: [],
    conflicts: conflictClaims,
    actions,
    primaryAction: actions[0],
    receipt: {
      processingMode: response.receipt.transfer.channel === 'browser_to_provider' ? 'Local model review' : 'Consented provider review',
      completedAt: response.result.completedAt,
      parser: `pdfjs-dist ${extraction.parserVersion}`,
      validator: 'Document-agent source-span validator 1.0.0',
      transferCount: response.receipt.transfer.status === 'not_sent' ? 0 : 1,
      providerUsed: true,
      serverUsed: response.receipt.transfer.channel === 'gateway_to_provider',
      browserRetention: 'Status unavailable',
    },
    validation: {
      acceptedClaims: 0,
      reviewClaims: 1 + findingClaims.length + requirementClaims.length + conflictClaims.length,
      withheld: 0,
    },
    limitations: [
      'Model output is a review layer: schema and exact source spans were checked, but semantic interpretation remains model-generated.',
      'No action executes automatically. Review the cited passage before signing, paying, submitting, or sharing anything.',
      'Scanned PDFs still require an OCR layer before model analysis.',
      'PaperWork is not a substitute for qualified legal, medical, financial, employment, or career advice.',
    ],
    agent: {
      provider: response.result.provider,
      model: response.result.model,
      recipient: response.receipt.transfer.recipient,
      channel: response.receipt.transfer.channel,
      payloadDigest: response.receipt.transfer.payloadDigest.value,
      payloadByteCount: response.receipt.transfer.payloadByteCount,
    },
  };
}

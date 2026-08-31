import type { ProviderIdV1 } from '../../model-council/v1';

export const DOCUMENT_AGENT_SCHEMA_VERSION_V1 = '1.0.0' as const;
export const DOCUMENT_AGENT_PROMPT_VERSION_V1 = 'generic-document-source-extraction-1.1.0' as const;
export const DOCUMENT_AGENT_OUTPUT_CONTRACT_V1 = 'paperwork.provider_document_analysis@1.0.0' as const;
export const PROVIDER_DOCUMENT_ANALYSIS_KIND_V1 = 'paperwork.provider_document_analysis' as const;
export const DOCUMENT_AGENT_PAYLOAD_KIND_V1 = 'paperwork.document_agent_payload' as const;
export const DOCUMENT_AGENT_REQUEST_KIND_V1 = 'paperwork.document_agent_request' as const;
export const DOCUMENT_AGENT_RESPONSE_KIND_V1 = 'paperwork.document_agent_response' as const;
export const DOCUMENT_AGENT_RECEIPT_KIND_V1 = 'paperwork.document_agent_receipt' as const;

export const DOCUMENT_AGENT_MAX_TOTAL_SEGMENT_CHARACTERS_V1 = 100_000;
export const DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1 = 510 * 1024;

export const DOCUMENT_TYPES_V1 = [
  'resume',
  'employment_offer',
  'contract',
  'invoice',
  'receipt',
  'form',
  'letter',
  'legal_notice',
  'financial_document',
  'academic_document',
  'identity_document',
  'medical_document',
  'other',
] as const;

export type DocumentTypeV1 = (typeof DOCUMENT_TYPES_V1)[number];

export const DOCUMENT_FIELD_IDS_V1 = [
  'document.title',
  'document.identifier',
  'document.date',
  'resume.candidate_name',
  'resume.headline',
  'resume.summary',
  'resume.experience_role',
  'resume.experience_employer',
  'resume.experience_start_date',
  'resume.experience_end_date',
  'resume.experience_description',
  'resume.education_institution',
  'resume.education_credential',
  'resume.education_start_date',
  'resume.education_end_date',
  'resume.skill',
  'resume.project',
  'resume.certification',
  'resume.achievement',
  'resume.language',
  'offer.role',
  'offer.employer',
  'offer.acceptance_deadline',
  'offer.start_date',
  'offer.base_salary',
  'offer.total_compensation',
  'offer.work_location',
  'offer.probation',
  'offer.benefit',
  'contract.party',
  'contract.effective_date',
  'contract.end_date',
  'contract.term',
  'contract.renewal',
  'contract.termination',
  'contract.payment_term',
  'contract.confidentiality',
  'contract.governing_law',
  'contract.notice',
  'contract.liability',
  'contract.indemnity',
  'contract.intellectual_property',
  'contract.obligation',
  'invoice.number',
  'invoice.issue_date',
  'invoice.due_date',
  'invoice.seller',
  'invoice.buyer',
  'invoice.purchase_order',
  'invoice.line_item_description',
  'invoice.line_item_quantity',
  'invoice.line_item_unit_price',
  'invoice.line_item_amount',
  'invoice.subtotal',
  'invoice.tax',
  'invoice.discount',
  'invoice.total',
  'invoice.amount_due',
  'invoice.currency',
  'invoice.payment_terms',
  'invoice.payment_method',
  'generic.party',
  'generic.date',
  'generic.deadline',
  'generic.money',
  'generic.percentage',
  'generic.identifier',
  'generic.location',
  'generic.duration',
  'generic.contact',
  'generic.term',
] as const;

export type DocumentFieldIdV1 = (typeof DOCUMENT_FIELD_IDS_V1)[number];

export const DOCUMENT_GROUP_KINDS_V1 = [
  'resume_experience',
  'resume_education',
  'resume_project',
  'contract_party',
  'contract_clause',
  'invoice_line_item',
  'invoice_party',
] as const;

export type DocumentGroupKindV1 = (typeof DOCUMENT_GROUP_KINDS_V1)[number];

export const DOCUMENT_REQUIREMENT_OPERATIONS_V1 = [
  'accept',
  'sign',
  'return',
  'pay',
  'submit',
  'provide',
  'notify',
  'deliver',
  'renew',
  'terminate',
  'respond',
  'retain',
  'comply',
] as const;

export type DocumentRequirementOperationV1 = (typeof DOCUMENT_REQUIREMENT_OPERATIONS_V1)[number];

export const DOCUMENT_SUGGESTION_INTENTS_V1 = [
  'review',
  'verify',
  'clarify',
  'correct',
  'prepare',
  'compare',
  'seek_professional_advice',
] as const;

export type DocumentSuggestionIntentV1 = (typeof DOCUMENT_SUGGESTION_INTENTS_V1)[number];

export interface DocumentAgentDigestV1 {
  readonly algorithm: 'sha-256';
  readonly value: string;
}

export interface DocumentAgentPayloadDigestV1 extends DocumentAgentDigestV1 {
  readonly byteCount: number;
}

export interface DocumentAgentSourceSegmentInputV1 {
  readonly segmentId: string;
  readonly page: number;
  readonly text: string;
}

export interface DocumentAgentSourceSegmentV1 extends DocumentAgentSourceSegmentInputV1 {
  readonly sourceRevisionId: string;
  readonly sequence: number;
}

export interface DocumentAgentProviderTargetV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
  readonly recipient: string;
}

export interface DocumentAgentPayloadV1 {
  readonly kind: typeof DOCUMENT_AGENT_PAYLOAD_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly promptVersion: typeof DOCUMENT_AGENT_PROMPT_VERSION_V1;
  readonly outputContract: typeof DOCUMENT_AGENT_OUTPUT_CONTRACT_V1;
  /** Digest-bound replay identity copied into the outer request. */
  readonly requestId: string;
  /** Digest-bound approval time copied into consent. */
  readonly consentRecordedAt: string;
  readonly sourceRevisionId: string;
  readonly sourceFingerprint: DocumentAgentDigestV1;
  readonly providerTarget: DocumentAgentProviderTargetV1;
  readonly segments: readonly DocumentAgentSourceSegmentV1[];
}

export interface DocumentAgentConsentV1 {
  readonly approvedBy: 'user';
  readonly recordedAt: string;
  readonly provider: ProviderIdV1;
  readonly previewDigest: DocumentAgentDigestV1;
  readonly previewByteCount: number;
}

export interface DocumentAgentRequestV1 {
  readonly kind: typeof DOCUMENT_AGENT_REQUEST_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly requestId: string;
  readonly payload: DocumentAgentPayloadV1;
  readonly consent: DocumentAgentConsentV1;
}

export interface DocumentGroupRefV1 {
  readonly kind: DocumentGroupKindV1;
  readonly index: number;
}

export interface DocumentEvidenceV1 {
  readonly sourceRevisionId: string;
  readonly segmentId: string;
  readonly page: number;
  readonly span: {
    readonly start: number;
    readonly end: number;
  };
  readonly quote: string;
}

export interface DocumentTextValueV1 {
  readonly kind: 'text';
  readonly text: string;
}

export interface DocumentDateValueV1 {
  readonly kind: 'date';
  readonly value: string;
}

export interface DocumentMoneyValueV1 {
  readonly kind: 'money';
  readonly amount: string;
  readonly currency: string;
  readonly basis: 'one_time' | 'hourly' | 'monthly' | 'annual' | 'subtotal' | 'tax' | 'discount' | 'total' | 'amount_due';
}

export interface DocumentDurationValueV1 {
  readonly kind: 'duration';
  readonly value: number;
  readonly unit: 'day' | 'week' | 'month' | 'year';
}

export interface DocumentDecimalValueV1 {
  readonly kind: 'decimal';
  readonly value: string;
}

export interface DocumentPercentageValueV1 {
  readonly kind: 'percentage';
  readonly value: string;
}

export type DocumentFieldValueV1 =
  | DocumentTextValueV1
  | DocumentDateValueV1
  | DocumentMoneyValueV1
  | DocumentDurationValueV1
  | DocumentDecimalValueV1
  | DocumentPercentageValueV1;

export interface ProviderDocumentFindingV1 {
  readonly fieldId: DocumentFieldIdV1;
  readonly group: DocumentGroupRefV1 | null;
  readonly value: DocumentFieldValueV1;
  readonly evidence: readonly [DocumentEvidenceV1, ...DocumentEvidenceV1[]];
}

export interface ProviderDocumentRequirementV1 {
  readonly operation: DocumentRequirementOperationV1;
  /** Exact source text; PaperWork creates the user-facing action copy. */
  readonly text: string;
  readonly due: DocumentDateValueV1 | DocumentDurationValueV1 | null;
  readonly evidence: readonly [DocumentEvidenceV1, ...DocumentEvidenceV1[]];
}

export interface ProviderDocumentConflictAlternativeV1 {
  readonly value: DocumentFieldValueV1;
  readonly evidence: readonly [DocumentEvidenceV1, ...DocumentEvidenceV1[]];
}

export interface ProviderDocumentConflictV1 {
  readonly fieldId: DocumentFieldIdV1;
  readonly group: DocumentGroupRefV1 | null;
  readonly alternatives: readonly [
    ProviderDocumentConflictAlternativeV1,
    ProviderDocumentConflictAlternativeV1,
    ...ProviderDocumentConflictAlternativeV1[],
  ];
}

/** The model selects only a bounded manual intent and cited finding indexes. */
export interface ProviderDocumentSuggestionV1 {
  readonly intent: DocumentSuggestionIntentV1;
  readonly basisFindingIndexes: readonly [number, ...number[]];
}

export interface ProviderDocumentAnalysisV1 {
  readonly kind: typeof PROVIDER_DOCUMENT_ANALYSIS_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly sourceRevisionId: string;
  readonly documentType: DocumentTypeV1;
  readonly documentTypeEvidence: readonly DocumentEvidenceV1[];
  readonly findings: readonly ProviderDocumentFindingV1[];
  readonly requirements: readonly ProviderDocumentRequirementV1[];
  readonly conflicts: readonly ProviderDocumentConflictV1[];
  readonly suggestions: readonly ProviderDocumentSuggestionV1[];
}

export type DocumentAgentFailureCodeV1 =
  | 'agent_disabled'
  | 'not_configured'
  | 'provider_timeout'
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'network_failure'
  | 'invalid_provider_output'
  | 'internal_error';

interface DocumentAgentRunResultBaseV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
}

export interface DocumentAgentCompletedRunResultV1 extends DocumentAgentRunResultBaseV1 {
  readonly status: 'completed';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly validation: 'schema_and_source_spans_checked';
  readonly analysis: ProviderDocumentAnalysisV1;
}

export interface DocumentAgentFailedRunResultV1 extends DocumentAgentRunResultBaseV1 {
  readonly status: 'failed';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly issueCode: DocumentAgentFailureCodeV1;
  readonly retryable: boolean;
}

export interface DocumentAgentUnavailableRunResultV1 extends DocumentAgentRunResultBaseV1 {
  readonly status: 'unavailable';
  readonly issueCode: 'agent_disabled' | 'not_configured' | 'provider_unavailable';
  readonly retryable: boolean;
}

export type DocumentAgentRunResultV1 =
  | DocumentAgentCompletedRunResultV1
  | DocumentAgentFailedRunResultV1
  | DocumentAgentUnavailableRunResultV1;

export interface DocumentAgentProviderPolicyV1 {
  readonly retention: 'provider_policy' | 'unknown';
  readonly trainingUse: 'not_used' | 'may_be_used' | 'unknown';
  readonly assertedBy: string;
  readonly policyUrl: string | null;
}

export interface DocumentAgentTransferReceiptV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
  readonly recipient: string;
  readonly channel: 'gateway_to_provider' | 'browser_to_provider';
  readonly status: 'completed' | 'failed' | 'not_sent';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly payloadDigest: DocumentAgentDigestV1;
  readonly payloadByteCount: number;
  readonly providerPolicy: DocumentAgentProviderPolicyV1;
}

export interface DocumentAgentGatewayTransferReceiptV1 {
  readonly recipient: 'PaperWork model gateway';
  readonly status: 'completed' | 'failed' | 'not_sent';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly payloadDigest: DocumentAgentDigestV1;
  readonly payloadByteCount: number;
}

export interface DocumentAgentReceiptV1 {
  readonly kind: typeof DOCUMENT_AGENT_RECEIPT_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly receiptId: string;
  readonly requestId: string;
  readonly consent: DocumentAgentConsentV1;
  readonly gatewayTransfer: DocumentAgentGatewayTransferReceiptV1;
  readonly transfer: DocumentAgentTransferReceiptV1;
}

export interface DocumentAgentResponseV1 {
  readonly kind: typeof DOCUMENT_AGENT_RESPONSE_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly requestId: string;
  readonly result: DocumentAgentRunResultV1;
  readonly receipt: DocumentAgentReceiptV1;
}

export interface DocumentAgentResponseExpectationV1 {
  readonly requestId: string;
  readonly previewDigest: DocumentAgentDigestV1;
  readonly previewByteCount: number;
  readonly providerTarget: DocumentAgentProviderTargetV1;
}

export const MODEL_COUNCIL_SCHEMA_VERSION_V1 = '1.0.0' as const;
export const PROVIDER_ANALYSIS_KIND_V1 = 'paperwork.provider_analysis' as const;
export const MODEL_COUNCIL_PAYLOAD_KIND_V1 = 'paperwork.model_council_payload' as const;
export const MODEL_COUNCIL_REQUEST_KIND_V1 = 'paperwork.model_council_request' as const;
export const MODEL_COUNCIL_RESPONSE_KIND_V1 = 'paperwork.model_council_response' as const;
export const MODEL_COUNCIL_RECEIPT_KIND_V1 = 'paperwork.model_council_receipt' as const;
export const MODEL_COUNCIL_CATALOG_KIND_V1 = 'paperwork.model_council_catalog' as const;
export const MODEL_COUNCIL_CONSENSUS_KIND_V1 = 'paperwork.model_council_consensus' as const;
export const MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1 = '1.0.0' as const;
/** Identifies the exact fixed system-instruction profile covered by consent. */
export const MODEL_COUNCIL_PROMPT_VERSION_V1 = 'offer-letter-source-extraction-1.0.1' as const;
/** Leaves 2 KiB inside the 512 KiB gateway-body cap for request and consent framing. */
export const MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1 = 510 * 1024;
export const MODEL_COUNCIL_MAX_TOTAL_SEGMENT_CHARACTERS_V1 = 100_000;

export const PROVIDER_IDS_V1 = [
  'openai',
  'anthropic',
  'mistral',
  'deepseek',
  'ollama',
] as const;

export type ProviderIdV1 = (typeof PROVIDER_IDS_V1)[number];

export const MODEL_COUNCIL_FIELD_IDS_V1 = [
  'role',
  'acceptanceDeadline',
  'startDate',
  'annualBaseSalary',
  'workLocation',
  'probation',
  'actionRequired',
] as const;

export type ModelCouncilFieldIdV1 = (typeof MODEL_COUNCIL_FIELD_IDS_V1)[number];

export interface ModelCouncilDigestV1 {
  readonly algorithm: 'sha-256';
  readonly value: string;
}

export interface ModelCouncilPayloadDigestV1 extends ModelCouncilDigestV1 {
  readonly byteCount: number;
}

export interface ModelCouncilSourceSegmentInputV1 {
  readonly segmentId: string;
  readonly page: number;
  readonly text: string;
}

/** The exact extracted-text unit shown in the preview and sent for model review. */
export interface ModelCouncilSourceSegmentV1 extends ModelCouncilSourceSegmentInputV1 {
  readonly sourceRevisionId: string;
  readonly sequence: number;
}

/** Exact recipient configuration shown before consent and bound into the payload digest. */
export interface ModelCouncilProviderTargetV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
  readonly recipient: string;
}

export interface ModelCouncilPayloadV1 {
  readonly kind: typeof MODEL_COUNCIL_PAYLOAD_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly catalogVersion: typeof MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1;
  readonly promptVersion: typeof MODEL_COUNCIL_PROMPT_VERSION_V1;
  readonly sourceRevisionId: string;
  readonly sourceFingerprint: ModelCouncilDigestV1;
  readonly providers: readonly ProviderIdV1[];
  readonly providerTargets: readonly ModelCouncilProviderTargetV1[];
  readonly segments: readonly ModelCouncilSourceSegmentV1[];
}

export interface ModelCouncilEvidenceV1 {
  readonly sourceRevisionId: string;
  readonly segmentId: string;
  readonly page: number;
  /** Must be an exact substring of the identified canonical segment. */
  readonly quote: string;
}

export interface ModelCouncilTextValueV1 {
  readonly kind: 'text';
  /** NFC, trimmed, single-line text with runs of whitespace collapsed. */
  readonly text: string;
}

export interface ModelCouncilDateValueV1 {
  readonly kind: 'date';
  /** A real calendar date in YYYY-MM-DD form. */
  readonly value: string;
}

export interface ModelCouncilMoneyValueV1 {
  readonly kind: 'money';
  /** Canonical base-10 amount: no separators, leading zeroes, or trailing fractional zeroes. */
  readonly amount: string;
  readonly currency: string;
  readonly basis: 'annual';
}

export interface ModelCouncilDurationValueV1 {
  readonly kind: 'duration';
  readonly value: number;
  readonly unit: 'day' | 'week' | 'month' | 'year';
}

export type ModelCouncilFieldValueV1 =
  | ModelCouncilTextValueV1
  | ModelCouncilDateValueV1
  | ModelCouncilMoneyValueV1
  | ModelCouncilDurationValueV1;

export interface ModelCouncilSourceBackedFieldV1<TValue extends ModelCouncilFieldValueV1> {
  readonly value: TValue;
  readonly evidence: readonly [ModelCouncilEvidenceV1, ...ModelCouncilEvidenceV1[]];
}

export type ModelCouncilTextFieldV1 = ModelCouncilSourceBackedFieldV1<ModelCouncilTextValueV1>;
export type ModelCouncilDateFieldV1 = ModelCouncilSourceBackedFieldV1<ModelCouncilDateValueV1>;
export type ModelCouncilMoneyFieldV1 = ModelCouncilSourceBackedFieldV1<ModelCouncilMoneyValueV1>;
export type ModelCouncilDurationFieldV1 = ModelCouncilSourceBackedFieldV1<ModelCouncilDurationValueV1>;

export interface ProviderAnalysisFieldsV1 {
  readonly role: ModelCouncilTextFieldV1 | null;
  readonly acceptanceDeadline: ModelCouncilDateFieldV1 | null;
  readonly startDate: ModelCouncilDateFieldV1 | null;
  readonly annualBaseSalary: ModelCouncilMoneyFieldV1 | null;
  readonly workLocation: ModelCouncilTextFieldV1 | null;
  readonly probation: ModelCouncilDurationFieldV1 | null;
  /** A requirement stated by the document, never a model-created action or suggestion. */
  readonly actionRequired: ModelCouncilTextFieldV1 | null;
}

/**
 * The only model-authored shape PaperWork accepts in v1.
 *
 * There is intentionally no free-form summary, advice, plan, action generation,
 * question generation, or arbitrary key/value area.
 */
export interface ProviderAnalysisV1 {
  readonly kind: typeof PROVIDER_ANALYSIS_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly documentType: 'employment_offer';
  readonly sourceRevisionId: string;
  readonly fields: ProviderAnalysisFieldsV1;
}

export interface ModelCouncilConsentV1 {
  readonly approvedBy: 'user';
  readonly recordedAt: string;
  readonly providers: readonly ProviderIdV1[];
  readonly previewDigest: ModelCouncilDigestV1;
  readonly previewByteCount: number;
}

export interface ModelCouncilRequestV1 {
  readonly kind: typeof MODEL_COUNCIL_REQUEST_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly requestId: string;
  readonly payload: ModelCouncilPayloadV1;
  readonly consent: ModelCouncilConsentV1;
}

export type ModelCouncilFailureCodeV1 =
  | 'council_disabled'
  | 'not_configured'
  | 'provider_timeout'
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'network_failure'
  | 'invalid_provider_output'
  | 'internal_error';

interface ModelCouncilRunResultBaseV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
}

export interface ModelCouncilCompletedRunResultV1 extends ModelCouncilRunResultBaseV1 {
  readonly status: 'completed';
  readonly startedAt: string;
  readonly completedAt: string;
  /** Set only after PaperWork has checked every exact quote against the payload. */
  readonly validation: 'source_quotes_checked';
  readonly analysis: ProviderAnalysisV1;
}

export interface ModelCouncilFailedRunResultV1 extends ModelCouncilRunResultBaseV1 {
  readonly status: 'failed';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly issueCode: ModelCouncilFailureCodeV1;
  readonly retryable: boolean;
}

export interface ModelCouncilUnavailableRunResultV1 extends ModelCouncilRunResultBaseV1 {
  readonly status: 'unavailable';
  readonly issueCode: 'council_disabled' | 'not_configured' | 'provider_unavailable';
  readonly retryable: boolean;
}

export type ModelCouncilRunResultV1 =
  | ModelCouncilCompletedRunResultV1
  | ModelCouncilFailedRunResultV1
  | ModelCouncilUnavailableRunResultV1;

export type ModelCouncilFieldCandidateV1 = {
  readonly value: ModelCouncilFieldValueV1 | null;
  readonly providers: readonly ProviderIdV1[];
};

export type ModelCouncilFieldConsensusStatusV1 =
  | 'no_result'
  | 'single_result'
  | 'agreement'
  | 'disagreement';

export interface ModelCouncilFieldConsensusV1 {
  readonly field: ModelCouncilFieldIdV1;
  readonly status: ModelCouncilFieldConsensusStatusV1;
  /** Present only as untrusted model agreement; it never becomes a PaperWork source fact. */
  readonly agreedValue: ModelCouncilFieldValueV1 | null;
  readonly providers: readonly ProviderIdV1[];
  readonly candidates: readonly ModelCouncilFieldCandidateV1[];
}

export interface ModelCouncilConsensusV1 {
  readonly kind: typeof MODEL_COUNCIL_CONSENSUS_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly trust: 'untrusted_model_agreement';
  readonly fields: Readonly<Record<ModelCouncilFieldIdV1, ModelCouncilFieldConsensusV1>>;
}

export interface ModelCouncilProviderPolicyV1 {
  readonly retention: 'provider_policy' | 'unknown';
  readonly trainingUse: 'not_used' | 'may_be_used' | 'unknown';
  readonly assertedBy: string;
  readonly policyUrl: string | null;
}

export interface ModelCouncilTransferReceiptV1 {
  readonly provider: ProviderIdV1;
  readonly model: string;
  readonly recipient: string;
  readonly channel: 'gateway_to_provider' | 'browser_to_provider';
  readonly status: 'completed' | 'failed' | 'not_sent';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly payloadDigest: ModelCouncilDigestV1;
  readonly payloadByteCount: number;
  readonly providerPolicy: ModelCouncilProviderPolicyV1;
}

export interface ModelCouncilGatewayTransferReceiptV1 {
  readonly recipient: 'PaperWork model gateway';
  /** `not_sent` is used only when a loopback Ollama run goes browser-direct. */
  readonly status: 'completed' | 'failed' | 'not_sent';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly payloadDigest: ModelCouncilDigestV1;
  readonly payloadByteCount: number;
}

export interface ModelCouncilReceiptV1 {
  readonly kind: typeof MODEL_COUNCIL_RECEIPT_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly receiptId: string;
  readonly requestId: string;
  readonly consent: ModelCouncilConsentV1;
  /** Browser-to-PaperWork transfer, separate from every gateway-to-provider transfer. */
  readonly gatewayTransfer: ModelCouncilGatewayTransferReceiptV1;
  readonly transfers: readonly ModelCouncilTransferReceiptV1[];
}

export type ModelCouncilProviderExecutionV1 = 'provider_api' | 'self_hosted';
export type ModelCouncilStructuredOutputV1 = 'json_schema' | 'json_object';
export type ModelCouncilProviderAccessV1 =
  | 'commercial_api'
  | 'open_weight_hosted_api'
  | 'hosted_api_model_license_varies'
  | 'self_hosted';

export interface ModelCouncilProviderCatalogEntryV1 {
  readonly id: ProviderIdV1;
  readonly displayName: string;
  readonly availability: 'configured' | 'not_configured' | 'disabled';
  readonly model: string | null;
  readonly execution: ModelCouncilProviderExecutionV1;
  readonly access: ModelCouncilProviderAccessV1;
  readonly recipient: string;
  readonly structuredOutput: ModelCouncilStructuredOutputV1;
  readonly policyUrl: string | null;
  /** Inert plain-language disclosure shown before consent. */
  readonly disclosure: string;
}

export interface ModelCouncilCatalogV1 {
  readonly kind: typeof MODEL_COUNCIL_CATALOG_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly catalogVersion: typeof MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1;
  readonly enabled: boolean;
  readonly generatedAt: string;
  readonly providers: readonly ModelCouncilProviderCatalogEntryV1[];
}

export interface ModelCouncilResponseV1 {
  readonly kind: typeof MODEL_COUNCIL_RESPONSE_KIND_V1;
  readonly schemaVersion: typeof MODEL_COUNCIL_SCHEMA_VERSION_V1;
  readonly requestId: string;
  readonly results: readonly ModelCouncilRunResultV1[];
  readonly consensus: ModelCouncilConsensusV1;
  readonly receipt: ModelCouncilReceiptV1;
}

/** Browser-owned expectations used to reject a self-consistent replay or changed target. */
export interface ModelCouncilResponseExpectationV1 {
  readonly requestId: string;
  readonly previewDigest: ModelCouncilDigestV1;
  readonly previewByteCount: number;
  readonly providerTargets: readonly ModelCouncilProviderTargetV1[];
}

export const ACTION_PACK_SCHEMA_VERSION_V1 = '1.0.0' as const;
export const MODEL_DRAFT_KIND_V1 = 'paperwork.model_draft' as const;
export const VALIDATED_ANALYSIS_KIND_V1 = 'paperwork.validated_analysis' as const;
export const ACTION_PACK_KIND_V1 = 'paperwork.action_pack' as const;

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type RunModeV1 = 'sample_fixture' | 'live';
export type KnowledgeModeV1 = 'source_only';
export type SourceKindV1 = 'file' | 'image' | 'url' | 'text';

export type SourceOriginV1 =
  | { readonly kind: 'upload' }
  | { readonly kind: 'camera' }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'paste' }
  | { readonly kind: 'sample'; readonly fixtureId: string };

export interface SourceDescriptorV1 {
  readonly id: string;
  readonly displayName: string;
  readonly kind: SourceKindV1;
  readonly mediaType: string;
  readonly byteSize?: number;
  readonly pageCount?: number;
  readonly origin: SourceOriginV1;
}

export interface SourceFingerprintV1 {
  readonly algorithm: 'sha-256';
  readonly value: string;
}

export interface SourceRevisionV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly fingerprint: SourceFingerprintV1;
  readonly createdAt: string;
  readonly status: 'active' | 'superseded';
  readonly supersedesRevisionId?: string;
}

export interface NormalizedRegionV1 {
  readonly unit: 'normalized';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type SourceAnchorV1 =
  | {
      readonly kind: 'page_text';
      readonly page: number;
      readonly block: number;
    }
  | {
      readonly kind: 'page_region';
      readonly page: number;
      readonly region: NormalizedRegionV1;
    }
  | {
      readonly kind: 'plain_text';
      readonly characterStart: number;
      readonly characterEnd: number;
    }
  | {
      readonly kind: 'web';
      readonly url: string;
      readonly selector?: string;
    };

export interface ExtractionProvenanceV1 {
  readonly method: 'native_text' | 'ocr' | 'web' | 'manual' | 'sample';
  readonly engine: string;
  readonly version: string;
  readonly extractedAt: string;
}

export interface SourceSegmentV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly index: number;
  readonly text: string;
  readonly anchor: SourceAnchorV1;
  readonly extraction: ExtractionProvenanceV1;
}

export interface CanonicalSourceContextV1 {
  readonly sources: readonly SourceDescriptorV1[];
  readonly sourceRevisions: readonly SourceRevisionV1[];
  readonly sourceSegments: readonly SourceSegmentV1[];
}

export interface EvidenceRefV1 {
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly segmentId: string;
  readonly quote: string;
  /** UTF-16 code-unit offsets into the canonical segment text. */
  readonly span: {
    readonly start: number;
    readonly end: number;
  };
}

export type NormalizedClaimValueV1 =
  | {
      readonly kind: 'date';
      readonly value: string;
    }
  | {
      readonly kind: 'money';
      /** Base-10 amount without grouping separators. */
      readonly amount: string;
      /** ISO 4217 currency code. */
      readonly currency: string;
      readonly basis?: 'annual' | 'monthly' | 'weekly' | 'daily' | 'one_time';
    }
  | {
      readonly kind: 'duration';
      readonly value: number;
      readonly unit: 'day' | 'week' | 'month' | 'year';
    };

export type ClaimProvenanceV1 =
  | 'source_fact'
  | 'inference'
  | 'suggestion'
  | 'not_confirmed'
  | 'conflict';

interface ClaimDraftBaseV1 {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly materiality: 'material' | 'supporting';
  readonly normalizedValues: readonly NormalizedClaimValueV1[];
}

export interface SourceFactClaimDraftV1 extends ClaimDraftBaseV1 {
  readonly provenance: 'source_fact';
  readonly evidence: NonEmptyArray<EvidenceRefV1>;
}

export interface InferenceClaimDraftV1 extends ClaimDraftBaseV1 {
  readonly provenance: 'inference';
  readonly evidence: NonEmptyArray<EvidenceRefV1>;
  readonly basisClaimIds: NonEmptyArray<string>;
  readonly rationale: string;
}

export interface SuggestionClaimDraftV1 extends ClaimDraftBaseV1 {
  readonly provenance: 'suggestion';
  readonly basisClaimIds: NonEmptyArray<string>;
  readonly rationale: string;
  readonly sourceImposed: false;
  readonly execution: 'manual_user_choice';
}

export interface NotConfirmedClaimDraftV1 extends ClaimDraftBaseV1 {
  readonly provenance: 'not_confirmed';
  readonly evidence: readonly EvidenceRefV1[];
  readonly reason: string;
}

export interface ConflictAlternativeV1 {
  readonly statement: string;
  readonly evidence: NonEmptyArray<EvidenceRefV1>;
}

export interface ConflictClaimDraftV1 extends ClaimDraftBaseV1 {
  readonly provenance: 'conflict';
  readonly alternatives: readonly [
    ConflictAlternativeV1,
    ConflictAlternativeV1,
    ...ConflictAlternativeV1[],
  ];
  readonly rationale: string;
}

export type ClaimDraftV1 =
  | SourceFactClaimDraftV1
  | InferenceClaimDraftV1
  | SuggestionClaimDraftV1
  | NotConfirmedClaimDraftV1
  | ConflictClaimDraftV1;

export interface ClaimValidationV1 {
  readonly state: 'accepted' | 'needs_review' | 'blocked' | 'stale';
  readonly validatorVersion: string;
  readonly validatedAt: string;
  readonly issueCodes: readonly string[];
  readonly checks: {
    readonly citation: 'passed' | 'failed' | 'not_applicable';
    readonly semanticSupport: 'supported' | 'partial' | 'unsupported' | 'not_applicable';
  };
}

export type ValidatedClaimV1 = ClaimDraftV1 & {
  readonly validation: ClaimValidationV1;
};

export type ActionTimingV1 =
  | {
      readonly kind: 'calendar_date';
      readonly date: string;
      readonly basisClaimId: string;
    }
  | {
      readonly kind: 'condition';
      readonly label: string;
      readonly basisClaimId: string;
    }
  | { readonly kind: 'none' };

export interface ActionConsequenceV1 {
  readonly text: string;
  readonly basisClaimIds: NonEmptyArray<string>;
}

export interface ActionValidationV1 {
  readonly state: 'accepted' | 'needs_review' | 'blocked' | 'stale';
  readonly validatorVersion: string;
  readonly validatedAt: string;
  readonly issueCodes: readonly string[];
  readonly checks: {
    readonly basis: 'passed' | 'failed';
    readonly timing: 'passed' | 'failed' | 'not_applicable';
    readonly safety: 'passed' | 'failed' | 'needs_review';
  };
}

export interface ActionDraftV1 {
  readonly id: string;
  readonly provenance: 'document_requirement' | 'paperwork_suggestion';
  readonly order: number;
  readonly priority: 'critical' | 'high' | 'normal' | 'low';
  readonly title: string;
  readonly description: string;
  readonly timing: ActionTimingV1;
  readonly basisClaimIds: NonEmptyArray<string>;
  readonly requiredInputs: readonly string[];
  readonly consequence?: ActionConsequenceV1;
  readonly sourceImposed: boolean;
  readonly execution: 'manual_user_choice';
}

export type ValidatedActionV1 = ActionDraftV1 & {
  readonly validation: ActionValidationV1;
};

export interface QuestionDraftV1 {
  readonly id: string;
  readonly text: string;
  readonly reason: string;
  readonly basisClaimIds: readonly string[];
}

export interface DocumentPointersV1 {
  readonly documentType: string;
  readonly titleClaimId: string;
  readonly purposeClaimId: string;
  readonly actionRequiredClaimId: string;
  readonly nearestDeadlineClaimId?: string;
  readonly primaryActionId?: string;
}

export interface AnalysisSectionsV1 {
  readonly briefClaimIds: readonly string[];
  readonly factClaimIds: readonly string[];
  readonly attentionClaimIds: readonly string[];
  readonly missingInformationClaimIds: readonly string[];
  readonly conflictClaimIds: readonly string[];
  readonly planActionIds: readonly string[];
}

export interface ModelDraftV1 {
  readonly kind: typeof MODEL_DRAFT_KIND_V1;
  readonly schemaVersion: typeof ACTION_PACK_SCHEMA_VERSION_V1;
  readonly analysisId: string;
  readonly knowledgeMode: KnowledgeModeV1;
  readonly sourceRevisionIds: NonEmptyArray<string>;
  readonly document: DocumentPointersV1;
  readonly claims: readonly ClaimDraftV1[];
  readonly actions: readonly ActionDraftV1[];
  readonly questions: readonly QuestionDraftV1[];
  readonly sections: AnalysisSectionsV1;
}

export interface ValidatedAnalysisV1 {
  readonly kind: typeof VALIDATED_ANALYSIS_KIND_V1;
  readonly schemaVersion: typeof ACTION_PACK_SCHEMA_VERSION_V1;
  readonly analysisId: string;
  readonly knowledgeMode: KnowledgeModeV1;
  readonly sourceRevisionIds: NonEmptyArray<string>;
  readonly document: DocumentPointersV1;
  readonly claims: readonly ValidatedClaimV1[];
  readonly actions: readonly ValidatedActionV1[];
  readonly questions: readonly QuestionDraftV1[];
  readonly sections: AnalysisSectionsV1;
}

export type ProcessingLocationV1 =
  | 'browser'
  | 'device'
  | 'paperwork_service'
  | 'provider';

export interface ProcessingEventV1 {
  readonly id: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type:
    | 'local_read_authorized'
    | 'local_plan_authorized'
    | 'source_admitted'
    | 'extraction_completed'
    | 'payload_previewed'
    | 'consent_recorded'
    | 'transfer_started'
    | 'transfer_completed'
    | 'analysis_completed'
    | 'validation_completed'
    | 'correction_recorded'
    | 'deletion_requested'
    | 'deletion_reported'
    | 'local_cleanup_completed'
    | 'run_cancelled'
    | 'run_failed';
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly actor: {
    readonly location: ProcessingLocationV1;
    readonly name: string;
  };
  readonly relatedId?: string;
}

export type ContentCategoryV1 =
  | 'full_file'
  | 'page_images'
  | 'extracted_text'
  | 'redacted_text'
  | 'document_metadata'
  | 'user_question';

export interface ConsentRecordV1 {
  readonly id: string;
  readonly recordedAt: string;
  readonly approvedBy: 'user';
  readonly recipient: string;
  readonly provider?: string;
  readonly model?: string;
  readonly sourceRevisionIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly contentCategories: NonEmptyArray<ContentCategoryV1>;
  readonly previewDigest: SourceFingerprintV1;
  readonly redactions: readonly string[];
}

export interface ProviderPolicyStatementV1 {
  readonly retention: 'none' | 'temporary' | 'provider_policy' | 'unknown';
  readonly trainingUse: 'not_used' | 'may_be_used' | 'unknown';
  readonly assertedBy: string;
  readonly policyUrl?: string;
}

export interface TransferRecordV1 {
  readonly id: string;
  readonly consentId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly recipient: string;
  readonly provider?: string;
  readonly model?: string;
  readonly executionLocation: ProcessingLocationV1;
  readonly sourceRevisionIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly contentCategories: NonEmptyArray<ContentCategoryV1>;
  readonly payloadDigest: SourceFingerprintV1;
  readonly payloadByteCount: number;
  readonly redactions: readonly string[];
  readonly providerPolicy: ProviderPolicyStatementV1;
}

export type RetentionStateV1 =
  | 'not_stored'
  | 'deletion_requested'
  | 'provider_reported_deleted'
  | 'locally_cleared'
  | 'status_unavailable';

export interface RetentionRecordV1 {
  readonly id: string;
  readonly subject: 'browser' | 'device' | 'paperwork' | 'provider';
  readonly state: RetentionStateV1;
  readonly assertedBy: string;
  readonly recordedAt: string;
  readonly eventId?: string;
}

export interface ComponentVersionV1 {
  readonly component:
    | 'paperwork'
    | 'parser'
    | 'ocr'
    | 'prompt_template'
    | 'provider_model'
    | 'citation_validator';
  readonly name: string;
  readonly version: string;
}

export interface ValidationSummaryV1 {
  readonly totalClaims: number;
  readonly accepted: number;
  readonly needsReview: number;
  readonly blocked: number;
  readonly stale: number;
  readonly totalActions: number;
  readonly acceptedActions: number;
  readonly needsReviewActions: number;
  readonly blockedActions: number;
  readonly staleActions: number;
}

export interface ExternalReferenceV1 {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly accessedAt: string;
}

export interface AnalysisReceiptV1 {
  readonly id: string;
  readonly createdAt: string;
  readonly processingMode:
    | 'sample'
    | 'browser_local'
    | 'desktop_local'
    | 'cloud_redacted'
    | 'cloud_full';
  readonly events: readonly ProcessingEventV1[];
  readonly consentRecords: readonly ConsentRecordV1[];
  readonly transfers: readonly TransferRecordV1[];
  readonly retention: readonly RetentionRecordV1[];
  readonly components: readonly ComponentVersionV1[];
  readonly validationSummary: ValidationSummaryV1;
  readonly externalReferences: readonly ExternalReferenceV1[];
  readonly correctionIds: readonly string[];
}

export interface CorrectionRecordV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly priorRevisionId: string;
  readonly targetSegmentId: string;
  readonly targetSpan: {
    readonly start: number;
    readonly end: number;
  };
  readonly originalText: string;
  readonly replacement: string;
  readonly actor: 'user';
  readonly createdAt: string;
  readonly resultingRevisionId: string;
  readonly invalidatedClaimIds: readonly string[];
  readonly regeneratedClaimIds: readonly string[];
}

export interface ActionPackV1 {
  readonly kind: typeof ACTION_PACK_KIND_V1;
  readonly schemaVersion: typeof ACTION_PACK_SCHEMA_VERSION_V1;
  readonly packId: string;
  readonly createdAt: string;
  readonly runMode: RunModeV1;
  readonly canonicalSources: CanonicalSourceContextV1;
  readonly analysis: ValidatedAnalysisV1;
  readonly receipt: AnalysisReceiptV1;
  readonly corrections: readonly CorrectionRecordV1[];
  readonly limitations: readonly string[];
}

declare const structurallyValidActionPackBrandV1: unique symbol;
declare const trustedActionPackBrandV1: unique symbol;

/** Transport-safe shape validation only; not authorization to render. */
export type StructurallyValidActionPackV1 = ActionPackV1 & {
  readonly [structurallyValidActionPackBrandV1]: true;
};

/** Renderable only after PaperWork-owned semantic, safety, and event checks. */
export type TrustedActionPackV1 = StructurallyValidActionPackV1 & {
  readonly [trustedActionPackBrandV1]: true;
};

export interface ActionProgressV1 {
  readonly actionId: string;
  readonly state: 'pending' | 'completed';
  readonly updatedAt: string;
}

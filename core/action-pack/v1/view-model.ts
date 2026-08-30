import type {
  ClaimProvenanceV1,
  EvidenceRefV1,
  TrustedActionPackV1,
  ValidatedActionV1,
  ValidatedClaimV1,
} from './contracts';
import { assertTrustedActionPackV1 } from './trusted-assembler';

export interface EvidenceQuoteViewModelV1 {
  readonly quote: string;
  readonly location: string;
}

export interface ClaimViewModelV1 {
  readonly id: string;
  readonly provenance: ClaimProvenanceV1;
  readonly label: string;
  readonly title: string;
  readonly statement: string;
  readonly value?: string;
  readonly rationale: string;
  readonly validationState: 'accepted' | 'needs_review' | 'blocked' | 'stale';
  readonly validatorVersion: string;
  readonly validatedAt: string;
  readonly quotes: readonly EvidenceQuoteViewModelV1[];
}

export interface ActionViewModelV1 {
  readonly id: string;
  readonly priority: string;
  readonly title: string;
  readonly description: string;
  readonly due: string;
  readonly provenance: 'document_requirement' | 'paperwork_suggestion';
  readonly evidenceClaimId: string;
}

export interface ActionPackViewModelV1 {
  readonly source: {
    readonly name: string;
    readonly meta: string;
    readonly pageCount: number;
    readonly fingerprint: string;
  };
  readonly documentType: string;
  readonly brief: string;
  readonly nearestDeadline?: string;
  readonly claims: readonly ClaimViewModelV1[];
  readonly facts: readonly ClaimViewModelV1[];
  readonly attention: readonly ClaimViewModelV1[];
  readonly missingInformation: readonly ClaimViewModelV1[];
  readonly conflicts: readonly ClaimViewModelV1[];
  readonly actions: readonly ActionViewModelV1[];
  readonly primaryAction?: ActionViewModelV1;
  readonly receipt: {
    readonly processingMode: string;
    readonly completedAt: string;
    readonly parser: string;
    readonly validator: string;
    readonly transferCount: number;
    readonly providerUsed: boolean;
    readonly serverUsed: boolean;
    readonly browserRetention: string;
  };
  readonly validation: {
    readonly acceptedClaims: number;
    readonly reviewClaims: number;
    readonly withheld: number;
  };
  readonly limitations: readonly string[];
}

function humanizeToken(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function locationForEvidence(pack: TrustedActionPackV1, reference: EvidenceRefV1) {
  const segment = pack.canonicalSources.sourceSegments.find((item) => item.id === reference.segmentId);
  if (!segment) return 'Canonical source passage';
  if (segment.anchor.kind === 'page_region') return `Page ${segment.anchor.page} · extracted region`;
  if (segment.anchor.kind === 'page_text') return `Page ${segment.anchor.page} · block ${segment.anchor.block + 1}`;
  if (segment.anchor.kind === 'plain_text') return `Characters ${segment.anchor.characterStart + 1}–${segment.anchor.characterEnd}`;
  return segment.anchor.url;
}

function labelForClaim(claim: ValidatedClaimV1) {
  switch (claim.provenance) {
    case 'source_fact': return 'From your PDF';
    case 'inference': return 'PaperWork inference';
    case 'suggestion': return 'Suggested next step';
    case 'not_confirmed': return 'Not confirmed';
    case 'conflict': return 'Conflicting source terms';
  }
}

function rationaleForClaim(claim: ValidatedClaimV1) {
  if (claim.provenance === 'inference' || claim.provenance === 'suggestion' || claim.provenance === 'conflict') return claim.rationale;
  if (claim.provenance === 'not_confirmed') return claim.reason;
  return 'The independent citation validator matched this statement to the exact extracted passage shown here.';
}

function valueForClaim(claim: ValidatedClaimV1) {
  const value = claim.normalizedValues[0];
  if (!value) return undefined;
  if (value.kind === 'date') return value.value;
  if (value.kind === 'money') return `${value.currency} ${new Intl.NumberFormat('en-IN').format(Number(value.amount))}`;
  return `${value.value} ${value.unit}${value.value === 1 ? '' : 's'}`;
}

function referencesForClaim(claim: ValidatedClaimV1): readonly EvidenceRefV1[] {
  if (claim.provenance === 'suggestion') return [];
  if (claim.provenance === 'conflict') return claim.alternatives.flatMap((alternative) => alternative.evidence);
  return claim.evidence;
}

function claimView(pack: TrustedActionPackV1, claim: ValidatedClaimV1): ClaimViewModelV1 {
  return {
    id: claim.id,
    provenance: claim.provenance,
    label: labelForClaim(claim),
    title: claim.title,
    statement: claim.statement,
    value: valueForClaim(claim),
    rationale: rationaleForClaim(claim),
    validationState: claim.validation.state,
    validatorVersion: claim.validation.validatorVersion,
    validatedAt: claim.validation.validatedAt,
    quotes: referencesForClaim(claim).map((reference) => ({
      quote: reference.quote,
      location: locationForEvidence(pack, reference),
    })),
  };
}

function actionDue(action: ValidatedActionV1) {
  if (action.timing.kind === 'calendar_date') return action.timing.date;
  if (action.timing.kind === 'condition') return action.timing.label;
  return 'No date stated';
}

export function toActionPackViewModelV1(pack: TrustedActionPackV1): ActionPackViewModelV1 {
  assertTrustedActionPackV1(pack);
  const source = pack.canonicalSources.sources[0];
  const revision = pack.canonicalSources.sourceRevisions[0];
  const claimsById = new Map(pack.analysis.claims.map((claim) => [claim.id, claim]));
  const actionsById = new Map(pack.analysis.actions.map((action) => [action.id, action]));
  const allClaims = pack.analysis.claims.map((claim) => claimView(pack, claim));
  const claimViewsById = new Map(allClaims.map((claim) => [claim.id, claim]));
  const actionViews = pack.analysis.sections.planActionIds
    .map((id) => actionsById.get(id))
    .filter((action): action is ValidatedActionV1 => Boolean(action))
    .map((action) => ({
      id: action.id,
      priority: humanizeToken(action.priority),
      title: action.title,
      description: action.description,
      due: actionDue(action),
      provenance: action.provenance,
      evidenceClaimId: action.basisClaimIds[0],
    }));
  const component = (kind: 'parser' | 'citation_validator') => pack.receipt.components.find((item) => item.component === kind);
  const lastEvent = pack.receipt.events.at(-1);
  const nearestDeadline = pack.analysis.document.nearestDeadlineClaimId
    ? claimsById.get(pack.analysis.document.nearestDeadlineClaimId)?.normalizedValues.find((item) => item.kind === 'date')
    : undefined;
  const bySection = (ids: readonly string[]) => ids
    .map((id) => claimViewsById.get(id))
    .filter((claim): claim is ClaimViewModelV1 => Boolean(claim));
  const summary = pack.receipt.validationSummary;

  return {
    source: {
      name: source.displayName,
      meta: `PDF · ${source.pageCount ?? 0} page${source.pageCount === 1 ? '' : 's'} · ${(source.byteSize ?? 0) < 1024 * 1024 ? `${Math.max(1, Math.round((source.byteSize ?? 0) / 1024))} KB` : `${((source.byteSize ?? 0) / 1024 / 1024).toFixed(1)} MB`}`,
      pageCount: source.pageCount ?? 0,
      fingerprint: revision.fingerprint.value,
    },
    documentType: humanizeToken(pack.analysis.document.documentType),
    brief: pack.analysis.sections.briefClaimIds
      .map((id) => claimsById.get(id)?.statement)
      .filter((statement): statement is string => Boolean(statement))
      .join(' '),
    nearestDeadline: nearestDeadline?.kind === 'date' ? nearestDeadline.value : undefined,
    claims: allClaims,
    facts: bySection(pack.analysis.sections.factClaimIds),
    attention: bySection(pack.analysis.sections.attentionClaimIds),
    missingInformation: bySection(pack.analysis.sections.missingInformationClaimIds),
    conflicts: bySection(pack.analysis.sections.conflictClaimIds),
    actions: actionViews,
    primaryAction: pack.analysis.document.primaryActionId
      ? actionViews.find((action) => action.id === pack.analysis.document.primaryActionId)
      : undefined,
    receipt: {
      processingMode: 'Browser-local',
      completedAt: lastEvent?.occurredAt ?? pack.receipt.createdAt,
      parser: component('parser') ? `${component('parser')!.name} ${component('parser')!.version}` : 'Recorded local parser',
      validator: component('citation_validator') ? `${component('citation_validator')!.name} ${component('citation_validator')!.version}` : 'Recorded citation validator',
      transferCount: pack.receipt.transfers.length,
      providerUsed: pack.receipt.events.some((event) => event.actor.location === 'provider'),
      serverUsed: pack.receipt.events.some((event) => event.actor.location === 'paperwork_service'),
      browserRetention: humanizeToken(pack.receipt.retention.find((item) => item.subject === 'browser')?.state ?? 'status_unavailable'),
    },
    validation: {
      acceptedClaims: summary.accepted,
      reviewClaims: summary.needsReview,
      withheld: summary.blocked + summary.stale + summary.blockedActions + summary.staleActions,
    },
    limitations: pack.limitations,
  };
}

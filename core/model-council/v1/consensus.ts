import {
  MODEL_COUNCIL_CONSENSUS_KIND_V1,
  MODEL_COUNCIL_FIELD_IDS_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  PROVIDER_IDS_V1,
  type ModelCouncilConsensusV1,
  type ModelCouncilFieldCandidateV1,
  type ModelCouncilFieldConsensusV1,
  type ModelCouncilFieldIdV1,
  type ModelCouncilFieldValueV1,
  type ModelCouncilRunResultV1,
  type ProviderIdV1,
} from './contracts';

function providerOrder(left: ProviderIdV1, right: ProviderIdV1) {
  return PROVIDER_IDS_V1.indexOf(left) - PROVIDER_IDS_V1.indexOf(right);
}

function cloneValue(value: ModelCouncilFieldValueV1 | null): ModelCouncilFieldValueV1 | null {
  if (value === null) return null;
  switch (value.kind) {
    case 'text': return { kind: 'text', text: value.text };
    case 'date': return { kind: 'date', value: value.value };
    case 'money': return {
      kind: 'money',
      amount: value.amount,
      currency: value.currency,
      basis: 'annual',
    };
    case 'duration': return { kind: 'duration', value: value.value, unit: value.unit };
  }
}

/** Values reaching this function have already passed normalized runtime validation. */
function exactNormalizedValueKey(value: ModelCouncilFieldValueV1 | null) {
  if (value === null) return 'null';
  switch (value.kind) {
    case 'text': return `text:${JSON.stringify(value.text)}`;
    case 'date': return `date:${value.value}`;
    case 'money': return `money:${value.amount}:${value.currency}:annual`;
    case 'duration': return `duration:${value.value}:${value.unit}`;
  }
}

function fieldValue(
  result: Extract<ModelCouncilRunResultV1, { readonly status: 'completed' }>,
  field: ModelCouncilFieldIdV1,
): ModelCouncilFieldValueV1 | null {
  return result.analysis.fields[field]?.value ?? null;
}

function buildFieldConsensusV1(
  field: ModelCouncilFieldIdV1,
  completedResults: readonly Extract<ModelCouncilRunResultV1, { readonly status: 'completed' }>[],
): ModelCouncilFieldConsensusV1 {
  const providers = completedResults.map((result) => result.provider);
  if (completedResults.length === 0) {
    return {
      field,
      status: 'no_result',
      agreedValue: null,
      providers: [],
      candidates: [],
    };
  }

  const groups = new Map<string, { value: ModelCouncilFieldValueV1 | null; providers: ProviderIdV1[] }>();
  completedResults.forEach((result) => {
    const value = fieldValue(result, field);
    const key = exactNormalizedValueKey(value);
    const existing = groups.get(key);
    if (existing) {
      existing.providers.push(result.provider);
    } else {
      groups.set(key, { value: cloneValue(value), providers: [result.provider] });
    }
  });

  const candidates: ModelCouncilFieldCandidateV1[] = [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, candidate]) => ({
      value: cloneValue(candidate.value),
      providers: [...candidate.providers].sort(providerOrder),
    }));

  if (completedResults.length === 1) {
    return {
      field,
      status: 'single_result',
      agreedValue: null,
      providers,
      candidates,
    };
  }

  if (candidates.length === 1) {
    return {
      field,
      status: 'agreement',
      agreedValue: cloneValue(candidates[0].value),
      providers,
      candidates,
    };
  }

  return {
    field,
    status: 'disagreement',
    agreedValue: null,
    providers,
    candidates,
  };
}

/**
 * Compares only exact, already-normalized values. Agreement is deliberately
 * branded as untrusted model agreement and never confers source-fact authority.
 */
export function buildModelCouncilConsensusV1(
  results: readonly ModelCouncilRunResultV1[],
): ModelCouncilConsensusV1 {
  const seen = new Set<ProviderIdV1>();
  results.forEach((result) => {
    if (seen.has(result.provider)) throw new TypeError(`Duplicate provider result: ${result.provider}`);
    seen.add(result.provider);
  });
  const completed = results
    .filter((result): result is Extract<ModelCouncilRunResultV1, { readonly status: 'completed' }> => result.status === 'completed')
    .sort((left, right) => providerOrder(left.provider, right.provider));

  const fields = Object.fromEntries(
    MODEL_COUNCIL_FIELD_IDS_V1.map((field) => [field, buildFieldConsensusV1(field, completed)]),
  ) as unknown as ModelCouncilConsensusV1['fields'];

  return {
    kind: MODEL_COUNCIL_CONSENSUS_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    trust: 'untrusted_model_agreement',
    fields,
  };
}

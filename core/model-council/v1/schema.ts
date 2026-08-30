const ID_SCHEMA_V1 = {
  type: 'string',
} as const;

const NORMALIZED_TEXT_SCHEMA_V1 = {
  type: 'string',
} as const;

const EVIDENCE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceRevisionId', 'segmentId', 'page', 'quote'],
  properties: {
    sourceRevisionId: ID_SCHEMA_V1,
    segmentId: ID_SCHEMA_V1,
    page: { type: 'integer' },
    quote: { type: 'string' },
  },
} as const;

const TEXT_VALUE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'text'],
  properties: {
    kind: { const: 'text' },
    text: NORMALIZED_TEXT_SCHEMA_V1,
  },
} as const;

const DATE_VALUE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: {
    kind: { const: 'date' },
    value: {
      type: 'string',
    },
  },
} as const;

const MONEY_VALUE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'amount', 'currency', 'basis'],
  properties: {
    kind: { const: 'money' },
    amount: {
      type: 'string',
    },
    currency: { type: 'string' },
    basis: { const: 'annual' },
  },
} as const;

const DURATION_VALUE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value', 'unit'],
  properties: {
    kind: { const: 'duration' },
    value: { type: 'integer' },
    unit: { enum: ['day', 'week', 'month', 'year'] },
  },
} as const;

function sourceBackedFieldSchemaV1(valueReference: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'evidence'],
    properties: {
      value: { $ref: valueReference },
      evidence: {
        type: 'array',
        items: { $ref: '#/$defs/evidence' },
      },
    },
  } as const;
}

function nullableFieldSchemaV1(fieldReference: string) {
  return {
    anyOf: [
      { $ref: fieldReference },
      { type: 'null' },
    ],
  } as const;
}

/**
 * Provider-native structured-output schema for the only accepted v1 model output.
 * This deliberately uses the structural intersection supported by the provider
 * adapters. Length, pattern, numeric-range, real-date, and evidence constraints
 * are enforced by PaperWork's runtime validator because provider schema engines
 * do not implement those keywords consistently. Refusal paths are validated too.
 */
export const PROVIDER_ANALYSIS_JSON_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'schemaVersion', 'documentType', 'sourceRevisionId', 'fields'],
  properties: {
    kind: { const: 'paperwork.provider_analysis' },
    schemaVersion: { const: '1.0.0' },
    documentType: { const: 'employment_offer' },
    sourceRevisionId: ID_SCHEMA_V1,
    fields: {
      type: 'object',
      additionalProperties: false,
      required: [
        'role',
        'acceptanceDeadline',
        'startDate',
        'annualBaseSalary',
        'workLocation',
        'probation',
        'actionRequired',
      ],
      properties: {
        role: nullableFieldSchemaV1('#/$defs/textField'),
        acceptanceDeadline: nullableFieldSchemaV1('#/$defs/dateField'),
        startDate: nullableFieldSchemaV1('#/$defs/dateField'),
        annualBaseSalary: nullableFieldSchemaV1('#/$defs/moneyField'),
        workLocation: nullableFieldSchemaV1('#/$defs/textField'),
        probation: nullableFieldSchemaV1('#/$defs/durationField'),
        actionRequired: nullableFieldSchemaV1('#/$defs/textField'),
      },
    },
  },
  $defs: {
    evidence: EVIDENCE_SCHEMA_V1,
    textValue: TEXT_VALUE_SCHEMA_V1,
    dateValue: DATE_VALUE_SCHEMA_V1,
    moneyValue: MONEY_VALUE_SCHEMA_V1,
    durationValue: DURATION_VALUE_SCHEMA_V1,
    textField: sourceBackedFieldSchemaV1('#/$defs/textValue'),
    dateField: sourceBackedFieldSchemaV1('#/$defs/dateValue'),
    moneyField: sourceBackedFieldSchemaV1('#/$defs/moneyValue'),
    durationField: sourceBackedFieldSchemaV1('#/$defs/durationValue'),
  },
} as const;

import {
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  DOCUMENT_FIELD_IDS_V1,
  DOCUMENT_GROUP_KINDS_V1,
  DOCUMENT_REQUIREMENT_OPERATIONS_V1,
  DOCUMENT_SUGGESTION_INTENTS_V1,
  DOCUMENT_TYPES_V1,
  PROVIDER_DOCUMENT_ANALYSIS_KIND_V1,
} from './contracts';

const STRING = { type: 'string' } as const;
const INTEGER = { type: 'integer' } as const;

const EVIDENCE = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceRevisionId', 'segmentId', 'page', 'span', 'quote'],
  properties: {
    sourceRevisionId: STRING,
    segmentId: STRING,
    page: INTEGER,
    span: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: { start: INTEGER, end: INTEGER },
    },
    quote: STRING,
  },
} as const;

const GROUP = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'index'],
  properties: {
    kind: { enum: DOCUMENT_GROUP_KINDS_V1 },
    index: INTEGER,
  },
} as const;

const TEXT_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'text'],
  properties: { kind: { const: 'text' }, text: STRING },
} as const;

const DATE_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: { kind: { const: 'date' }, value: STRING },
} as const;

const MONEY_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'amount', 'currency', 'basis'],
  properties: {
    kind: { const: 'money' },
    amount: STRING,
    currency: STRING,
    basis: { enum: ['one_time', 'hourly', 'monthly', 'annual', 'subtotal', 'tax', 'discount', 'total', 'amount_due'] },
  },
} as const;

const DURATION_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value', 'unit'],
  properties: {
    kind: { const: 'duration' },
    value: INTEGER,
    unit: { enum: ['day', 'week', 'month', 'year'] },
  },
} as const;

const DECIMAL_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: { kind: { const: 'decimal' }, value: STRING },
} as const;

const PERCENTAGE_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: { kind: { const: 'percentage' }, value: STRING },
} as const;

const VALUE = {
  anyOf: [
    { $ref: '#/$defs/textValue' },
    { $ref: '#/$defs/dateValue' },
    { $ref: '#/$defs/moneyValue' },
    { $ref: '#/$defs/durationValue' },
    { $ref: '#/$defs/decimalValue' },
    { $ref: '#/$defs/percentageValue' },
  ],
} as const;

const EVIDENCE_ARRAY = {
  type: 'array',
  minItems: 0,
  maxItems: 4,
  items: { $ref: '#/$defs/evidence' },
} as const;

const FINDING = {
  type: 'object',
  additionalProperties: false,
  required: ['fieldId', 'group', 'value', 'evidence'],
  properties: {
    fieldId: { enum: DOCUMENT_FIELD_IDS_V1 },
    group: { anyOf: [{ $ref: '#/$defs/group' }, { type: 'null' }] },
    value: VALUE,
    evidence: EVIDENCE_ARRAY,
  },
} as const;

const REQUIREMENT = {
  type: 'object',
  additionalProperties: false,
  required: ['operation', 'text', 'due', 'evidence'],
  properties: {
    operation: { enum: DOCUMENT_REQUIREMENT_OPERATIONS_V1 },
    text: STRING,
    due: {
      anyOf: [
        { $ref: '#/$defs/dateValue' },
        { $ref: '#/$defs/durationValue' },
        { type: 'null' },
      ],
    },
    evidence: EVIDENCE_ARRAY,
  },
} as const;

const CONFLICT_ALTERNATIVE = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'evidence'],
  properties: { value: VALUE, evidence: EVIDENCE_ARRAY },
} as const;

const CONFLICT = {
  type: 'object',
  additionalProperties: false,
  required: ['fieldId', 'group', 'alternatives'],
  properties: {
    fieldId: { enum: DOCUMENT_FIELD_IDS_V1 },
    group: { anyOf: [{ $ref: '#/$defs/group' }, { type: 'null' }] },
    alternatives: { type: 'array', minItems: 2, maxItems: 8, items: { $ref: '#/$defs/conflictAlternative' } },
  },
} as const;

const SUGGESTION = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'basisFindingIndexes'],
  properties: {
    intent: { enum: DOCUMENT_SUGGESTION_INTENTS_V1 },
    basisFindingIndexes: { type: 'array', minItems: 1, maxItems: 8, items: INTEGER },
  },
} as const;

/**
 * Provider-native structured output. Provider implementations differ in their
 * support for JSON Schema constraints, so every semantic and size check is
 * repeated by PaperWork's runtime validator.
 */
export const PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'schemaVersion',
    'sourceRevisionId',
    'documentType',
    'documentTypeEvidence',
    'findings',
    'requirements',
    'conflicts',
    'suggestions',
  ],
  properties: {
    kind: { const: PROVIDER_DOCUMENT_ANALYSIS_KIND_V1 },
    schemaVersion: { const: DOCUMENT_AGENT_SCHEMA_VERSION_V1 },
    sourceRevisionId: STRING,
    documentType: { enum: DOCUMENT_TYPES_V1 },
    documentTypeEvidence: EVIDENCE_ARRAY,
    findings: { type: 'array', minItems: 1, maxItems: 64, items: { $ref: '#/$defs/finding' } },
    requirements: { type: 'array', minItems: 0, maxItems: 32, items: { $ref: '#/$defs/requirement' } },
    conflicts: { type: 'array', minItems: 0, maxItems: 16, items: { $ref: '#/$defs/conflict' } },
    suggestions: { type: 'array', minItems: 0, maxItems: 8, items: { $ref: '#/$defs/suggestion' } },
  },
  $defs: {
    evidence: EVIDENCE,
    group: GROUP,
    textValue: TEXT_VALUE,
    dateValue: DATE_VALUE,
    moneyValue: MONEY_VALUE,
    durationValue: DURATION_VALUE,
    decimalValue: DECIMAL_VALUE,
    percentageValue: PERCENTAGE_VALUE,
    finding: FINDING,
    requirement: REQUIREMENT,
    conflictAlternative: CONFLICT_ALTERNATIVE,
    conflict: CONFLICT,
    suggestion: SUGGESTION,
  },
} as const;

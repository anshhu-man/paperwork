import {
  MODEL_COUNCIL_CATALOG_KIND_V1,
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  type ModelCouncilCatalogV1,
  type ModelCouncilProviderAccessV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';

export interface ProviderRuntimeV1 {
  readonly id: ProviderIdV1;
  readonly displayName: string;
  readonly model: string | null;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly access: ModelCouncilProviderAccessV1;
  readonly recipient: string;
  readonly privacyUrl: string;
  readonly disclosure: string;
  readonly apiKey?: string;
  readonly endpoint: string;
}

interface ProviderDefinitionV1 {
  readonly id: ProviderIdV1;
  readonly displayName: string;
  readonly keyEnvironmentName?: string;
  readonly modelEnvironmentName: string;
  readonly access: ModelCouncilProviderAccessV1;
  readonly recipient: string;
  readonly privacyUrl: string;
  readonly disclosure: string;
}

const DEFINITIONS: readonly ProviderDefinitionV1[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    keyEnvironmentName: 'OPENAI_API_KEY',
    modelEnvironmentName: 'OPENAI_MODEL',
    access: 'commercial_api',
    recipient: 'OpenAI API',
    privacyUrl: 'https://platform.openai.com/docs/models/default-usage-policies-by-endpoint',
    disclosure: 'Commercial hosted API. Calls can incur OpenAI usage charges. PaperWork requests store=false; provider abuse-monitoring and account data controls may still apply.',
  },
  {
    id: 'anthropic',
    displayName: 'Claude',
    keyEnvironmentName: 'ANTHROPIC_API_KEY',
    modelEnvironmentName: 'ANTHROPIC_MODEL',
    access: 'commercial_api',
    recipient: 'Anthropic API',
    privacyUrl: 'https://platform.claude.com/docs/en/manage-claude/api-and-data-retention',
    disclosure: 'Commercial hosted API. Calls can incur Anthropic usage charges. Standard API retention applies unless the operator has an approved zero-data-retention arrangement.',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    keyEnvironmentName: 'MISTRAL_API_KEY',
    modelEnvironmentName: 'MISTRAL_MODEL',
    access: 'hosted_api_model_license_varies',
    recipient: 'Mistral API',
    privacyUrl: 'https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls',
    disclosure: 'Metered hosted API. Some Mistral models are open-weight and others use different licenses; check the exact selected model before use.',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    keyEnvironmentName: 'DEEPSEEK_API_KEY',
    modelEnvironmentName: 'DEEPSEEK_MODEL',
    access: 'open_weight_hosted_api',
    recipient: 'DeepSeek API',
    privacyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    disclosure: 'Metered hosted API for an open-weight model. Provider caching, retention, training controls and mainland-China processing terms may apply.',
  },
  {
    id: 'ollama',
    displayName: 'Ollama / local model',
    modelEnvironmentName: 'OLLAMA_MODEL',
    access: 'self_hosted',
    recipient: 'Configured Ollama host',
    privacyUrl: 'https://docs.ollama.com/capabilities/structured-outputs',
    disclosure: 'Browser-direct loopback inference. Selected passages go from this tab to the exact local Ollama origin; its operator controls privacy, retention and compute.',
  },
] as const;

function isEnabled(environment: NodeJS.ProcessEnv) {
  if (environment.PAPERWORK_MODEL_COUNCIL_ENABLED !== 'true') return false;
  // A public origin is not an authentication or quota boundary. Hosted model
  // calls remain impossible in production until PaperWork has real per-user
  // authorization, distributed quotas, replay protection and spend caps.
  return environment.NODE_ENV === 'development';
}

function endpointFor(provider: ProviderIdV1, environment: NodeJS.ProcessEnv) {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1/responses';
    case 'anthropic': return 'https://api.anthropic.com/v1/messages';
    case 'mistral': {
      const allowedBases = new Set([
        'https://api.mistral.ai',
        'https://api.us.mistral.ai',
        'https://api.eu.mistral.ai',
      ]);
      const requestedBase = environment.MISTRAL_BASE_URL?.trim() || 'https://api.mistral.ai';
      return allowedBases.has(requestedBase) ? `${requestedBase}/v1/chat/completions` : '';
    }
    case 'deepseek': return 'https://api.deepseek.com/responses';
    case 'ollama': {
      const base = environment.OLLAMA_BASE_URL?.trim();
      if (!base) return '';
      try {
        const parsed = new URL(base);
        const localDevelopment = environment.NODE_ENV === 'development'
          && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
        if (!localDevelopment || parsed.protocol !== 'http:' || parsed.username || parsed.password
            || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== base) return '';
        return new URL('/api/chat', `${parsed.origin}/`).toString();
      } catch {
        return '';
      }
    }
  }
}

export function getProviderRuntimesV1(
  environment: NodeJS.ProcessEnv = process.env,
): readonly ProviderRuntimeV1[] {
  const globallyEnabled = isEnabled(environment);
  return DEFINITIONS.map((definition) => {
    const model = environment[definition.modelEnvironmentName]?.trim() || null;
    const apiKey = definition.keyEnvironmentName
      ? environment[definition.keyEnvironmentName]?.trim()
      : undefined;
    const endpoint = endpointFor(definition.id, environment);
    const configured = Boolean(model && endpoint && (definition.id === 'ollama' || apiKey));
    const recipient = definition.id === 'ollama' && endpoint
      ? `Ollama at ${new URL(endpoint).origin}`
      : definition.id === 'mistral' && endpoint
        ? `Mistral API at ${new URL(endpoint).origin}`
        : definition.recipient;
    return Object.freeze({
      id: definition.id,
      displayName: definition.displayName,
      model,
      configured,
      enabled: globallyEnabled && configured,
      access: definition.access,
      recipient,
      privacyUrl: definition.privacyUrl,
      disclosure: definition.disclosure,
      apiKey,
      endpoint,
    });
  });
}

export function getPublicProviderCatalogV1(
  environment: NodeJS.ProcessEnv = process.env,
  now: () => string = () => new Date().toISOString(),
): ModelCouncilCatalogV1 {
  const runtimes = getProviderRuntimesV1(environment);
  const providers = runtimes.map((provider) => Object.freeze({
    id: provider.id,
    displayName: provider.displayName,
    availability: provider.enabled ? 'configured' as const : provider.configured ? 'disabled' as const : 'not_configured' as const,
    model: provider.model,
    execution: provider.id === 'ollama' ? 'self_hosted' as const : 'provider_api' as const,
    access: provider.access,
    recipient: provider.recipient,
    structuredOutput: 'json_schema' as const,
    policyUrl: provider.privacyUrl,
    disclosure: provider.disclosure,
  }));
  return Object.freeze({
    kind: MODEL_COUNCIL_CATALOG_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    catalogVersion: MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    enabled: runtimes.some((provider) => provider.enabled),
    generatedAt: now(),
    providers,
  });
}

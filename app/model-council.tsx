'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { TrustedActionPackV1 } from '@/core/action-pack/v1';
import {
  MODEL_COUNCIL_FIELD_IDS_V1,
  MODEL_COUNCIL_RECEIPT_KIND_V1,
  MODEL_COUNCIL_RESPONSE_KIND_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  browserDirectOllamaEndpointV1,
  buildModelCouncilConsensusV1,
  digestModelCouncilPayloadV1,
  parseModelCouncilCatalogV1,
  parseModelCouncilResponseV1,
  prepareModelCouncilPayloadV1,
  runBrowserDirectOllamaV1,
  serializeModelCouncilPayloadV1,
  type ModelCouncilCatalogV1,
  type ModelCouncilFieldIdV1,
  type ModelCouncilFieldValueV1,
  type ModelCouncilPayloadDigestV1,
  type ModelCouncilPayloadV1,
  type ModelCouncilProviderTargetV1,
  type ModelCouncilResponseV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';

interface PreviewState {
  readonly payload: ModelCouncilPayloadV1;
  readonly digest: ModelCouncilPayloadDigestV1;
  readonly exactJson: string;
}

const FIELD_COPY: Readonly<Record<ModelCouncilFieldIdV1, string>> = {
  role: 'Offered role',
  acceptanceDeadline: 'Acceptance deadline',
  startDate: 'Start date',
  annualBaseSalary: 'Annual base salary',
  workLocation: 'Work location',
  probation: 'Probation period',
  actionRequired: 'Document requirement',
};

const FAILURE_COPY = {
  council_disabled: 'The model council is disabled on this deployment.',
  not_configured: 'This provider is not configured.',
  provider_timeout: 'The provider did not finish within the bounded time.',
  provider_rejected: 'The provider rejected the request. Check its account, model access, or quota.',
  provider_unavailable: 'The provider is temporarily unavailable.',
  network_failure: 'The provider response could not be completed.',
  invalid_provider_output: 'PaperWork rejected the provider output because it did not match the exact schema or source passages.',
  internal_error: 'PaperWork safely withheld this provider result.',
} as const;

function valueText(value: ModelCouncilFieldValueV1 | null) {
  if (!value) return 'Not found';
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.value;
  if (value.kind === 'money') return `${value.currency} ${value.amount} · ${value.basis}`;
  return `${value.value} ${value.unit}${value.value === 1 ? '' : 's'}`;
}

function pageFor(anchor: TrustedActionPackV1['canonicalSources']['sourceSegments'][number]['anchor']) {
  return anchor.kind === 'page_text' || anchor.kind === 'page_region' ? anchor.page : 0;
}

function providerClass(access?: string) {
  if (access === 'self_hosted') return 'local';
  if (access === 'open_weight_hosted_api') return 'open-weight';
  if (access === 'hosted_api_model_license_varies') return 'hosted';
  return 'commercial';
}

function accessLabel(access?: string) {
  if (access === 'self_hosted') return 'Self-hosted';
  if (access === 'open_weight_hosted_api') return 'Open-weight · hosted API';
  if (access === 'hosted_api_model_license_varies') return 'Hosted API · model license varies';
  return 'Commercial API';
}

function pageOrigin() {
  return typeof globalThis.location === 'object' ? globalThis.location.origin : '';
}

function isBrowserDirectOllamaTarget(target: ModelCouncilProviderTargetV1 | undefined) {
  return Boolean(target && browserDirectOllamaEndpointV1(target, pageOrigin()));
}

export function ModelCouncilWorkspace({ pack }: { readonly pack: TrustedActionPackV1 }) {
  const [catalog, setCatalog] = useState<ModelCouncilCatalogV1>();
  const [catalogError, setCatalogError] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedProviders, setSelectedProviders] = useState<readonly ProviderIdV1[]>([]);
  const [includedSegmentIds, setIncludedSegmentIds] = useState<readonly string[]>(
    () => pack.canonicalSources.sourceSegments.map((segment) => segment.id),
  );
  const [preview, setPreview] = useState<PreviewState>();
  const [approved, setApproved] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ModelCouncilResponseV1>();
  const [runError, setRunError] = useState<string>();
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
  const preparationRevisionRef = useRef(0);

  const sourceRevision = pack.canonicalSources.sourceRevisions.find((revision) => revision.status === 'active');
  const canonicalSegments = useMemo(() => pack.canonicalSources.sourceSegments.map((segment) => ({
    segmentId: segment.id,
    page: pageFor(segment.anchor),
    text: segment.text,
  })), [pack]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/model-council/catalog', { cache: 'no-store', signal: controller.signal })
      .then(async (catalogResponse) => {
        if (!catalogResponse.ok) throw new Error('catalog unavailable');
        return catalogResponse.json() as Promise<unknown>;
      })
      .then((value) => {
        const parsed = parseModelCouncilCatalogV1(value);
        if (!parsed.ok) throw new Error('invalid catalog');
        setCatalog(parsed.value);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setCatalogError(true);
      });
    return () => controller.abort();
  }, [catalogAttempt]);

  function invalidatePreparedRun() {
    preparationRevisionRef.current += 1;
    setPreparing(false);
    setPreview(undefined);
    setApproved(false);
    setResponse(undefined);
    setRunError(undefined);
    setDeliveryUncertain(false);
  }

  function toggleProvider(provider: ProviderIdV1) {
    if (preparing || running) return;
    const entry = catalog?.providers.find((item) => item.id === provider);
    const target = entry?.model
      ? { provider: entry.id, model: entry.model, recipient: entry.recipient }
      : undefined;
    const selectingDirectOllama = isBrowserDirectOllamaTarget(target);
    setSelectedProviders((current) => {
      if (current.includes(provider)) return current.filter((item) => item !== provider);
      if (selectingDirectOllama) return [provider];
      const withoutDirectOllama = current.filter((item) => {
        const currentEntry = catalog?.providers.find((candidate) => candidate.id === item);
        return !isBrowserDirectOllamaTarget(currentEntry?.model ? {
          provider: currentEntry.id,
          model: currentEntry.model,
          recipient: currentEntry.recipient,
        } : undefined);
      });
      return [...withoutDirectOllama, provider];
    });
    invalidatePreparedRun();
  }

  function toggleSegment(segmentId: string) {
    if (preparing || running) return;
    setIncludedSegmentIds((current) => current.includes(segmentId)
      ? current.filter((item) => item !== segmentId)
      : [...current, segmentId]);
    invalidatePreparedRun();
  }

  function includeAllSegments(include: boolean) {
    if (preparing || running) return;
    setIncludedSegmentIds(include ? canonicalSegments.map((segment) => segment.segmentId) : []);
    invalidatePreparedRun();
  }

  async function createPreview() {
    if (!sourceRevision || !catalog || selectedProviders.length === 0 || includedSegmentIds.length === 0 || preparing || running) return;
    const preparationRevision = preparationRevisionRef.current + 1;
    preparationRevisionRef.current = preparationRevision;
    setPreparing(true);
    setPreview(undefined);
    setResponse(undefined);
    setApproved(false);
    setRunError(undefined);
    setDeliveryUncertain(false);
    try {
      const selected = new Set(includedSegmentIds);
      const providerTargets = catalog.providers
        .filter((provider) => selectedProviders.includes(provider.id))
        .map((provider) => {
          if (provider.availability !== 'configured' || !provider.model) {
            throw new TypeError('A selected provider is no longer available.');
          }
          const target = { provider: provider.id, model: provider.model, recipient: provider.recipient };
          if (provider.id === 'ollama' && !isBrowserDirectOllamaTarget(target)) {
            throw new TypeError('Loopback Ollama is unavailable from this page origin.');
          }
          return target;
        });
      if (providerTargets.length !== selectedProviders.length) throw new TypeError('A selected provider is missing.');
      if (providerTargets.some(isBrowserDirectOllamaTarget) && providerTargets.length !== 1) {
        throw new TypeError('Loopback Ollama must be reviewed separately from hosted providers.');
      }
      const payload = prepareModelCouncilPayloadV1({
        sourceRevisionId: sourceRevision.id,
        sourceFingerprint: sourceRevision.fingerprint,
        providerTargets,
        segments: canonicalSegments.filter((segment) => selected.has(segment.segmentId)),
      });
      const digest = await digestModelCouncilPayloadV1(payload);
      if (preparationRevisionRef.current !== preparationRevision) return;
      setPreview({ payload, digest, exactJson: serializeModelCouncilPayloadV1(payload) });
    } catch {
      if (preparationRevisionRef.current !== preparationRevision) return;
      setPreview(undefined);
      setApproved(false);
      setDeliveryUncertain(false);
      setRunError('PaperWork cannot prepare these passages for provider review. Remove unsafe or unsupported passages; nothing was sent.');
    } finally {
      if (preparationRevisionRef.current === preparationRevision) setPreparing(false);
    }
  }

  async function runCouncil() {
    if (!preview || !approved || running) return;
    setRunning(true);
    setResponse(undefined);
    setRunError(undefined);
    setDeliveryUncertain(false);
    const requestId = `request.${crypto.randomUUID()}`;
    const consent = {
      approvedBy: 'user' as const,
      recordedAt: new Date().toISOString(),
      providers: preview.payload.providers,
      previewDigest: { algorithm: preview.digest.algorithm, value: preview.digest.value },
      previewByteCount: preview.digest.byteCount,
    };
    const councilRequest = {
      kind: 'paperwork.model_council_request',
      schemaVersion: '1.0.0',
      requestId,
      payload: preview.payload,
      consent,
    };
    try {
      const directTarget = preview.payload.providerTargets.length === 1
        ? preview.payload.providerTargets[0]
        : undefined;
      if (directTarget && isBrowserDirectOllamaTarget(directTarget)) {
        const result = await runBrowserDirectOllamaV1(councilRequest);
        const transferStatus = result.status === 'completed'
          ? 'completed' as const
          : result.status === 'failed'
            ? 'failed' as const
            : 'not_sent' as const;
        const directResponse: ModelCouncilResponseV1 = {
          kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
          schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
          requestId,
          results: [result],
          consensus: buildModelCouncilConsensusV1([result]),
          receipt: {
            kind: MODEL_COUNCIL_RECEIPT_KIND_V1,
            schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
            receiptId: `receipt.${crypto.randomUUID()}`,
            requestId,
            consent,
            gatewayTransfer: {
              recipient: 'PaperWork model gateway',
              status: 'not_sent',
              startedAt: null,
              completedAt: null,
              payloadDigest: consent.previewDigest,
              payloadByteCount: consent.previewByteCount,
            },
            transfers: [{
              provider: 'ollama',
              model: directTarget.model,
              recipient: directTarget.recipient,
              channel: 'browser_to_provider',
              status: transferStatus,
              startedAt: result.status === 'unavailable' ? null : result.startedAt,
              completedAt: result.status === 'unavailable' ? null : result.completedAt,
              payloadDigest: consent.previewDigest,
              payloadByteCount: consent.previewByteCount,
              providerPolicy: {
                retention: 'unknown',
                trainingUse: 'unknown',
                assertedBy: 'Local Ollama operator configuration',
                policyUrl: 'https://docs.ollama.com/capabilities/structured-outputs',
              },
            }],
          },
        };
        const parsed = parseModelCouncilResponseV1(directResponse, preview.payload.segments, {
          requestId,
          previewDigest: consent.previewDigest,
          previewByteCount: consent.previewByteCount,
          providerTargets: preview.payload.providerTargets,
        });
        if (!parsed.ok) throw new Error('PaperWork rejected an invalid direct Ollama response.');
        setResponse(parsed.value);
        setApproved(false);
        return;
      }
      const runResponse = await fetch('/api/model-council/analyze', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          ...(catalog?.catalogVersion ? { 'x-paperwork-catalog-version': catalog.catalogVersion } : {}),
        },
        body: JSON.stringify(councilRequest),
      });
      let value: unknown;
      try {
        value = await runResponse.json();
      } catch {
        throw new Error('The model gateway returned an unreadable response. PaperWork withheld it.');
      }
      if (!runResponse.ok) {
        const issue = typeof value === 'object' && value && 'issue' in value && typeof value.issue === 'string'
          ? value.issue
          : 'PaperWork rejected this model-council request.';
        const delivery = typeof value === 'object' && value && 'delivery' in value && value.delivery === 'not_sent'
          ? 'not_sent'
          : 'unknown';
        setRunError(issue);
        setDeliveryUncertain(delivery === 'unknown');
        setApproved(false);
        return;
      }
      const parsed = parseModelCouncilResponseV1(value, preview.payload.segments, {
        requestId,
        previewDigest: { algorithm: preview.digest.algorithm, value: preview.digest.value },
        previewByteCount: preview.digest.byteCount,
        providerTargets: preview.payload.providerTargets,
      });
      if (!parsed.ok) throw new Error('PaperWork rejected an invalid gateway response.');
      setResponse(parsed.value);
      setApproved(false);
    } catch (error) {
      setDeliveryUncertain(true);
      setRunError(error instanceof Error ? error.message : 'The model-council request did not finish.');
      setApproved(false);
    } finally {
      setRunning(false);
    }
  }

  const providerSelectable = (provider: ModelCouncilCatalogV1['providers'][number]) => provider.availability === 'configured'
    && (provider.id !== 'ollama' || Boolean(provider.model && isBrowserDirectOllamaTarget({
      provider: provider.id,
      model: provider.model,
      recipient: provider.recipient,
    })));
  const configuredProviders = catalog?.providers.filter(providerSelectable) ?? [];
  const disabledConfiguredProviders = catalog?.providers.filter((provider) => provider.availability === 'disabled'
    || (provider.availability === 'configured' && !providerSelectable(provider))) ?? [];
  const included = new Set(includedSegmentIds);
  const controlsLocked = preparing || running;
  const previewRecipients = preview?.payload.providerTargets
    .map((target) => `${target.provider} → ${target.recipient} → model ${target.model}`)
    .join('; ') ?? '';
  const directOllamaSelected = selectedProviders.length === 1 && (() => {
    const entry = catalog?.providers.find((provider) => provider.id === selectedProviders[0]);
    return isBrowserDirectOllamaTarget(entry?.model ? {
      provider: entry.id,
      model: entry.model,
      recipient: entry.recipient,
    } : undefined);
  })();
  const directOllamaPreview = preview?.payload.providerTargets.length === 1
    && isBrowserDirectOllamaTarget(preview.payload.providerTargets[0]);
  const providerName = (provider: ProviderIdV1) => catalog?.providers
    .find((entry) => entry.id === provider)?.displayName ?? provider;

  return (
    <section className="model-workspace">
      <div className="model-workspace-heading">
        <div>
          <p className="eyebrow">Optional · Untrusted model review</p>
          <h1>Ask several models.<br />Keep the source in charge.</h1>
          <p>PaperWork sends only passages you select, forces every model into one exact schema, and checks every returned value against its cited quote. Model agreement is shown separately and never rewrites your trusted local plan. Supported adapters require operator configuration; provider terms, model licenses, and usage charges vary.</p>
        </div>
        <div className="model-boundary-card">
          <strong>What never leaves</strong>
          <span>Original PDF bytes</span>
          <span>Unchecked local claims</span>
          <span>Your action progress</span>
        </div>
      </div>

      <div className="model-trust-banner"><span>1</span><p><strong>This is a separate review layer.</strong> Provider output is not a PaperWork source fact, professional advice, or permission to act.</p></div>

      <section className="model-step-card">
        <div className="model-step-head"><span>01</span><div><p className="card-kicker">Choose recipients</p><h2>Select each model that may receive text.</h2></div></div>
        {catalogError && <div className="inline-error" role="alert"><strong>Provider configuration could not be loaded.</strong><p>No document text has been sent.</p><button className="outline-button" onClick={() => { setCatalogError(false); setCatalogAttempt((attempt) => attempt + 1); }}>Retry provider catalog</button></div>}
        {!catalog && !catalogError && <p className="model-loading">Loading the no-document provider catalog…</p>}
        {catalog && (
          <div className="provider-grid">
            {catalog.providers.map((provider) => {
              const available = providerSelectable(provider);
              const inputId = `provider-${provider.id}`;
              return (
                <div className={`provider-card ${selectedProviders.includes(provider.id) ? 'selected' : ''} ${!available ? 'unavailable' : ''}`} key={provider.id}>
                  <input id={inputId} type="checkbox" disabled={!available || controlsLocked} checked={selectedProviders.includes(provider.id)} onChange={() => toggleProvider(provider.id)} />
                  <label className="provider-card-choice" htmlFor={inputId}>
                    <span className={`provider-access ${providerClass(provider.access)}`}>{accessLabel(provider.access)}</span>
                    <strong>{provider.displayName}</strong>
                    <small>{provider.model ?? 'Operator has not selected a model'}</small>
                    <small>{provider.recipient}</small>
                    <p>{provider.disclosure ?? 'Provider terms and deployment configuration apply.'}</p>
                    <span className="provider-availability">{available ? 'Available for explicit selection' : provider.availability === 'disabled' ? 'Live calls disabled on this deployment' : provider.availability === 'configured' ? 'Open PaperWork on a loopback HTTP origin' : 'Not configured'}</span>
                  </label>
                  {provider.policyUrl && <a href={provider.policyUrl} target="_blank" rel="noreferrer">Read provider policy ↗</a>}
                </div>
              );
            })}
          </div>
        )}
        {catalog && configuredProviders.length === 0 && disabledConfiguredProviders.length > 0 && <div className="model-empty-state"><strong>Provider adapters are configured, but live calls are disabled here.</strong><p>PaperWork never treats a configuration flag as authentication or a spend limit. Public production calls stay off until real quotas and cost controls exist.</p></div>}
        {catalog && configuredProviders.length === 0 && disabledConfiguredProviders.length === 0 && <div className="model-empty-state"><strong>No live provider is configured.</strong><p>That is the safe default. An operator can test exact model IDs and server-side credentials locally; Ollama uses its configured host and does not require a hosted-provider API key.</p></div>}
        {catalog?.providers.some((provider) => providerSelectable(provider) && provider.id === 'ollama') && <p className="model-step-copy"><strong>Local transport boundary:</strong> loopback Ollama receives selected passages directly from this browser. The PaperWork gateway is bypassed. Ollama must be selected alone; choosing a hosted provider clears the local selection, and vice versa.</p>}
      </section>

      <section className="model-step-card">
        <div className="model-step-head"><span>02</span><div><p className="card-kicker">Minimize the payload</p><h2>Choose the exact passages to send.</h2></div><div className="segment-bulk"><button disabled={controlsLocked} onClick={() => includeAllSegments(true)}>Include all</button><button disabled={controlsLocked} onClick={() => includeAllSegments(false)}>Clear</button></div></div>
        <p className="model-step-copy">Omitting a whole passage preserves citation integrity. Inline redaction is not enabled because changed text can break exact evidence matching.</p>
        <div className="segment-list">
          {canonicalSegments.map((segment) => (
            <label key={segment.segmentId} className={included.has(segment.segmentId) ? 'included' : ''}>
              <input type="checkbox" checked={included.has(segment.segmentId)} disabled={controlsLocked} onChange={() => toggleSegment(segment.segmentId)} />
              <span><strong>Page {segment.page || '—'} · passage {segment.segmentId}</strong><small>{segment.text}</small></span>
            </label>
          ))}
        </div>
        <div className="selection-summary"><strong>{includedSegmentIds.length} of {canonicalSegments.length} passages selected</strong><span>{includedSegmentIds.length === canonicalSegments.length ? 'Full extracted text' : `${canonicalSegments.length - includedSegmentIds.length} passages redacted by omission`}</span></div>
      </section>

      <section className="model-step-card">
        <div className="model-step-head"><span>03</span><div><p className="card-kicker">Digest-bound approval</p><h2>See exactly what will be sent.</h2></div></div>
        <div className="wire-controls"><div><small>Output contract</small><strong>ProviderAnalysisV1 · strict JSON</strong></div><div><small>Tools and retrieval</small><strong>Disabled</strong></div><div><small>Acceptance rule</small><strong>Source-backed fields required</strong></div></div>
        <p className="gateway-disclosure"><strong>Before approval:</strong> {directOllamaSelected ? 'This browser will contact the exact loopback Ollama origin directly; the PaperWork gateway will not receive the passages. Ollama operator logs and retention remain outside PaperWork, and no deletion proof is available.' : 'PaperWork application code does not persist request or response bodies. Cache storage is disabled, but hosting infrastructure and each provider may have separate logging or retention. No deletion proof is available from this flow.'}</p>
        <button className="outline-button" disabled={selectedProviders.length === 0 || includedSegmentIds.length === 0 || controlsLocked} onClick={createPreview}>{preparing ? 'Preparing exact payload…' : 'Generate exact payload preview'}</button>
        {preview && (
          <div className="payload-preview">
            <div className="payload-preview-head"><div><span>SHA-256</span><strong>{preview.digest.value}</strong></div><div><span>UTF-8 payload</span><strong>{preview.digest.byteCount.toLocaleString()} bytes</strong></div></div>
            <p><strong>Instruction profile:</strong> {preview.payload.promptVersion}. This version is inside the consented digest; changing model instructions requires a fresh preview.</p>
            <details open><summary>Exact logical provider payload</summary><pre>{preview.exactJson}</pre></details>
            <p>The digest covers the displayed logical payload. {directOllamaPreview ? 'No provider credential, original PDF byte, tool, or retrieval instruction is included.' : 'Server credentials and fixed provider transport framing are never placed in this browser.'}</p>
            <label className="provider-consent"><input type="checkbox" checked={approved} disabled={running} onChange={(event) => setApproved(event.target.checked)} /><span>{directOllamaPreview ? `I approve sending these ${preview.payload.segments.length} exact passages directly from this browser to ${previewRecipients}. The PaperWork model gateway will not receive them; the local Ollama operator controls its logs, retention, and compute.` : `I approve sending these ${preview.payload.segments.length} exact passages to the PaperWork model gateway and onward to: ${previewRecipients}. I understand each recipient's separate terms, logs, retention, and charges may apply.`}</span></label>
            <button className="primary-button large" disabled={!approved || running} onClick={runCouncil}>{running ? (directOllamaPreview ? 'Waiting for local Ollama…' : 'Waiting for selected providers…') : directOllamaPreview ? `Send ${preview.payload.segments.length} passages directly to local Ollama` : `Send ${preview.payload.segments.length} passages to ${preview.payload.providerTargets.length} selected provider${preview.payload.providerTargets.length === 1 ? '' : 's'}`}<span>→</span></button>
          </div>
        )}
        {runError && <div className="inline-error" role="alert"><strong>{runError}</strong>{deliveryUncertain && <p>{directOllamaPreview ? 'The direct Ollama request began, so delivery or continued local processing may be uncertain. The PaperWork gateway was not contacted.' : 'The gateway request began, so delivery status may be uncertain. PaperWork will not claim that nothing was sent.'} Generate a fresh preview before retrying.</p>}</div>}
      </section>

      {response && (
        <section className="model-results" aria-live="polite">
          <div className="model-results-head"><div><p className="eyebrow">Schema + source checked model output</p><h2>Compare what each model found.</h2></div><span>{response.results.filter((result) => result.status === 'completed').length} of {response.results.length} completed</span></div>
          <div className="provider-results">
            {response.results.map((result) => (
              <article key={result.provider} className={`provider-result ${result.status}`}>
                <div className="provider-result-head"><div><strong>{providerName(result.provider)}</strong><small>{result.model}</small></div><span>{result.status === 'completed' ? 'Values + quotes checked' : result.status}</span></div>
                {result.status === 'completed' ? (
                  <div className="provider-fields">
                    {MODEL_COUNCIL_FIELD_IDS_V1.map((fieldId) => {
                      const field = result.analysis.fields[fieldId];
                      return <div key={fieldId}><small>{FIELD_COPY[fieldId]}</small><strong>{valueText(field?.value ?? null)}</strong>{field?.evidence.map((item) => <blockquote key={`${item.segmentId}.${item.quote}`}>“{item.quote}” <span>Page {item.page}</span></blockquote>)}</div>;
                    })}
                  </div>
                ) : <div><p>{FAILURE_COPY[result.issueCode]}</p>{directOllamaPreview && result.status === 'failed' && <p><small>The direct request reached local Ollama, but no result passed PaperWork’s checks. When the failure is a timeout, cancellation, or network error, PaperWork cannot prove that Ollama stopped processing or discarded it. The PaperWork gateway was not contacted.</small></p>}</div>}
              </article>
            ))}
          </div>

          <section className="consensus-card">
            <p className="card-kicker">Model comparison · not truth validation</p><h3>Where schema-valid outputs agree or differ</h3>
            <div className="consensus-grid">{MODEL_COUNCIL_FIELD_IDS_V1.map((fieldId) => {
              const item = response.consensus.fields[fieldId];
              return (
                <div key={fieldId}>
                  <small>{FIELD_COPY[fieldId]}</small>
                  <strong>{item.status.replace('_', ' ')}</strong>
                  {item.status === 'no_result'
                    ? <p>No schema-valid provider result</p>
                    : <ul>{item.candidates.map((candidate, index) => (
                      <li key={`${fieldId}.${index}`}>
                        <span>{valueText(candidate.value)}</span>
                        <p>{candidate.providers.map(providerName).join(' · ')}</p>
                      </li>
                    ))}</ul>}
                </div>
              );
            })}</div>
            <p className="consensus-warning">Agreement means models returned the same normalized value with source-matching quotes. It does not prove the document is correct, current, lawful, or professionally interpreted.</p>
          </section>

          <details className="council-receipt"><summary>Model council transfer receipt</summary><div><p><strong>Request</strong> {response.requestId}</p><p><strong>Approved</strong> {response.receipt.consent.recordedAt}</p><p><strong>Preview</strong> SHA-256 {response.receipt.consent.previewDigest.value} · {response.receipt.consent.previewByteCount.toLocaleString()} bytes</p><p><strong>{response.receipt.gatewayTransfer.recipient}</strong> · {response.receipt.gatewayTransfer.status}</p>{response.receipt.transfers.map((transfer) => <p key={transfer.provider}><strong>{transfer.channel === 'browser_to_provider' ? `PaperWork browser → ${transfer.recipient}` : `PaperWork gateway → ${transfer.recipient}`}</strong> {transfer.model} · {transfer.status} · provider policy: {transfer.providerPolicy.retention}</p>)}</div></details>
        </section>
      )}
    </section>
  );
}

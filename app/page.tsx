'use client';

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { ClaimViewModelV1 } from '@/core/action-pack/v1';
import {
  DOCUMENT_AGENT_REQUEST_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1,
  DOCUMENT_AGENT_GATEWAY_MODE_HEADER_V1,
  browserDirectDocumentAgentOllamaEndpointV1,
  digestDocumentAgentPayloadV1,
  documentAgentGatewayModeV1,
  parseDocumentAgentGatewaySessionV1,
  parseDocumentAgentResponseV1,
  parseDocumentAgentRunGrantResponseV1,
  prepareDocumentAgentPayloadV1,
  prepareDocumentAgentRunGrantRequestV1,
  runBrowserDirectDocumentAgentOllamaV1,
  toDocumentAgentViewModelV1,
  type DocumentAgentCompletedRunResultV1,
  type DocumentAgentFailureCodeV1,
  type DocumentAgentPayloadDigestV1,
  type DocumentAgentRequestV1,
  type DocumentAgentResponseV1,
  type DocumentAgentSourceSegmentInputV1,
  type DocumentAgentViewModelV1,
  type DocumentAgentGatewayModeV1,
} from '@/core/document-agent/v1';
import {
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  parseModelCouncilCatalogV1,
  type ModelCouncilCatalogV1,
  type ModelCouncilProviderCatalogEntryV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';
import {
  extractLocalPdfV1,
  LocalPdfExtractionErrorV1,
  type LocalPdfExtractionV1,
  type LocalPdfFailureCodeV1,
  type LocalPdfProgressV1,
} from '@/core/local-analysis/v1/pdf';

type ResultTab = 'overview' | 'plan' | 'models' | 'sources';

interface StagedPdf {
  readonly file: File;
  readonly name: string;
  readonly meta: string;
  readonly sample: boolean;
}

interface LocalApprovals {
  readonly readApprovedAt?: string;
}

interface LocalReadAuthorization {
  readonly runId: string;
  readonly readApprovedAt: string;
}

interface AgentRunAuthorization {
  readonly runId: string;
  readonly readApprovedAt: string;
  readonly planApprovedAt: string;
}

type ConfiguredEngine = Omit<ModelCouncilProviderCatalogEntryV1, 'availability' | 'model'> & {
  readonly availability: 'configured';
  readonly model: string;
};

interface PreparedModelApproval {
  readonly recordedAt: string;
  readonly digest: DocumentAgentPayloadDigestV1;
  readonly request: DocumentAgentRequestV1;
}

interface DocumentPreview {
  readonly source: StagedPdf;
  readonly extraction: LocalPdfExtractionV1;
  readonly engine: ConfiguredEngine;
  readonly requestId: string;
  readonly segments: readonly DocumentAgentSourceSegmentInputV1[];
  readonly readApprovedAt: string;
  readonly approval?: PreparedModelApproval;
}

type AgentProgress = LocalPdfProgressV1 | { readonly stage: 'preparing_model' | 'analyzing' | 'validating' };
type AppFailureCode = LocalPdfFailureCodeV1 | DocumentAgentFailureCodeV1 | 'catalog_unavailable' | 'agent_response_invalid';
type GatewaySessionState = 'not_applicable' | 'checking' | 'required' | 'authenticated';

class ModelGatewayUiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type WorkflowState =
  | { readonly tag: 'home' }
  | { readonly tag: 'review'; readonly source: StagedPdf; readonly approvals: LocalApprovals }
  | ({ readonly tag: 'preview' } & DocumentPreview)
  | {
      readonly tag: 'processing';
      readonly phase: 'extracting';
      readonly source: StagedPdf;
      readonly engine: ConfiguredEngine;
      readonly requestId: string;
      readonly authorization: LocalReadAuthorization;
      readonly progress: LocalPdfProgressV1;
    }
  | {
      readonly tag: 'processing';
      readonly phase: 'model';
      readonly source: StagedPdf;
      readonly authorization: AgentRunAuthorization;
      readonly progress: Extract<AgentProgress, { readonly stage: 'preparing_model' | 'analyzing' | 'validating' }>;
      readonly preview: DocumentPreview & { readonly approval: PreparedModelApproval };
    }
  | {
      readonly tag: 'result';
      readonly source: StagedPdf;
      readonly extraction: LocalPdfExtractionV1;
      readonly response: DocumentAgentResponseV1 & { readonly result: DocumentAgentCompletedRunResultV1 };
      readonly view: DocumentAgentViewModelV1;
    }
  | {
      readonly tag: 'failure';
      readonly source: StagedPdf;
      readonly code: AppFailureCode;
    };

const FAILURE_COPY: Readonly<Record<AppFailureCode, { title: string; detail: string }>> = {
  empty_file: { title: 'This PDF is empty.', detail: 'PaperWork did not read or analyze any content. Choose a non-empty PDF.' },
  file_too_large: { title: 'This PDF is over the 10 MB limit.', detail: 'Nothing was analyzed. Choose a smaller PDF for this browser-local milestone.' },
  unsupported_file_type: { title: 'This file is not a valid PDF.', detail: 'PaperWork checks the actual file signature, not only its name or extension.' },
  page_limit_exceeded: { title: 'This PDF has more than 50 pages.', detail: 'No result was created. Split the document and try the relevant section.' },
  password_required: { title: 'This PDF is password-protected.', detail: 'PaperWork did not extract its contents. Remove the password and try again.' },
  malformed_pdf: { title: 'This PDF appears to be damaged.', detail: 'The local parser could not safely complete every page, so PaperWork withheld the plan.' },
  unsupported_pdf: { title: 'This PDF uses an unsupported feature.', detail: 'PaperWork stopped locally instead of producing a partial or uncertain result.' },
  ocr_required: { title: 'No complete selectable text was found.', detail: 'Scanned PDFs need OCR, which is deliberately not enabled in this milestone.' },
  extraction_limit_exceeded: { title: 'The extracted text exceeded the safe limit.', detail: 'PaperWork stopped before model analysis and did not create a result.' },
  cancelled: { title: 'Document analysis was cancelled.', detail: 'No result was created. If a provider request had already started, cancellation cannot prove that the recipient did not receive it.' },
  timed_out: { title: 'Local extraction took too long.', detail: 'PaperWork stopped after 30 seconds instead of trusting incomplete output.' },
  extractor_unavailable: { title: 'The local PDF engine could not start or stopped unexpectedly.', detail: 'Your PDF stayed in this tab. Reload PaperWork and try the local run again.' },
  invalid_extractor_output: { title: 'The extracted source ledger was rejected.', detail: 'PaperWork could not prove a complete canonical source, so it showed no plan.' },
  extraction_failed: { title: 'Local extraction could not finish.', detail: 'No document content left this tab, and no partial result was shown.' },
  agent_disabled: { title: 'The document model is disabled.', detail: 'Enable a configured local or hosted model, then review the data flow again.' },
  not_configured: { title: 'No document model is configured.', detail: 'Configure local Ollama or a hosted provider before running model analysis.' },
  provider_timeout: { title: 'The document model took too long.', detail: 'PaperWork stopped the bounded model run and showed no partial interpretation.' },
  provider_rejected: { title: 'The selected model rejected this run.', detail: 'Check the configured model, account access, or quota and try again.' },
  provider_unavailable: { title: 'The selected model is unavailable.', detail: 'PaperWork could not reach the exact approved model recipient.' },
  network_failure: { title: 'The model connection did not complete.', detail: 'The delivery receipt could not establish a completed model analysis.' },
  invalid_provider_output: { title: 'The model output was safely rejected.', detail: 'It did not match PaperWork’s strict webpage schema or exact source citations.' },
  internal_error: { title: 'The document agent could not finish.', detail: 'PaperWork withheld the model result because its receipt or output was invalid.' },
  catalog_unavailable: { title: 'No analysis engine is available.', detail: 'PaperWork could not load a configured local or hosted model.' },
  agent_response_invalid: { title: 'The model response failed final validation.', detail: 'PaperWork showed no result because the response did not match the approved payload and receipt.' },
};

const PROGRESS_STEPS = [
  { stage: 'opening', label: 'Check bytes and open the local PDF worker' },
  { stage: 'extracting', label: 'Extract every page into cited source segments' },
  { stage: 'preparing_model', label: 'Prepare the exact cited model payload' },
  { stage: 'analyzing', label: 'Ask the configured model for structured details' },
  { stage: 'validating', label: 'Verify schema, source spans and receipt' },
] as const;

function isConfiguredEngine(provider: ModelCouncilProviderCatalogEntryV1): provider is ConfiguredEngine {
  return provider.availability === 'configured' && typeof provider.model === 'string' && provider.model.length > 0;
}

function loopbackBrowserOrigin() {
  return globalThis.location.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location.hostname);
}

function gatewayMessage(status: number, stage: 'session' | 'grant' | 'analysis') {
  if (status === 401) return 'Your private-beta access is missing or expired. Enter the access pass and approve this payload again.';
  if (status === 429) return 'This session or deployment has reached its current safety budget. Try again later; no new model call was started.';
  if (status === 409) return stage === 'grant'
    ? 'This approval is stale or already used. Review the payload and approve it again.'
    : 'The selected model, consent, or one-use grant changed. Review the payload again.';
  if (status === 503) return 'The hosted admission service is unavailable, so PaperWork did not start a provider call.';
  return 'The hosted gateway safely rejected this run before PaperWork could show a validated result.';
}

function fileMeta(file: File) {
  const size = file.size < 1024 * 1024
    ? `${Math.max(1, Math.round(file.size / 1024))} KB`
    : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  return `PDF · ${size}`;
}

function formatDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function Brand({ onHome }: { readonly onHome: () => void }) {
  return (
    <button className="brand brand-button" onClick={onHome} aria-label="PaperWork home">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span>PaperWork</span>
    </button>
  );
}

function TrustBadge({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`trust-badge ${compact ? 'compact' : ''}`}>
      <span className="status-dot" /> PDF stays local · model path disclosed
    </span>
  );
}

function EvidencePanel({ claim }: { readonly claim?: ClaimViewModelV1 }) {
  if (!claim) {
    return (
      <aside className="evidence-panel source_fact">
        <p className="side-label">Evidence</p>
        <h2>Select a fact or action.</h2>
        <p className="evidence-location">Its exact extracted passage will appear here.</p>
      </aside>
    );
  }
  return (
    <aside className={`evidence-panel ${claim.provenance}`}>
      <div className="evidence-panel-head">
        <p className="side-label">Evidence</p>
        <span className={`evidence-chip ${claim.provenance}`}>● {claim.label}</span>
      </div>
      <h2>{claim.title}</h2>
      {claim.quotes.length > 0 ? claim.quotes.map((quote, index) => (
        <div className="evidence-quote" key={`${claim.id}.${index}`}>
          <blockquote>“{quote.quote}”</blockquote>
          <p className="evidence-location">{quote.location}</p>
        </div>
      )) : <p className="evidence-location">No passage directly states this. It is deliberately labelled {claim.label.toLowerCase()}.</p>}
      <div className="evidence-explain"><small>Why you are seeing this</small><p>{claim.rationale}</p></div>
      <dl className="evidence-meta">
        <div><dt>Validation</dt><dd>{claim.validationState === 'accepted' ? 'Accepted' : 'Needs review'}</dd></div>
        <div><dt>Validator</dt><dd>{claim.validatorVersion}</dd></div>
        <div><dt>Checked</dt><dd>{formatTime(claim.validatedAt)}</dd></div>
      </dl>
    </aside>
  );
}

export default function Home() {
  const [workflow, setWorkflow] = useState<WorkflowState>({ tag: 'home' });
  const [showFlow, setShowFlow] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>('overview');
  const [checkedActions, setCheckedActions] = useState<readonly string[]>([]);
  const [activeClaimId, setActiveClaimId] = useState<string>();
  const [intakeError, setIntakeError] = useState<string>();
  const [catalog, setCatalog] = useState<ModelCouncilCatalogV1>();
  const [catalogError, setCatalogError] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderIdV1>();
  const [gatewayMode, setGatewayMode] = useState<DocumentAgentGatewayModeV1>('disabled');
  const [gatewaySession, setGatewaySession] = useState<GatewaySessionState>('not_applicable');
  const [gatewayAccessPass, setGatewayAccessPass] = useState('');
  const [modelSendError, setModelSendError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(undefined);
  const flowDialogRef = useRef<HTMLElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch('/api/document-agent/catalog', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('catalog unavailable');
        const mode = documentAgentGatewayModeV1(response.headers.get(DOCUMENT_AGENT_GATEWAY_MODE_HEADER_V1));
        const parsed = parseModelCouncilCatalogV1(await response.json() as unknown);
        if (!parsed.ok) throw new Error('invalid catalog');
        const configured = parsed.value.providers.filter(isConfiguredEngine);
        if (mode === 'disabled' && configured.length > 0) throw new Error('missing gateway mode');
        if (mode === 'invite' && (configured.length !== 1 || configured[0]?.id === 'ollama')) throw new Error('invalid hosted catalog');
        setGatewayMode(mode);
        setCatalog(parsed.value);
        const preferred = loopbackBrowserOrigin()
          ? configured.find((provider) => provider.id === 'ollama') ?? configured[0]
          : configured.find((provider) => provider.id !== 'ollama') ?? configured[0];
        setSelectedProvider(preferred?.id);
        if (mode === 'invite') {
          setGatewaySession('checking');
          const sessionResponse = await fetch('/api/document-agent/session', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
          const session = parseDocumentAgentGatewaySessionV1(await sessionResponse.json() as unknown);
          if (sessionResponse.ok && session?.authenticated === true) setGatewaySession('authenticated');
          else if (sessionResponse.status === 401 && session?.authenticated === false) setGatewaySession('required');
          else throw new Error('hosted admission unavailable');
        } else {
          setGatewaySession('not_applicable');
        }
      })().catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setCatalogError(true);
          setCatalog(undefined);
          setSelectedProvider(undefined);
          setGatewayMode('disabled');
          setGatewaySession('not_applicable');
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!showFlow) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = flowDialogRef.current;
    dialog?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowFlow(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus();
    };
  }, [showFlow]);

  const source = workflow.tag === 'home' ? undefined : workflow.source;
  const result = workflow.tag === 'result' ? workflow : undefined;
  const activeClaim = result?.view.claims.find((claim) => claim.id === activeClaimId);
  const configuredEngines = catalog?.providers.filter(isConfiguredEngine) ?? [];
  const selectedEngine = catalog?.providers.find((provider): provider is ConfiguredEngine => provider.id === selectedProvider && isConfiguredEngine(provider));
  const activeEngine = workflow.tag === 'preview'
    ? workflow.engine
    : workflow.tag === 'processing'
      ? workflow.phase === 'extracting' ? workflow.engine : workflow.preview.engine
      : selectedEngine;

  function selectEngine(provider: ProviderIdV1) {
    setSelectedProvider(provider);
    setModelSendError(undefined);
    setWorkflow((current) => current.tag === 'review'
      ? { ...current, approvals: { readApprovedAt: current.approvals.readApprovedAt } }
      : current);
  }

  function resetSession() {
    abortRef.current?.abort();
    abortRef.current = undefined;
    activeRunRef.current = undefined;
    setCheckedActions([]);
    setActiveClaimId(undefined);
    setResultTab('overview');
    setIntakeError(undefined);
    setModelSendError(undefined);
    setGatewayAccessPass('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setWorkflow({ tag: 'home' });
  }

  function stageFile(file?: File, sample = false) {
    if (!file) return;
    setIntakeError(undefined);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setIntakeError('Choose a PDF file. PaperWork verifies its real file signature before reading it.');
      return;
    }
    const staged: StagedPdf = { file, name: file.name, meta: `${fileMeta(file)}${sample ? ' · Synthetic sample' : ''}`, sample };
    setWorkflow({ tag: 'review', source: staged, approvals: {} });
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    stageFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    stageFile(event.dataTransfer.files?.[0]);
  }

  async function useSample() {
    setIntakeError(undefined);
    try {
      const response = await fetch('/samples/Northstar_Offer_Letter.pdf');
      if (!response.ok) throw new Error('sample unavailable');
      const blob = await response.blob();
      stageFile(new File([blob], 'Northstar_Offer_Letter.pdf', { type: 'application/pdf' }), true);
    } catch {
      setIntakeError('The synthetic sample could not be loaded. You can still choose your own PDF.');
    }
  }

  function updateReadApproval(checked: boolean) {
    setWorkflow((current) => {
      if (current.tag !== 'review') return current;
      return { ...current, approvals: checked ? { readApprovedAt: new Date().toISOString() } : {} };
    });
  }

  async function prepareLocalPreview() {
    if (workflow.tag !== 'review' || !workflow.approvals.readApprovedAt || !selectedEngine) return;
    const runId = crypto.randomUUID();
    const requestId = `request.${crypto.randomUUID()}`;
    const authorization: LocalReadAuthorization = { runId, readApprovedAt: workflow.approvals.readApprovedAt };
    const controller = new AbortController();
    abortRef.current = controller;
    activeRunRef.current = runId;
    const stagedSource = workflow.source;
    const engine = selectedEngine;
    setWorkflow({ tag: 'processing', phase: 'extracting', source: stagedSource, engine, requestId, authorization, progress: { stage: 'opening' } });
    const updateProgress = (progress: LocalPdfProgressV1) => {
      if (activeRunRef.current !== runId) return;
      setWorkflow((current) => current.tag === 'processing' && current.phase === 'extracting' && current.authorization.runId === runId
        ? { ...current, progress }
        : current);
    };
    try {
      const extraction = await extractLocalPdfV1(stagedSource.file, {
        signal: controller.signal,
        onProgress: updateProgress,
      });
      if (activeRunRef.current !== runId) return;
      const segments = extraction.canonicalSources.sourceSegments.map((segment) => ({
        segmentId: segment.id,
        page: segment.anchor.kind === 'page_region' || segment.anchor.kind === 'page_text' ? segment.anchor.page : 1,
        text: segment.text,
      }));
      setWorkflow({
        tag: 'preview',
        source: stagedSource,
        extraction,
        engine,
        requestId,
        segments,
        readApprovedAt: authorization.readApprovedAt,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setWorkflow({ tag: 'review', source: stagedSource, approvals: {} });
      } else if (error instanceof LocalPdfExtractionErrorV1) {
        setWorkflow({ tag: 'failure', source: stagedSource, code: error.code });
      } else {
        setWorkflow({ tag: 'failure', source: stagedSource, code: 'agent_response_invalid' });
      }
    } finally {
      if (activeRunRef.current === runId) activeRunRef.current = undefined;
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  }

  async function updateModelApproval(checked: boolean) {
    if (workflow.tag !== 'preview') return;
    setModelSendError(undefined);
    if (!checked) {
      setWorkflow((current) => current.tag === 'preview' ? { ...current, approval: undefined } : current);
      return;
    }
    const preview = workflow;
    const requestId = `request.${crypto.randomUUID()}`;
    const recordedAt = new Date().toISOString();
    try {
      const providerTarget = { provider: preview.engine.id, model: preview.engine.model, recipient: preview.engine.recipient };
      const payload = prepareDocumentAgentPayloadV1({
        requestId,
        consentRecordedAt: recordedAt,
        sourceRevisionId: preview.extraction.sourceRevisionId,
        sourceFingerprint: preview.extraction.fingerprint,
        providerTarget,
        segments: preview.segments,
      });
      const digest = await digestDocumentAgentPayloadV1(payload);
      const request: DocumentAgentRequestV1 = {
        kind: DOCUMENT_AGENT_REQUEST_KIND_V1,
        schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
        requestId,
        payload,
        consent: {
          approvedBy: 'user',
          recordedAt,
          provider: preview.engine.id,
          previewDigest: { algorithm: digest.algorithm, value: digest.value },
          previewByteCount: digest.byteCount,
        },
      };
      setWorkflow((current) => current.tag === 'preview' && current.requestId === preview.requestId
        ? { ...current, requestId, approval: { recordedAt, digest, request } }
        : current);
    } catch {
      setWorkflow({ tag: 'failure', source: preview.source, code: 'agent_response_invalid' });
    }
  }

  async function startModelAnalysis() {
    if (workflow.tag !== 'preview' || !workflow.approval) return;
    const lockedPreview = workflow as DocumentPreview & { readonly tag: 'preview'; readonly approval: PreparedModelApproval };
    const runId = crypto.randomUUID();
    const authorization: AgentRunAuthorization = {
      runId,
      readApprovedAt: lockedPreview.readApprovedAt,
      planApprovedAt: lockedPreview.approval.recordedAt,
    };
    const stagedSource = lockedPreview.source;
    const extraction = lockedPreview.extraction;
    const engine = lockedPreview.engine;
    const agentRequest = lockedPreview.approval.request;
    const payload = agentRequest.payload;
    const providerTarget = payload.providerTarget;
    const hostedInvite = gatewayMode === 'invite' && engine.id !== 'ollama';
    if (hostedInvite && gatewaySession !== 'authenticated' && gatewayAccessPass.length === 0) {
      setModelSendError('Enter the private-beta access pass. It is exchanged for a short-lived HTTP-only session and is never added to the document payload.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    activeRunRef.current = runId;
    setWorkflow({ tag: 'processing', phase: 'model', source: stagedSource, authorization, progress: { stage: 'preparing_model' }, preview: lockedPreview });
    const updateProgress = (progress: Extract<AgentProgress, { readonly stage: 'preparing_model' | 'analyzing' | 'validating' }>) => {
      if (activeRunRef.current !== runId) return;
      setWorkflow((current) => current.tag === 'processing' && current.phase === 'model' && current.authorization.runId === runId
        ? { ...current, progress }
        : current);
    };
    try {
      updateProgress({ stage: 'analyzing' });
      let response: DocumentAgentResponseV1;
      const directEndpoint = browserDirectDocumentAgentOllamaEndpointV1(providerTarget, globalThis.location.origin);
      if (engine.id === 'ollama') {
        if (!directEndpoint) throw new TypeError('Invalid local model target.');
        response = await runBrowserDirectDocumentAgentOllamaV1(agentRequest, { signal: controller.signal });
      } else {
        let runGrantToken: string | undefined;
        if (hostedInvite) {
          const sessionResponse = await fetch('/api/document-agent/session', {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessPass: gatewayAccessPass }),
            signal: controller.signal,
          });
          if (!sessionResponse.ok) throw new ModelGatewayUiError(sessionResponse.status, gatewayMessage(sessionResponse.status, 'session'));
          const session = parseDocumentAgentGatewaySessionV1(await sessionResponse.json() as unknown);
          if (!session?.authenticated) throw new ModelGatewayUiError(502, 'PaperWork rejected an invalid private-session response. No document text was sent to a provider.');
          setGatewaySession('authenticated');
          setGatewayAccessPass('');
          const grantResponse = await fetch('/api/document-agent/grants', {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
              'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
            },
            body: JSON.stringify(prepareDocumentAgentRunGrantRequestV1(agentRequest)),
            signal: controller.signal,
          });
          const grantValue = await grantResponse.json() as unknown;
          if (!grantResponse.ok) throw new ModelGatewayUiError(grantResponse.status, gatewayMessage(grantResponse.status, 'grant'));
          const parsedGrant = parseDocumentAgentRunGrantResponseV1(grantValue);
          if (!parsedGrant) throw new ModelGatewayUiError(502, 'PaperWork rejected an invalid one-use run grant. No document text was sent to a provider.');
          runGrantToken = parsedGrant.grantToken;
        }
        const gatewayHeaders: Record<string, string> = {
          'content-type': 'application/json',
          'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
        };
        if (runGrantToken) gatewayHeaders[DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1] = runGrantToken;
        const gatewayResponse = await fetch('/api/document-agent/analyze', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: gatewayHeaders,
          body: JSON.stringify(agentRequest),
          signal: controller.signal,
        });
        const value = await gatewayResponse.json() as unknown;
        if (!gatewayResponse.ok) throw new ModelGatewayUiError(gatewayResponse.status, gatewayMessage(gatewayResponse.status, 'analysis'));
        const parsed = parseDocumentAgentResponseV1(value, payload.segments, {
          requestId: agentRequest.requestId,
          previewDigest: agentRequest.consent.previewDigest,
          previewByteCount: agentRequest.consent.previewByteCount,
          providerTarget,
        });
        if (!parsed.ok) throw new TypeError('Invalid document-agent response.');
        response = parsed.value;
      }
      if (activeRunRef.current !== runId) return;
      updateProgress({ stage: 'validating' });
      if (response.result.status !== 'completed') {
        setWorkflow({ tag: 'failure', source: stagedSource, code: response.result.issueCode });
        return;
      }
      const completedResponse = response as DocumentAgentResponseV1 & { readonly result: DocumentAgentCompletedRunResultV1 };
      const view = toDocumentAgentViewModelV1(extraction, completedResponse);
      const firstClaim = view.attention.find((claim) => claim.provenance === 'conflict') ?? view.facts[0] ?? view.claims[0];
      setActiveClaimId(firstClaim?.id);
      setCheckedActions([]);
      setResultTab('overview');
      setWorkflow({ tag: 'result', source: stagedSource, extraction, response: completedResponse, view });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        setWorkflow({ ...lockedPreview, tag: 'preview', approval: undefined });
      } else if (error instanceof ModelGatewayUiError) {
        if (error.status === 401) setGatewaySession('required');
        setModelSendError(error.message);
        setWorkflow({ ...lockedPreview, tag: 'preview', approval: undefined });
      } else {
        setWorkflow({ tag: 'failure', source: stagedSource, code: 'agent_response_invalid' });
      }
    } finally {
      if (activeRunRef.current === runId) activeRunRef.current = undefined;
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  }

  async function forgetGatewaySession() {
    try {
      const response = await fetch('/api/document-agent/session', { method: 'DELETE', cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('session revocation failed');
      const session = parseDocumentAgentGatewaySessionV1(await response.json() as unknown);
      if (!session || session.authenticated) throw new Error('invalid session revocation response');
      setGatewaySession('required');
      setGatewayAccessPass('');
      setModelSendError(undefined);
    } catch {
      setModelSendError('PaperWork could not confirm that this private session was revoked. It remains active in this browser; try again before closing the tab.');
    }
  }

  function cancelAnalysis() {
    if (workflow.tag !== 'processing') return;
    activeRunRef.current = undefined;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setWorkflow(workflow.phase === 'model'
      ? { tag: 'preview', ...workflow.preview, approval: undefined }
      : { tag: 'review', source: workflow.source, approvals: {} });
  }

  function retryFromFailure() {
    if (workflow.tag !== 'failure') return;
    setWorkflow({ tag: 'review', source: workflow.source, approvals: {} });
  }

  function toggleAction(id: string) {
    setCheckedActions((current) => current.includes(id) ? current.filter((actionId) => actionId !== id) : [...current, id]);
  }

  function openClaim(id: string) {
    setActiveClaimId(id);
    setResultTab('overview');
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      {workflow.tag === 'home' && (
        <>
          <header className="site-header">
            <Brand onHome={resetSession} />
            <nav className="header-nav" aria-label="Primary navigation">
              <a href="#how-it-works">How it works</a>
              <button onClick={() => setShowFlow(true)}>Transparency</button>
              <a className="github-link" href="https://github.com/anshhu-man/paperwork" target="_blank" rel="noreferrer">Open source <span aria-hidden="true">↗</span></a>
            </nav>
          </header>
          <section className="hero-shell">
            <div className="hero-copy">
              <p className="eyebrow"><span className="status-dot" /> Local-first · Open source</p>
              <h1>From confusing paper<br />to clear next steps.</h1>
              <p className="hero-lede">Add a native-text PDF. PaperWork extracts it locally, asks your selected LLM for structured details, and checks every citation before building the webpage.</p>
              <div className="model-council-note" aria-label="Supported document model adapters">
                <strong>One document-agent layer</strong>
                <span>OpenAI · Claude · Mistral · DeepSeek · Ollama</span>
                <small>{gatewayMode === 'invite' ? 'Hosted private beta: an access pass is required only when you send reviewed text. One operator-approved provider receives it; provider terms and charges vary.' : 'Local Ollama is available from the localhost build. Hosted adapters use one explicitly selected provider and separate consent; provider terms and charges vary.'}</small>
              </div>
            </div>
            <div className="workspace-preview" aria-label="Add a PDF to PaperWork">
              <div className="upload-card">
                <div className="upload-tabs"><span className="upload-tab active">Local PDF</span><span className="local-only-label">No cloud upload</span></div>
                <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
                  <span className="file-glyph" aria-hidden="true"><span /></span>
                  <h2>Drop a supported PDF here</h2>
                  <p>PDF · Up to 10 MB and 50 pages · Native text only</p>
                  <button className="primary-button" onClick={() => fileInputRef.current?.click()}>Choose a PDF</button>
                  <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
                </div>
                {intakeError && <div className="inline-error" role="alert">{intakeError}</div>}
                <div className="example-row"><span>Want to verify the whole flow first?</span><button className="text-button" onClick={useSample}>Analyze the synthetic sample <span aria-hidden="true">→</span></button></div>
              </div>
              <aside className="trust-card">
                <p className="trust-kicker">Private by architecture</p>
                <h2>Your PDF.<br />Your control.</h2>
                <p className="trust-intro">The privacy promise is enforced by the run, not hidden in policy text.</p>
                <ul>
                  <li><span className="check">01</span><span><strong>Local extraction</strong><small>The PDF worker is bundled with PaperWork and runs in this tab.</small></span></li>
                  <li><span className="check">02</span><span><strong>Named model permission</strong><small>You see the exact model route before extracted text is sent.</small></span></li>
                  <li><span className="check">03</span><span><strong>Schema + citation gate</strong><small>Model JSON cannot render until its structure and exact source spans pass validation.</small></span></li>
                </ul>
                <button className="data-flow-button" onClick={() => setShowFlow(true)}>Inspect the privacy architecture <span aria-hidden="true">→</span></button>
              </aside>
            </div>
          </section>
          <section className="proof-strip" id="how-it-works" aria-label="PaperWork process">
            <div><span>01</span><strong>Add one PDF</strong><p>Actual bytes are checked before parsing</p></div>
            <div><span>02</span><strong>Ask your chosen LLM</strong><p>Only the extracted text follows the route you approve</p></div>
            <div><span>03</span><strong>Review cited details</strong><p>PaperWork validates the schema and source spans, then renders code-owned UI</p></div>
          </section>
        </>
      )}

      {workflow.tag === 'review' && (
        <div className="app-stage">
          <header className="app-header"><Brand onHome={resetSession} /><TrustBadge /><button className="quiet-button" onClick={resetSession}>Cancel</button></header>
          <section className="review-shell">
            <button className="back-button" onClick={resetSession}>← Back</button>
            <div className="review-heading"><p className="eyebrow">{workflow.source.sample ? 'Synthetic test document' : 'Permission checkpoint'}</p><h1>{workflow.source.sample ? 'The sample PDF is ready, but still unanalyzed.' : 'Your PDF is staged, but still unread.'}</h1><p>{workflow.source.sample ? 'PaperWork has not extracted the sample or contacted a model. Choose the engine and approve the exact route below.' : 'PaperWork knows only the file name and size. Choose the engine and approve each processing step before contents are opened.'}</p></div>
            <div className="review-grid">
              <section className="review-main-card">
                <div className="section-label-row"><span>1</span><h2>Selected PDF</h2></div>
                <div className="source-item"><span className="source-icon">P</span><span className="source-copy"><strong>{workflow.source.name}</strong><small>{workflow.source.meta}</small></span><button aria-label="Remove PDF" onClick={resetSession}>×</button></div>
                <button className="add-source-button" onClick={() => fileInputRef.current?.click()}>↻ Replace PDF</button>
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
                {intakeError && <div className="inline-error" role="alert">{intakeError}</div>}
                <div className="section-divider" />
                <div className="section-label-row"><span>2</span><h2>What this milestone does</h2></div>
                <div className="scope-list">
                  <div><strong>Supported</strong><p>Native-text PDFs including résumés, offers, contracts, invoices, letters, forms and other documents.</p></div>
                  <div><strong>Withheld</strong><p>Scans, password-protected PDFs, partial extraction, invalid model JSON and citations that do not match the source.</p></div>
                  <div><strong>Never automatic</strong><p>PaperWork creates manual next steps only. It does not sign, send, upload or contact anyone.</p></div>
                </div>
              </section>
              <aside className="review-side-card">
                <p className="trust-kicker">Know before you continue</p><h2>Choose the document model.</h2>
                <label className="agent-engine-field">
                  <span>Analysis engine</span>
                  <select value={selectedProvider ?? ''} onChange={(event) => selectEngine(event.target.value as ProviderIdV1)} disabled={configuredEngines.length === 0}>
                    {configuredEngines.length === 0 && <option value="">No configured model</option>}
                    {configuredEngines.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} · {provider.model}</option>)}
                  </select>
                  {selectedEngine && <small>{selectedEngine.disclosure}</small>}
                </label>
                <dl><div><dt>PDF processing</dt><dd>This browser tab</dd></div><div><dt>Selected model</dt><dd>{selectedEngine ? `${selectedEngine.displayName} · ${selectedEngine.model}` : 'Unavailable'}</dd></div><div><dt>At this step</dt><dd>Local extraction only</dd></div><div><dt>Online admission</dt><dd>{gatewayMode === 'invite' && selectedEngine?.id !== 'ollama' ? 'Anonymous session + one-use grant' : 'Not used'}</dd></div><div><dt>External knowledge</dt><dd>Off</dd></div></dl>
                <button className="preview-flow-link" onClick={() => setShowFlow(true)}>Preview the exact data flow →</button>
                <fieldset className="local-consent">
                  <legend>Local-read permission</legend>
                  <label><input type="checkbox" checked={Boolean(workflow.approvals.readApprovedAt)} onChange={(event) => updateReadApproval(event.target.checked)} /><span>Allow PaperWork to read and extract text from this PDF in this tab. No model is contacted at this step.</span></label>
                </fieldset>
                {catalogError && <div className="inline-error" role="alert">The model catalog could not be loaded. Reload PaperWork after configuring an engine.</div>}
                {!catalog && !catalogError && <p className="engine-loading">Loading configured engines…</p>}
                <div className="assurance-note"><strong>Your PDF file never leaves this tab</strong><p>PaperWork extracts locally, then stops on a second screen where you can inspect every passage before separately approving the named model transfer.</p></div>
                <button className="primary-button large" disabled={!workflow.approvals.readApprovedAt || !selectedEngine} onClick={prepareLocalPreview}>Extract and preview passages <span>→</span></button>
              </aside>
            </div>
          </section>
        </div>
      )}

      {workflow.tag === 'preview' && (
        <div className="app-stage">
          <header className="app-header"><Brand onHome={resetSession} /><TrustBadge /><button className="quiet-button" onClick={resetSession}>Cancel</button></header>
          <section className="payload-review-shell">
            <button className="back-button" onClick={() => setWorkflow({ tag: 'review', source: workflow.source, approvals: { readApprovedAt: workflow.readApprovedAt } })}>← Change file or model</button>
            <div className="review-heading"><p className="eyebrow">Exact model payload checkpoint</p><h1>See the text before it is sent.</h1><p>The PDF has been read locally. The block below is the exact source-data object the selected model will receive—no PDF bytes, account data, tools or hidden attachments. The hosted gateway separately keeps short-lived admission metadata.</p></div>
            <div className="payload-review-grid">
              <section className="payload-review-card">
                <div className="section-label-row"><span>1</span><h2>Approved local extraction</h2></div>
                <div className="source-item"><span className="source-icon">P</span><span className="source-copy"><strong>{workflow.source.name}</strong><small>{workflow.source.meta} · {workflow.segments.length} cited segment{workflow.segments.length === 1 ? '' : 's'}</small></span><span className="payload-local-state">Local only</span></div>
                <div className="section-divider" />
                <div className="payload-route-summary"><div><small>Recipient</small><strong>{workflow.engine.recipient}</strong></div><div><small>Model</small><strong>{workflow.engine.model}</strong></div><div><small>Route</small><strong>{workflow.engine.id === 'ollama' ? 'Browser → local Ollama' : 'Browser → PaperWork gateway → provider'}</strong></div></div>
                <div className="payload-source-head"><div><p className="card-kicker">Exact source object</p><h2>What the model can read</h2></div><span>{workflow.segments.reduce((total, segment) => total + segment.text.length, 0).toLocaleString()} characters</span></div>
                <pre className="payload-source-preview">{JSON.stringify({ kind: 'paperwork.untrusted_source_passages', schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, sourceRevisionId: workflow.extraction.sourceRevisionId, segments: workflow.segments.map((segment, sequence) => ({ sourceRevisionId: workflow.extraction.sourceRevisionId, segmentId: segment.segmentId, sequence, page: segment.page, text: segment.text })) }, null, 2)}</pre>
              </section>
              <aside className="payload-approval-card">
                <p className="trust-kicker">Fresh transfer approval</p><h2>Lock this exact request.</h2>
                <dl><div><dt>PDF bytes</dt><dd>Never sent</dd></div><div><dt>Source passages</dt><dd>{workflow.segments.length}</dd></div><div><dt>Tools / browsing</dt><dd>Disabled</dd></div><div><dt>Fallback model</dt><dd>None</dd></div></dl>
                {gatewayMode === 'invite' && workflow.engine.id !== 'ollama' && (
                  <section className="gateway-access-card" aria-label="Private beta access">
                    <div className="gateway-access-heading"><span>Hosted access</span><strong>{gatewaySession === 'authenticated' ? 'Private session active' : gatewaySession === 'checking' ? 'Checking this browser…' : 'Access pass required'}</strong></div>
                    {gatewaySession === 'authenticated'
                      ? <><p>A short-lived, HTTP-only cookie identifies this anonymous quota session. It contains no document text.</p><button type="button" onClick={() => void forgetGatewaySession()}>Forget private access</button></>
                      : <label className="agent-engine-field"><span>Private-beta access pass</span><input type="password" value={gatewayAccessPass} autoComplete="off" spellCheck={false} disabled={gatewaySession === 'checking'} onChange={(event) => { setGatewayAccessPass(event.target.value); setModelSendError(undefined); }} /><small>The pass is sent only to PaperWork’s session endpoint, then cleared from this page after exchange. It is never added to the model payload.</small></label>}
                  </section>
                )}
                <fieldset className="local-consent">
                  <legend>Model-send permission</legend>
                  <label><input type="checkbox" checked={Boolean(workflow.approval)} onChange={(event) => void updateModelApproval(event.target.checked)} /><span>I reviewed these passages and allow PaperWork to send this exact source object to {workflow.engine.recipient} for analysis by {workflow.engine.model}.</span></label>
                </fieldset>
                {workflow.approval && <div className="payload-digest"><small>Locked request digest</small><strong>SHA-256 {workflow.approval.digest.value}</strong><span>{workflow.approval.digest.byteCount.toLocaleString()} canonical request bytes · approved {formatTime(workflow.approval.recordedAt)}</span></div>}
                {modelSendError && <div className="inline-error" role="alert">{modelSendError}</div>}
                <div className="assurance-note"><strong>Approval and online grant are single-target</strong><p>Changing a passage, source revision, request ID, approval time, provider, model or recipient breaks the digest. Hosted runs also consume one short-lived grant atomically; PaperWork never switches targets silently.</p></div>
                <button className="primary-button large" disabled={!workflow.approval || gatewayMode === 'invite' && workflow.engine.id !== 'ollama' && (gatewaySession === 'checking' || gatewaySession !== 'authenticated' && gatewayAccessPass.length === 0)} onClick={startModelAnalysis}>Send to {workflow.engine.displayName} <span>→</span></button>
              </aside>
            </div>
          </section>
        </div>
      )}

      {workflow.tag === 'processing' && (
        <div className="processing-page">
          <div className="processing-top"><Brand onHome={resetSession} /><TrustBadge compact /></div>
          <section className="processing-card" aria-live="polite">
            <div className="processing-paper"><span>P</span><i /><i /><i /></div><p className="eyebrow">Cited document-agent run</p>
            <h1>{workflow.progress.stage === 'extracting' ? `Reading page ${workflow.progress.page} of ${workflow.progress.totalPages}.` : workflow.progress.stage === 'preparing_model' ? 'Rechecking the approved model payload.' : workflow.progress.stage === 'analyzing' ? `Asking ${activeEngine?.displayName ?? 'the selected model'} for structured details.` : workflow.progress.stage === 'validating' ? 'Checking every model citation.' : 'Opening your PDF locally.'}</h1>
            <p className="processing-file">{workflow.source.name}</p>
            <ol className="processing-list">
              {PROGRESS_STEPS.map((step, index) => {
                const currentIndex = PROGRESS_STEPS.findIndex((item) => item.stage === workflow.progress.stage);
                return <li key={step.stage} className={index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''}><span>{index < currentIndex ? '✓' : index === currentIndex ? <i /> : index + 1}</span>{step.label}{step.stage === 'extracting' && workflow.progress.stage === 'extracting' ? ` · ${workflow.progress.page}/${workflow.progress.totalPages}` : ''}</li>;
              })}
            </ol>
            <p className="processing-privacy">{workflow.phase === 'extracting' ? 'Only the PDF parser is running. No model has received text.' : 'The PDF bytes stayed local. Only the digest-locked text followed the approved route.'}</p>
            <button className="quiet-button" onClick={cancelAnalysis}>Cancel analysis</button>
          </section>
        </div>
      )}

      {workflow.tag === 'failure' && (
        <div className="app-stage">
          <header className="app-header"><Brand onHome={resetSession} /><TrustBadge /><button className="quiet-button" onClick={resetSession}>Close</button></header>
          <section className="failure-shell"><div className="failure-card" role="alert"><span className="failure-mark">!</span><p className="eyebrow">Result safely withheld</p><h1>{FAILURE_COPY[workflow.code].title}</h1><p>{FAILURE_COPY[workflow.code].detail}</p><div className="failure-actions"><button className="primary-button" onClick={retryFromFailure}>Review this PDF</button><button className="quiet-button" onClick={resetSession}>Choose another PDF</button></div><div className="assurance-note"><strong>Validation rule enforced</strong><p>Partial extraction, invalid model JSON, mismatched citations and incomplete transfer receipts cannot become a PaperWork result.</p></div></div></section>
        </div>
      )}

      {result && (
        <div className="result-page">
          <header className="result-header"><Brand onHome={resetSession} /><nav className="result-nav" aria-label="Document review sections">{(['overview', 'plan', 'models', 'sources'] as const).map((tab) => <button key={tab} aria-current={resultTab === tab ? 'page' : undefined} className={resultTab === tab ? 'active' : ''} onClick={() => setResultTab(tab)}>{tab === 'models' ? 'Model review' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav><button className="privacy-pill" onClick={() => setShowFlow(true)}><span>✓</span> Run receipt</button></header>
          <div className="sample-banner trusted-run-banner"><strong>{result.source.sample ? 'Synthetic model-reviewed run' : 'Model-reviewed run'}</strong><span>{result.source.sample ? 'Demonstration only · Do not sign or submit · ' : ''}Local PDF extraction · {result.view.agent.provider} / {result.view.agent.model} · schema and exact source spans checked · human review required</span></div>

          {resultTab === 'overview' && (
            <div className="result-grid">
              <aside className="result-sidebar"><p className="side-label">Analyzed PDF</p><div className="mini-source"><span>P</span><div><strong>{result.view.source.name}</strong><small>{result.view.source.meta}</small></div></div><button className="side-add" onClick={resetSession}>＋ Analyze another PDF</button><div className="side-rule" /><p className="side-label">Model review</p><div className="coverage-ring"><span>{result.view.validation.reviewClaims}</span><small>cited claims</small></div><p className="coverage-copy"><strong>Every interpretation needs your review</strong><br />Schema and citation checks do not make a model infallible.</p><button className="side-receipt" onClick={() => setShowFlow(true)}>What happened in this run? →</button></aside>
              <section className="result-main">
                <div className="result-title-row"><div><p className="document-type">{result.view.documentType} · LLM review with exact citations</p><h1>{result.view.source.name}</h1></div><div className="result-statuses"><span className="status-action">Human review required</span>{result.view.nearestDeadline && <span>Possible date {formatDate(result.view.nearestDeadline)}</span>}</div></div>
                {result.view.validation.withheld > 0 && <div className="withheld-banner">{result.view.validation.withheld} item{result.view.validation.withheld === 1 ? ' was' : 's were'} withheld because verification failed.</div>}
                <div className="brief-card"><p className="card-kicker">The cited model brief</p><p>{result.view.brief}</p>{result.view.facts[0] && <button onClick={() => openClaim(result.view.facts[0].id)}>Inspect the first cited passage <span>→</span></button>}</div>
                {result.view.primaryAction && <section className="next-move-card"><div className="next-number">01</div><div className="next-copy"><p className="card-kicker">Your next move</p><h2>{result.view.primaryAction.title}</h2><p>{result.view.primaryAction.description}</p><div className="next-actions"><button className="primary-button" onClick={() => toggleAction(result.view.primaryAction!.id)}>{checkedActions.includes(result.view.primaryAction.id) ? 'Marked complete ✓' : 'Mark as done'}</button><button className="evidence-chip source_fact" onClick={() => openClaim(result.view.primaryAction!.evidenceClaimId)}>● View source basis</button></div></div><div className="next-due"><small>Complete</small><strong>{formatDate(result.view.primaryAction.due) ?? result.view.primaryAction.due}</strong></div></section>}
                <section className="facts-section"><div className="section-heading"><div><p className="card-kicker">At a glance</p><h2>Cited model findings</h2></div><span>{result.view.facts.length} citation-checked findings</span></div><div className="fact-grid dynamic-facts">{result.view.facts.map((claim) => <button key={claim.id} onClick={() => openClaim(claim.id)}><small>{claim.title}</small><strong>{claim.value ?? claim.statement}</strong><span className={`evidence-chip ${claim.provenance}`}>● {claim.label}</span></button>)}</div></section>
                {(result.view.conflicts[0] ?? result.view.missingInformation[0]) && (() => { const attention = result.view.conflicts[0] ?? result.view.missingInformation[0]; return <section className="attention-card"><div className="attention-icon">!</div><div><p className="card-kicker">Needs your attention</p><h3>{attention.title}</h3><p>{attention.statement}</p></div><button onClick={() => openClaim(attention.id)}>Inspect evidence →</button></section>; })()}
                <section className="plan-section"><div className="section-heading"><div><p className="card-kicker">Your plan</p><h2>{result.view.actions.length} manual next step{result.view.actions.length === 1 ? '' : 's'}</h2></div><span>{checkedActions.length} of {result.view.actions.length} complete</span></div><div className="progress-track"><span style={{ width: `${result.view.actions.length ? (checkedActions.length / result.view.actions.length) * 100 : 0}%` }} /></div><div className="task-list">{result.view.actions.map((action) => <article className={`task-item ${checkedActions.includes(action.id) ? 'completed' : ''}`} key={action.id}><button className="task-check" aria-label={`Mark ${action.title} complete`} onClick={() => toggleAction(action.id)}>{checkedActions.includes(action.id) ? '✓' : ''}</button><div className="task-copy"><div><span className="task-priority">{action.priority}</span><span className="task-due">{formatDate(action.due) ?? action.due}</span></div><h3>{action.title}</h3><p>{action.description}</p><button className={`evidence-chip ${action.provenance === 'document_requirement' ? 'source_fact' : 'suggestion'}`} onClick={() => openClaim(action.evidenceClaimId)}>● {action.provenance === 'document_requirement' ? 'Document requirement' : 'PaperWork suggestion'}</button></div></article>)}</div></section>
                <section className="limitations-card"><p className="card-kicker">Current boundaries</p><h2>What this result does not claim.</h2><ul>{result.view.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section>
              </section>
              <EvidencePanel claim={activeClaim} />
            </div>
          )}

          {resultTab === 'plan' && <section className="standalone-panel"><p className="eyebrow">Action plan</p><h1>{result.view.actions.length} cited manual step{result.view.actions.length === 1 ? '' : 's'} to review.</h1><p className="standalone-lede">The model may identify source requirements or choose a bounded suggestion intent. PaperWork owns the wording, keeps the evidence attached, and never executes an action.</p><div className="task-list wide">{result.view.actions.map((action) => <article className={`task-item ${checkedActions.includes(action.id) ? 'completed' : ''}`} key={action.id}><button className="task-check" onClick={() => toggleAction(action.id)}>{checkedActions.includes(action.id) ? '✓' : ''}</button><div className="task-copy"><span className="task-priority">{action.priority}</span><h3>{action.title}</h3><p>{action.description}</p><button className={`evidence-chip ${action.provenance === 'document_requirement' ? 'source_fact' : 'suggestion'}`} onClick={() => openClaim(action.evidenceClaimId)}>● Inspect cited basis</button></div><strong className="standalone-due">{formatDate(action.due) ?? action.due}</strong></article>)}</div></section>}
          {resultTab === 'models' && <section className="standalone-panel sources-panel"><p className="eyebrow">Document-agent receipt</p><h1>The exact model used for this webpage.</h1><p className="standalone-lede">PaperWork used one explicitly selected engine. The model returned data only; a strict validator checked the closed schema and exact source spans before PaperWork’s code-owned components rendered it.</p><div className="source-detail"><div className="big-source-icon">AI</div><div><p className="card-kicker">Selected engine</p><h2>{result.view.agent.provider} · {result.view.agent.model}</h2><p>{result.view.agent.recipient}</p></div><span>{result.view.agent.channel === 'browser_to_provider' ? 'Direct local route' : 'Gateway route'}</span></div><dl className="receipt-list model-receipt-list"><div><dt>Provider</dt><dd>{result.response.result.provider}</dd></div><div><dt>Model</dt><dd>{result.response.result.model}</dd></div><div><dt>Recipient</dt><dd>{result.response.receipt.transfer.recipient}</dd></div><div><dt>Channel</dt><dd>{result.response.receipt.transfer.channel}</dd></div><div><dt>Payload digest</dt><dd>SHA-256 {result.view.agent.payloadDigest.slice(0, 16)}…</dd></div><div><dt>Approved canonical payload</dt><dd>{result.view.agent.payloadByteCount.toLocaleString()} bytes</dd></div><div><dt>Provider retention disclosure</dt><dd>{result.response.receipt.transfer.providerPolicy.retention}</dd></div><div><dt>Provider training-use disclosure</dt><dd>{result.response.receipt.transfer.providerPolicy.trainingUse}</dd></div><div><dt>Validation</dt><dd>Schema + exact source spans checked</dd></div></dl></section>}
          {resultTab === 'sources' && <section className="standalone-panel sources-panel"><p className="eyebrow">Canonical source & transfer receipt</p><h1>Everything this model-reviewed page used.</h1><p className="standalone-lede">One locally extracted PDF revision, one approved model recipient and no external knowledge. The model’s interpretations remain labelled for review even when their citations match exactly.</p><div className="source-detail"><div className="big-source-icon">P</div><div><p className="card-kicker">Canonical source</p><h2>{result.view.source.name}</h2><p>{result.view.source.meta}</p></div><span>SHA-256 {result.view.source.fingerprint.slice(0, 12)}…</span></div><div className="source-stats"><div><small>Extracted pages</small><strong>{result.view.source.pageCount}</strong></div><div><small>Cited findings to review</small><strong>{result.view.validation.reviewClaims}</strong></div><div><small>Approved model transfers</small><strong>{result.view.receipt.transferCount}</strong></div><div><small>External references</small><strong>0</strong></div></div><button className="outline-button" onClick={() => setShowFlow(true)}>Open the observed run receipt</button></section>}
        </div>
      )}

      {showFlow && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowFlow(false)}>
          <section ref={flowDialogRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="flow-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFlow(false)} aria-label="Close">×</button><p className="eyebrow">{result ? 'Observed run receipt' : 'Data-flow preview'}</p><h2 id="flow-title">{result ? 'What happened in this run?' : 'See the exact path before anything is read.'}</h2>
            <p className="modal-lede">{result ? `The PDF stayed in this tab. Its extracted text was sent only to ${result.view.agent.recipient} using the recorded route, then PaperWork validated the returned schema and exact citations.` : workflow.tag === 'preview' ? `The PDF was extracted locally and the exact passages are visible behind this dialog. Nothing reaches ${workflow.engine.recipient} until you lock and send that payload.` : workflow.tag === 'processing' && workflow.phase === 'model' ? `The PDF stayed local. The digest-locked passages are now following the approved route to ${workflow.preview.engine.recipient}.` : source ? `Only the selected PDF name and size are visible. Local extraction runs first, then PaperWork stops so you can inspect every passage before model approval.` : 'No source is selected. PaperWork has no account requirement, document upload endpoint or hidden model fallback.'}</p>
            <div className="flow-diagram agent-flow-diagram"><div><span>1</span><strong>{source ? 'Selected PDF' : 'Your PDF'}</strong><small>{source ? source.name : 'Not selected yet'}</small></div><i>→</i><div><span>2</span><strong>Local PDF parser</strong><small>{result || workflow.tag === 'preview' || workflow.tag === 'processing' && workflow.phase === 'model' ? 'Completed in this tab' : source ? 'Runs after local-read approval' : 'Waiting locally'}</small></div><i>→</i><div><span>3</span><strong>{activeEngine?.id === 'ollama' ? 'Direct local model' : 'Consent-bound gateway'}</strong><small>{result ? result.view.agent.recipient : activeEngine ? `${activeEngine.displayName} · ${activeEngine.recipient}` : 'No model configured'}</small></div><i>→</i><div><span>4</span><strong>Schema + citation validator</strong><small>Only closed, citation-matched data reaches code-owned UI</small></div></div>
            <dl className="receipt-list"><div><dt>PDF file transfer</dt><dd>None — bytes remain in this tab</dd></div><div><dt>PDF contents read</dt><dd>{result || workflow.tag === 'preview' || workflow.tag === 'processing' && workflow.phase === 'model' ? 'Yes, in this tab' : workflow.tag === 'processing' ? 'Locally in progress' : 'Not yet'}</dd></div><div><dt>Model recipient</dt><dd>{result?.view.agent.recipient ?? activeEngine?.recipient ?? 'Not selected'}</dd></div><div><dt>Model route</dt><dd>{result ? result.view.agent.channel : activeEngine?.id === 'ollama' ? 'Browser to local provider' : activeEngine ? 'PaperWork gateway to provider' : 'Not selected'}</dd></div>{gatewayMode === 'invite' && activeEngine?.id !== 'ollama' && <div><dt>Gateway metadata</dt><dd>Credential hashes, random request and target, payload digest and byte count, consent/status timestamps, quota units and lease state — never PDF bytes or document text</dd></div>}<div><dt>External knowledge/tools</dt><dd>Disabled</dd></div>{workflow.tag === 'preview' && workflow.approval && <><div><dt>Locked digest</dt><dd>SHA-256 {workflow.approval.digest.value.slice(0, 16)}…</dd></div><div><dt>Transfer status</dt><dd>Not sent</dd></div></>}{result && <><div><dt>Transfer status</dt><dd>{result.response.receipt.transfer.status}</dd></div><div><dt>Payload digest</dt><dd>SHA-256 {result.view.agent.payloadDigest.slice(0, 16)}…</dd></div><div><dt>Payload size</dt><dd>{result.view.agent.payloadByteCount.toLocaleString()} bytes</dd></div><div><dt>Consent recorded</dt><dd>{formatTime(result.response.receipt.consent.recordedAt)}</dd></div><div><dt>Parser</dt><dd>{result.view.receipt.parser}</dd></div><div><dt>Validator</dt><dd>{result.view.receipt.validator}</dd></div><div><dt>Completed</dt><dd>{formatTime(result.view.receipt.completedAt)}</dd></div></>}</dl>
            <p className="future-note"><strong>Open-source boundary:</strong> The model cannot author HTML, components or executable actions. It returns a closed JSON contract; PaperWork reconstructs an allowlisted view model and keeps every interpretation marked for human review.</p><button className="primary-button full" onClick={() => setShowFlow(false)}>Understood</button>
          </section>
        </div>
      )}
    </main>
  );
}

'use client';

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  analyzeLocalOfferLetterPdfV1,
  toActionPackViewModelV1,
  type ActionPackViewModelV1,
  type ClaimViewModelV1,
  type LocalAnalysisIssueCodeV1,
  type LocalAnalysisProgressV1,
  type LocalRunAuthorizationV1,
  type TrustedActionPackV1,
} from '@/core/action-pack/v1';
import { ModelCouncilWorkspace } from './model-council';

type ResultTab = 'overview' | 'plan' | 'models' | 'sources';

interface StagedPdf {
  readonly file: File;
  readonly name: string;
  readonly meta: string;
  readonly sample: boolean;
}

interface LocalApprovals {
  readonly readApprovedAt?: string;
  readonly planApprovedAt?: string;
}

type WorkflowState =
  | { readonly tag: 'home' }
  | { readonly tag: 'review'; readonly source: StagedPdf; readonly approvals: LocalApprovals }
  | {
      readonly tag: 'processing';
      readonly source: StagedPdf;
      readonly authorization: LocalRunAuthorizationV1;
      readonly progress: LocalAnalysisProgressV1;
    }
  | {
      readonly tag: 'result';
      readonly source: StagedPdf;
      readonly pack: TrustedActionPackV1;
      readonly view: ActionPackViewModelV1;
    }
  | {
      readonly tag: 'failure';
      readonly source: StagedPdf;
      readonly code: LocalAnalysisIssueCodeV1;
    };

const FAILURE_COPY: Readonly<Record<LocalAnalysisIssueCodeV1, { title: string; detail: string }>> = {
  empty_file: { title: 'This PDF is empty.', detail: 'PaperWork did not read or analyze any content. Choose a non-empty PDF.' },
  file_too_large: { title: 'This PDF is over the 10 MB limit.', detail: 'Nothing was analyzed. Choose a smaller PDF for this browser-local milestone.' },
  unsupported_file_type: { title: 'This file is not a valid PDF.', detail: 'PaperWork checks the actual file signature, not only its name or extension.' },
  page_limit_exceeded: { title: 'This PDF has more than 50 pages.', detail: 'No Action Pack was created. Split the document and try the relevant section.' },
  password_required: { title: 'This PDF is password-protected.', detail: 'PaperWork did not extract its contents. Remove the password and try again.' },
  malformed_pdf: { title: 'This PDF appears to be damaged.', detail: 'The local parser could not safely complete every page, so PaperWork withheld the plan.' },
  unsupported_pdf: { title: 'This PDF uses an unsupported feature.', detail: 'PaperWork stopped locally instead of producing a partial or uncertain result.' },
  ocr_required: { title: 'No complete selectable text was found.', detail: 'Scanned PDFs need OCR, which is deliberately not enabled in this milestone.' },
  extraction_limit_exceeded: { title: 'The extracted text exceeded the safe limit.', detail: 'PaperWork stopped before assembly and did not create an Action Pack.' },
  cancelled: { title: 'Local analysis was cancelled.', detail: 'No Action Pack was created and no document content was transferred.' },
  timed_out: { title: 'Local extraction took too long.', detail: 'PaperWork stopped after 30 seconds instead of trusting incomplete output.' },
  extractor_unavailable: { title: 'The local PDF engine could not start or stopped unexpectedly.', detail: 'Your PDF stayed in this tab. Reload PaperWork and try the local run again.' },
  invalid_extractor_output: { title: 'The extracted source ledger was rejected.', detail: 'PaperWork could not prove a complete canonical source, so it showed no plan.' },
  extraction_failed: { title: 'Local extraction could not finish.', detail: 'No document content left this tab, and no partial result was shown.' },
  authorization_required: { title: 'Local permission is required.', detail: 'Approve both local steps before PaperWork reads the PDF.' },
  unsupported_document: { title: 'This PDF is not recognized yet.', detail: 'The local rules currently recognize explicit English-language offer letters and structured résumés with selectable text.' },
  required_term_not_found: { title: 'Required offer terms were not found.', detail: 'PaperWork needs an explicit offered role and a sign-and-return instruction before it can build this plan.' },
  unsafe_source_value: { title: 'A source value could not be rendered safely.', detail: 'PaperWork withheld the entire Action Pack instead of interpolating unsafe source text.' },
  claim_validation_failed: { title: 'A claim did not pass independent verification.', detail: 'PaperWork refused to render a statement that could not be reconstructed from its exact citation.' },
  action_safety_failed: { title: 'An action failed the safety policy.', detail: 'No plan was shown because every action must match a fixed, manual-only template.' },
  event_ledger_failed: { title: 'The run receipt could not be verified.', detail: 'PaperWork requires a complete, ordered local event ledger before it trusts a result.' },
  contract_validation_failed: { title: 'The Action Pack contract was rejected.', detail: 'The result stayed hidden because structural validity is required in addition to semantic trust.' },
  assembly_failed: { title: 'Trusted assembly could not finish.', detail: 'PaperWork showed no partial plan. Your selected PDF remains only in this page session.' },
};

const PROGRESS_STEPS = [
  { stage: 'opening', label: 'Check bytes and open the local PDF worker' },
  { stage: 'extracting', label: 'Extract every page into cited source segments' },
  { stage: 'assembling', label: 'Build claims and manual-only actions' },
  { stage: 'validating', label: 'Verify citations, safety and the run ledger' },
] as const;

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
      <span className="status-dot" /> Browser-local · no PDF transfer
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(undefined);
  const flowDialogRef = useRef<HTMLElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
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

  function resetSession() {
    abortRef.current?.abort();
    abortRef.current = undefined;
    activeRunRef.current = undefined;
    setCheckedActions([]);
    setActiveClaimId(undefined);
    setResultTab('overview');
    setIntakeError(undefined);
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

  function updateApproval(key: 'readApprovedAt' | 'planApprovedAt', checked: boolean) {
    setWorkflow((current) => {
      if (current.tag !== 'review') return current;
      if (key === 'readApprovedAt' && !checked) return { ...current, approvals: {} };
      if (key === 'planApprovedAt' && checked && !current.approvals.readApprovedAt) return current;
      return { ...current, approvals: { ...current.approvals, [key]: checked ? new Date().toISOString() : undefined } };
    });
  }

  async function startLocalAnalysis() {
    if (workflow.tag !== 'review' || !workflow.approvals.readApprovedAt || !workflow.approvals.planApprovedAt) return;
    const runId = crypto.randomUUID();
    const authorization: LocalRunAuthorizationV1 = {
      runId,
      readApprovedAt: workflow.approvals.readApprovedAt,
      planApprovedAt: workflow.approvals.planApprovedAt,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    activeRunRef.current = runId;
    const stagedSource = workflow.source;
    setWorkflow({ tag: 'processing', source: stagedSource, authorization, progress: { stage: 'opening' } });

    const analysis = await analyzeLocalOfferLetterPdfV1(stagedSource.file, {
      authorization,
      signal: controller.signal,
      onProgress: (progress) => {
        if (activeRunRef.current !== runId) return;
        setWorkflow((current) => current.tag === 'processing' && current.authorization.runId === runId
          ? { ...current, progress }
          : current);
      },
    });
    if (activeRunRef.current !== runId) return;
    activeRunRef.current = undefined;
    abortRef.current = undefined;
    if (analysis.ok) {
      const view = toActionPackViewModelV1(analysis.pack);
      const firstClaim = view.attention.find((claim) => claim.provenance === 'conflict') ?? view.facts[0] ?? view.claims[0];
      setActiveClaimId(firstClaim?.id);
      setCheckedActions([]);
      setResultTab('overview');
      setWorkflow({ tag: 'result', source: stagedSource, pack: analysis.pack, view });
      return;
    }
    if (analysis.stage === 'cancelled') {
      setWorkflow({ tag: 'review', source: stagedSource, approvals: {} });
      return;
    }
    setWorkflow({ tag: 'failure', source: stagedSource, code: analysis.issues[0].code });
  }

  function cancelAnalysis() {
    if (workflow.tag !== 'processing') return;
    activeRunRef.current = undefined;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setWorkflow({ tag: 'review', source: workflow.source, approvals: {} });
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
              <p className="hero-lede">Add an offer letter or résumé PDF. PaperWork reads every page in your browser and builds a verified action plan with exact citations.</p>
              <div className="model-council-note" aria-label="Optional multi-model review">
                <strong>Optional offer-letter model council</strong>
                <span>OpenAI · Claude · Mistral · DeepSeek · Ollama</span>
                <small>Supported adapters—not free bundled access. Configuration, model licenses, provider terms, and usage charges vary. Text moves only after an exact preview and explicit consent.</small>
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
                  <li><span className="check">02</span><span><strong>Explicit permission</strong><small>Nothing is read until you approve both local steps.</small></span></li>
                  <li><span className="check">03</span><span><strong>Trusted result gate</strong><small>Unverified claims and unsafe plans never reach the result screen.</small></span></li>
                </ul>
                <button className="data-flow-button" onClick={() => setShowFlow(true)}>Inspect the privacy architecture <span aria-hidden="true">→</span></button>
              </aside>
            </div>
          </section>
          <section className="proof-strip" id="how-it-works" aria-label="PaperWork process">
            <div><span>01</span><strong>Add one PDF</strong><p>Actual bytes are checked before parsing</p></div>
            <div><span>02</span><strong>Read it locally</strong><p>Every page becomes an immutable cited segment</p></div>
            <div><span>03</span><strong>Get a trusted plan</strong><p>Claims, actions and the run receipt are independently verified</p></div>
          </section>
        </>
      )}

      {workflow.tag === 'review' && (
        <div className="app-stage">
          <header className="app-header"><Brand onHome={resetSession} /><TrustBadge /><button className="quiet-button" onClick={resetSession}>Cancel</button></header>
          <section className="review-shell">
            <button className="back-button" onClick={resetSession}>← Back</button>
            <div className="review-heading"><p className="eyebrow">{workflow.source.sample ? 'Synthetic test document' : 'Permission checkpoint'}</p><h1>{workflow.source.sample ? 'The sample PDF is ready, but still unanalyzed.' : 'Your PDF is staged, but still unread.'}</h1><p>{workflow.source.sample ? 'The synthetic file arrived as a normal app asset. PaperWork has not extracted its text or assembled any claims.' : 'PaperWork knows only the file name and size. Approve each local operation before its contents are opened.'}</p></div>
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
                  <div><strong>Supported</strong><p>English-language offer letters and structured résumés with complete selectable text.</p></div>
                  <div><strong>Withheld</strong><p>Scans, password-protected PDFs, ambiguous dates, unsupported document types and partial extraction.</p></div>
                  <div><strong>Never automatic</strong><p>PaperWork creates manual next steps only. It does not sign, send, upload or contact anyone.</p></div>
                </div>
              </section>
              <aside className="review-side-card">
                <p className="trust-kicker">Know before you continue</p><h2>Allow this local run.</h2>
                <dl><div><dt>PDF processing</dt><dd>This browser tab</dd></div><div><dt>AI provider</dt><dd>Not used</dd></div><div><dt>PaperWork server</dt><dd>No document upload</dd></div><div><dt>External knowledge</dt><dd>Off</dd></div></dl>
                <button className="preview-flow-link" onClick={() => setShowFlow(true)}>Preview the exact data flow →</button>
                <fieldset className="local-consent">
                  <legend>Explicit local permissions</legend>
                  <label><input type="checkbox" checked={Boolean(workflow.approvals.readApprovedAt)} onChange={(event) => updateApproval('readApprovedAt', event.target.checked)} /><span>Allow PaperWork to read and extract text from this PDF in this tab.</span></label>
                  <label><input type="checkbox" disabled={!workflow.approvals.readApprovedAt} checked={Boolean(workflow.approvals.planApprovedAt)} onChange={(event) => updateApproval('planApprovedAt', event.target.checked)} /><span>Allow PaperWork to use that text to build and verify a source-only Action Pack in this tab.</span></label>
                </fieldset>
                <div className="assurance-note"><strong>Your PDF stays yours</strong><p>No AI provider or PaperWork server receives the file. The PDF and extracted text are held by this page for the current session.</p></div>
                <button className="primary-button large" disabled={!workflow.approvals.readApprovedAt || !workflow.approvals.planApprovedAt} onClick={startLocalAnalysis}>Read PDF and build local plan <span>→</span></button>
              </aside>
            </div>
          </section>
        </div>
      )}

      {workflow.tag === 'processing' && (
        <div className="processing-page">
          <div className="processing-top"><Brand onHome={resetSession} /><TrustBadge compact /></div>
          <section className="processing-card" aria-live="polite">
            <div className="processing-paper"><span>P</span><i /><i /><i /></div><p className="eyebrow">Trusted local assembly</p>
            <h1>{workflow.progress.stage === 'extracting' ? `Reading page ${workflow.progress.page} of ${workflow.progress.totalPages}.` : workflow.progress.stage === 'validating' ? 'Verifying before anything is shown.' : workflow.progress.stage === 'assembling' ? 'Building a source-only Action Pack.' : 'Opening your PDF locally.'}</h1>
            <p className="processing-file">{workflow.source.name}</p>
            <ol className="processing-list">
              {PROGRESS_STEPS.map((step, index) => {
                const currentIndex = PROGRESS_STEPS.findIndex((item) => item.stage === workflow.progress.stage);
                return <li key={step.stage} className={index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''}><span>{index < currentIndex ? '✓' : index === currentIndex ? <i /> : index + 1}</span>{step.label}{step.stage === 'extracting' && workflow.progress.stage === 'extracting' ? ` · ${workflow.progress.page}/${workflow.progress.totalPages}` : ''}</li>;
              })}
            </ol>
            <p className="processing-privacy">No document bytes or extracted text are sent over the network.</p>
            <button className="quiet-button" onClick={cancelAnalysis}>Cancel local analysis</button>
          </section>
        </div>
      )}

      {workflow.tag === 'failure' && (
        <div className="app-stage">
          <header className="app-header"><Brand onHome={resetSession} /><TrustBadge /><button className="quiet-button" onClick={resetSession}>Close</button></header>
          <section className="failure-shell"><div className="failure-card" role="alert"><span className="failure-mark">!</span><p className="eyebrow">Result safely withheld</p><h1>{FAILURE_COPY[workflow.code].title}</h1><p>{FAILURE_COPY[workflow.code].detail}</p><div className="failure-actions"><button className="primary-button" onClick={retryFromFailure}>Review this PDF</button><button className="quiet-button" onClick={resetSession}>Choose another PDF</button></div><div className="assurance-note"><strong>Trust rule enforced</strong><p>Partial extraction, self-attested claims and incomplete event receipts cannot become a trusted Action Pack.</p></div></div></section>
        </div>
      )}

      {result && (
        <div className="result-page">
          <header className="result-header"><Brand onHome={resetSession} /><nav className="result-nav" aria-label="Action Pack sections">{(['overview', 'plan', 'models', 'sources'] as const).map((tab) => <button key={tab} aria-current={resultTab === tab ? 'page' : undefined} className={resultTab === tab ? 'active' : ''} onClick={() => setResultTab(tab)}>{tab === 'models' ? 'Model review' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav><button className="privacy-pill" onClick={() => setShowFlow(true)}><span>✓</span> Run receipt</button></header>
          <div className="sample-banner trusted-run-banner"><strong>{result.pack.runMode === 'sample_fixture' ? 'Recognized synthetic fixture' : 'Trusted local run'}</strong><span>{result.pack.runMode === 'sample_fixture' ? 'Demonstration only · Do not sign or submit · ' : ''}Native-text extraction · Deterministic rules · No AI provider · No document upload</span></div>

          {resultTab === 'overview' && (
            <div className="result-grid">
              <aside className="result-sidebar"><p className="side-label">Analyzed PDF</p><div className="mini-source"><span>P</span><div><strong>{result.view.source.name}</strong><small>{result.view.source.meta}</small></div></div><button className="side-add" onClick={resetSession}>＋ Analyze another PDF</button><div className="side-rule" /><p className="side-label">Verification coverage</p><div className="coverage-ring"><span>{result.view.validation.acceptedClaims}</span><small>claims accepted</small></div><p className="coverage-copy"><strong>{result.view.validation.reviewClaims} need your review</strong><br />Conflicts and unknowns stay visibly labelled.</p><button className="side-receipt" onClick={() => setShowFlow(true)}>What happened in this run? →</button></aside>
              <section className="result-main">
                <div className="result-title-row"><div><p className="document-type">{result.view.documentType} · Browser-local</p><h1>{result.view.source.name}</h1></div><div className="result-statuses"><span className="status-action">{result.view.primaryAction?.provenance === 'document_requirement' ? 'Action required' : 'Review suggested'}</span>{result.view.nearestDeadline && <span>Due {formatDate(result.view.nearestDeadline)}</span>}</div></div>
                {result.view.validation.withheld > 0 && <div className="withheld-banner">{result.view.validation.withheld} item{result.view.validation.withheld === 1 ? ' was' : 's were'} withheld because verification failed.</div>}
                <div className="brief-card"><p className="card-kicker">The source-grounded brief</p><p>{result.view.brief}</p>{result.view.facts[0] && <button onClick={() => openClaim(result.view.facts[0].id)}>Inspect the first verified passage <span>→</span></button>}</div>
                {result.view.primaryAction && <section className="next-move-card"><div className="next-number">01</div><div className="next-copy"><p className="card-kicker">Your next move</p><h2>{result.view.primaryAction.title}</h2><p>{result.view.primaryAction.description}</p><div className="next-actions"><button className="primary-button" onClick={() => toggleAction(result.view.primaryAction!.id)}>{checkedActions.includes(result.view.primaryAction.id) ? 'Marked complete ✓' : 'Mark as done'}</button><button className="evidence-chip source_fact" onClick={() => openClaim(result.view.primaryAction!.evidenceClaimId)}>● View source basis</button></div></div><div className="next-due"><small>Complete</small><strong>{formatDate(result.view.primaryAction.due) ?? result.view.primaryAction.due}</strong></div></section>}
                <section className="facts-section"><div className="section-heading"><div><p className="card-kicker">At a glance</p><h2>Verified findings</h2></div><span>{result.view.facts.length} cited findings</span></div><div className="fact-grid dynamic-facts">{result.view.facts.map((claim) => <button key={claim.id} onClick={() => openClaim(claim.id)}><small>{claim.title}</small><strong>{claim.value ?? claim.statement}</strong><span className={`evidence-chip ${claim.provenance}`}>● {claim.label}</span></button>)}</div></section>
                {(result.view.conflicts[0] ?? result.view.missingInformation[0]) && (() => { const attention = result.view.conflicts[0] ?? result.view.missingInformation[0]; return <section className="attention-card"><div className="attention-icon">!</div><div><p className="card-kicker">Needs your attention</p><h3>{attention.title}</h3><p>{attention.statement}</p></div><button onClick={() => openClaim(attention.id)}>Inspect evidence →</button></section>; })()}
                <section className="plan-section"><div className="section-heading"><div><p className="card-kicker">Your plan</p><h2>{result.view.actions.length} manual next step{result.view.actions.length === 1 ? '' : 's'}</h2></div><span>{checkedActions.length} of {result.view.actions.length} complete</span></div><div className="progress-track"><span style={{ width: `${result.view.actions.length ? (checkedActions.length / result.view.actions.length) * 100 : 0}%` }} /></div><div className="task-list">{result.view.actions.map((action) => <article className={`task-item ${checkedActions.includes(action.id) ? 'completed' : ''}`} key={action.id}><button className="task-check" aria-label={`Mark ${action.title} complete`} onClick={() => toggleAction(action.id)}>{checkedActions.includes(action.id) ? '✓' : ''}</button><div className="task-copy"><div><span className="task-priority">{action.priority}</span><span className="task-due">{formatDate(action.due) ?? action.due}</span></div><h3>{action.title}</h3><p>{action.description}</p><button className={`evidence-chip ${action.provenance === 'document_requirement' ? 'source_fact' : 'suggestion'}`} onClick={() => openClaim(action.evidenceClaimId)}>● {action.provenance === 'document_requirement' ? 'Document requirement' : 'PaperWork suggestion'}</button></div></article>)}</div></section>
                <section className="limitations-card"><p className="card-kicker">Current boundaries</p><h2>What this result does not claim.</h2><ul>{result.view.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section>
              </section>
              <EvidencePanel claim={activeClaim} />
            </div>
          )}

          {resultTab === 'plan' && <section className="standalone-panel"><p className="eyebrow">Action plan</p><h1>{result.view.actions.length} verified manual step{result.view.actions.length === 1 ? '' : 's'}.</h1><p className="standalone-lede">Document requirements use direct source facts. PaperWork suggestions stay separate and never execute automatically.</p><div className="task-list wide">{result.view.actions.map((action) => <article className={`task-item ${checkedActions.includes(action.id) ? 'completed' : ''}`} key={action.id}><button className="task-check" onClick={() => toggleAction(action.id)}>{checkedActions.includes(action.id) ? '✓' : ''}</button><div className="task-copy"><span className="task-priority">{action.priority}</span><h3>{action.title}</h3><p>{action.description}</p><button className={`evidence-chip ${action.provenance === 'document_requirement' ? 'source_fact' : 'suggestion'}`} onClick={() => openClaim(action.evidenceClaimId)}>● Inspect basis</button></div><strong className="standalone-due">{formatDate(action.due) ?? action.due}</strong></article>)}</div></section>}
          {resultTab === 'models' && (result.pack.analysis.document.documentType === 'employment_offer' || result.pack.analysis.document.documentType === 'synthetic_employment_offer_fixture'
            ? <ModelCouncilWorkspace pack={result.pack} />
            : <section className="standalone-panel"><p className="eyebrow">Model review boundary</p><h1>This résumé stayed in the trusted local path.</h1><p className="standalone-lede">The current model-council contract verifies offer-letter fields only, so PaperWork will not send résumé passages into the wrong schema. No provider received this text. A dedicated résumé contract must be added and independently validated before model review is enabled here.</p></section>)}
          {resultTab === 'sources' && <section className="standalone-panel sources-panel"><p className="eyebrow">Trusted source & local receipt</p><h1>Everything the local Action Pack used.</h1><p className="standalone-lede">One uploaded PDF revision. No external references, AI provider or hidden knowledge entered this trusted result. Optional model reviews remain separate and have their own transfer receipt.</p><div className="source-detail"><div className="big-source-icon">P</div><div><p className="card-kicker">Canonical source</p><h2>{result.view.source.name}</h2><p>{result.view.source.meta}</p></div><span>SHA-256 {result.view.source.fingerprint.slice(0, 12)}…</span></div><div className="source-stats"><div><small>Accepted claims</small><strong>{result.view.validation.acceptedClaims}</strong></div><div><small>Need review</small><strong>{result.view.validation.reviewClaims}</strong></div><div><small>Local-run transfers</small><strong>{result.view.receipt.transferCount}</strong></div><div><small>External references</small><strong>0</strong></div></div><button className="outline-button" onClick={() => setShowFlow(true)}>Open the observed local receipt</button></section>}
        </div>
      )}

      {showFlow && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowFlow(false)}>
          <section ref={flowDialogRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="flow-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFlow(false)} aria-label="Close">×</button><p className="eyebrow">{result ? 'Observed run receipt' : 'Data-flow preview'}</p><h2 id="flow-title">{result ? 'What happened in this run?' : 'See the exact path before anything is read.'}</h2>
            <p className="modal-lede">{result ? 'This receipt covers the trusted local Action Pack only and is derived from its observed event ledger. Optional model reviews have a separate digest-bound transfer receipt.' : source ? workflow.tag === 'review' ? source.sample ? 'The synthetic PDF arrived as an application asset, but PaperWork has not extracted its text or assembled claims. Both local permissions are still required.' : 'Only the selected PDF name and size are visible. Its bytes remain unread until both local permissions are approved.' : 'PaperWork is processing this PDF inside the current browser tab. Provider review is available only after a trusted local result and a separate payload approval.' : 'No source is selected. The trusted path has no account service, document upload endpoint, provider call or telemetry integration.'}</p>
            <div className="flow-diagram"><div><span>1</span><strong>{source ? 'Selected PDF' : 'Your PDF'}</strong><small>{source ? source.name : 'Not selected yet'}</small></div><i>→</i><div><span>2</span><strong>Local worker + trusted assembler</strong><small>{result ? 'Completed in this tab' : source ? 'Runs only after approval' : 'Waiting locally'}</small></div><i>→</i><div className="flow-stop"><span>×</span><strong>No local-run transfer</strong><small>No AI provider or PaperWork processing server</small></div></div>
            <dl className="receipt-list"><div><dt>Processing</dt><dd>{result?.view.receipt.processingMode ?? (source ? 'Not started' : 'No source selected')}</dd></div><div><dt>PDF contents read</dt><dd>{result ? 'Yes, in this tab' : workflow.tag === 'processing' ? 'Locally in progress' : 'No'}</dd></div><div><dt>Local-run transfers</dt><dd>{result ? `${result.view.receipt.transferCount} recorded` : 'None available'}</dd></div><div><dt>AI provider in trusted run</dt><dd>{result?.view.receipt.providerUsed ? 'Recorded' : 'Not used'}</dd></div><div><dt>PaperWork processing server</dt><dd>{result?.view.receipt.serverUsed ? 'Recorded' : 'Not used'}</dd></div>{result && <><div><dt>Parser</dt><dd>{result.view.receipt.parser}</dd></div><div><dt>Validator</dt><dd>{result.view.receipt.validator}</dd></div><div><dt>Completed</dt><dd>{formatTime(result.view.receipt.completedAt)}</dd></div><div><dt>Browser retention</dt><dd>{result.view.receipt.browserRetention}</dd></div></>}</dl>
            <p className="future-note"><strong>Open-source trust boundary:</strong> Parsed JSON is never enough to render. Only the final frozen object registered by the private trusted assembler is accepted by this result workspace.</p><button className="primary-button full" onClick={() => setShowFlow(false)}>Understood</button>
          </section>
        </div>
      )}
    </main>
  );
}

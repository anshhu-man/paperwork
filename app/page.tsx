'use client';

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';

type Phase = 'home' | 'review' | 'processing' | 'result';
type Source = { name: string; meta: string; kind: 'file' | 'link'; sample?: boolean };
type EvidenceKind = 'source' | 'inference' | 'suggestion' | 'unconfirmed';

type Evidence = {
  id: string;
  kind: EvidenceKind;
  label: string;
  title: string;
  quote: string;
  location: string;
  rationale: string;
};

const evidence: Record<string, Evidence> = {
  deadline: {
    id: 'deadline', kind: 'source', label: 'From your source', title: 'Acceptance deadline',
    quote: 'Please sign and return a copy of this letter no later than 5 September 2026.',
    location: 'Page 3 · Paragraph 2',
    rationale: 'The document directly states the date by which the signed letter must be returned.',
  },
  notice: {
    id: 'notice', kind: 'source', label: 'From your source', title: 'Notice period',
    quote: 'Following confirmation, either party may terminate employment by providing 90 days written notice.',
    location: 'Page 2 · Clause 7',
    rationale: 'The 90-day obligation is explicitly stated in the termination clause.',
  },
  salary: {
    id: 'salary', kind: 'inference', label: 'PaperWork inference', title: 'Compensation needs clarification',
    quote: 'Your annual cost to company will be ₹12,00,000 as detailed in Annexure B.',
    location: 'Page 1 · Compensation',
    rationale: 'The total amount is stated, but Annexure B was not included in the uploaded sources.',
  },
  location: {
    id: 'location', kind: 'unconfirmed', label: 'Not confirmed', title: 'Work location',
    quote: 'Your initial place of work will be Bengaluru or another company location as required.',
    location: 'Page 1 · Paragraph 4',
    rationale: 'The document does not confirm whether remote or hybrid work is permitted.',
  },
  receipt: {
    id: 'receipt', kind: 'suggestion', label: 'Suggested next step', title: 'Confirm receipt after signing',
    quote: 'Please sign and return a copy of this letter no later than 5 September 2026.',
    location: 'Based on Page 3 · Paragraph 2',
    rationale: 'The source specifies a deadline but does not explain how receipt will be acknowledged.',
  },
};

const tasks = [
  { id: 1, priority: 'Do first', title: 'Request the missing compensation annexure', detail: 'The offer refers to Annexure B, but it is not included in your sources.', due: 'Before accepting', evidence: 'salary' },
  { id: 2, priority: 'Important', title: 'Confirm the work-location policy', detail: 'Ask whether the role is on-site, hybrid, or eligible for remote work.', due: 'Before 5 Sep', evidence: 'location' },
  { id: 3, priority: 'Review', title: 'Consider the 90-day notice period', detail: 'The notice obligation begins after your probation is confirmed.', due: 'Before accepting', evidence: 'notice' },
  { id: 4, priority: 'Final step', title: 'Sign and return the offer letter', detail: 'Return the signed copy and request written confirmation of receipt.', due: '5 Sep 2026', evidence: 'deadline' },
];

const processingSteps = [
  'Opening your source on this device',
  'Finding dates, amounts, duties and missing details',
  'Separating source facts from PaperWork suggestions',
  'Linking every important claim to evidence',
  'Building your action plan',
];

function Brand() {
  return (
    <button className="brand brand-button" onClick={() => window.location.reload()} aria-label="PaperWork home">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span>PaperWork</span>
    </button>
  );
}

function TrustBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`trust-badge ${compact ? 'compact' : ''}`}>
      <span className="status-dot" /> Private session · nothing leaves this browser
    </span>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('home');
  const [sourceMode, setSourceMode] = useState<'upload' | 'link'>('upload');
  const [source, setSource] = useState<Source | null>(null);
  const [linkValue, setLinkValue] = useState('');
  const [intent, setIntent] = useState('Guide me');
  const [progress, setProgress] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [activeEvidence, setActiveEvidence] = useState<Evidence>(evidence.salary);
  const [showFlow, setShowFlow] = useState(false);
  const [showOpenSource, setShowOpenSource] = useState(false);
  const [resultTab, setResultTab] = useState<'overview' | 'plan' | 'sources'>('overview');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== 'processing') return;
    setProgress(0);
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= processingSteps.length - 1) {
          window.clearInterval(timer);
          window.setTimeout(() => setPhase('result'), 520);
          return current;
        }
        return current + 1;
      });
    }, 520);
    return () => window.clearInterval(timer);
  }, [phase]);

  function stageFile(file?: File) {
    if (!file) return;
    const size = file.size > 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    setSource({ name: file.name, meta: `${file.type || 'Document'} · ${size}`, kind: 'file' });
    setPhase('review');
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    stageFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    stageFile(event.dataTransfer.files?.[0]);
  }

  function stageLink(event: FormEvent) {
    event.preventDefault();
    const trimmed = linkValue.trim();
    if (!trimmed) return;
    setSource({ name: trimmed.replace(/^https?:\/\//, '').slice(0, 62), meta: 'Public web link', kind: 'link' });
    setPhase('review');
  }

  function useSample() {
    setSource({ name: 'Northstar_Offer_Letter.pdf', meta: 'PDF · 3 pages · Sample', kind: 'file', sample: true });
    setPhase('review');
  }

  function openEvidence(id: string) {
    setActiveEvidence(evidence[id]);
  }

  function askPaperWork(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswer('The source confirms a response deadline of 5 September 2026. It does not confirm that Annexure B was included, so request that attachment before accepting.');
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      {phase === 'home' && (
        <>
          <header className="site-header">
            <Brand />
            <nav className="header-nav" aria-label="Primary navigation">
              <a href="#how-it-works">How it works</a>
              <button onClick={() => setShowFlow(true)}>Transparency</button>
              <button className="github-link" onClick={() => setShowOpenSource(true)}>Open source <span aria-hidden="true">↗</span></button>
            </nav>
          </header>

          <section className="hero-shell">
            <div className="hero-copy">
              <p className="eyebrow"><span className="status-dot" /> Private by design · Open source</p>
              <h1>From confusing paper<br />to clear next steps.</h1>
              <p className="hero-lede">Add a document, image, or link. PaperWork explains what it means, finds what matters, and builds an action plan backed by evidence.</p>
            </div>

            <div className="workspace-preview" aria-label="Add a source to PaperWork">
              <div className="upload-card">
                <div className="upload-tabs" role="tablist" aria-label="Source type">
                  <button className={`upload-tab ${sourceMode === 'upload' ? 'active' : ''}`} onClick={() => setSourceMode('upload')} role="tab" aria-selected={sourceMode === 'upload'}>Upload</button>
                  <button className={`upload-tab ${sourceMode === 'link' ? 'active' : ''}`} onClick={() => setSourceMode('link')} role="tab" aria-selected={sourceMode === 'link'}>Paste a link</button>
                </div>

                {sourceMode === 'upload' ? (
                  <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
                    <span className="file-glyph" aria-hidden="true"><span /></span>
                    <h2>Drop your paper here</h2>
                    <p>PDF, DOCX, PNG or JPG · Up to 25 MB</p>
                    <button className="primary-button" onClick={() => fileInputRef.current?.click()}>Choose a file</button>
                    <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" onChange={onFileChange} />
                  </div>
                ) : (
                  <form className="link-zone" onSubmit={stageLink}>
                    <span className="link-symbol" aria-hidden="true">↗</span>
                    <h2>Paste a public link</h2>
                    <p>PaperWork will use the page as a source and preserve its URL as evidence.</p>
                    <label className="visually-hidden" htmlFor="source-url">Source URL</label>
                    <div className="link-input-row">
                      <input id="source-url" type="url" placeholder="https://example.org/document" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} />
                      <button className="primary-button" type="submit">Add link</button>
                    </div>
                  </form>
                )}

                <div className="example-row">
                  <span>Not ready to upload?</span>
                  <button className="text-button" onClick={useSample}>Try a sample offer letter <span aria-hidden="true">→</span></button>
                </div>
              </div>

              <aside className="trust-card">
                <p className="trust-kicker">Private by design</p>
                <h2>Your document.<br />Your control.</h2>
                <p className="trust-intro">Privacy is visible at every step, not hidden in fine print.</p>
                <ul>
                  <li><span className="check">01</span><span><strong>No account needed</strong><small>Use PaperWork without creating a profile.</small></span></li>
                  <li><span className="check">02</span><span><strong>Held on your device</strong><small>Your selected source stays in browser memory.</small></span></li>
                  <li><span className="check">03</span><span><strong>Explicit consent</strong><small>Review the data flow before processing begins.</small></span></li>
                </ul>
                <button className="data-flow-button" onClick={() => setShowFlow(true)}>View privacy architecture <span aria-hidden="true">→</span></button>
              </aside>
            </div>
          </section>

          <section className="proof-strip" id="how-it-works" aria-label="PaperWork process">
            <div><span>01</span><strong>Add any source</strong><p>Files, scans, screenshots or links</p></div>
            <div><span>02</span><strong>PaperWork finds what matters</strong><p>Dates, duties, risks and missing details</p></div>
            <div><span>03</span><strong>Get a plan with proof</strong><p>Every next step links to its evidence</p></div>
          </section>
        </>
      )}

      {phase === 'review' && source && (
        <div className="app-stage">
          <header className="app-header">
            <Brand />
            <TrustBadge />
            <button className="quiet-button" onClick={() => { setSource(null); setPhase('home'); }}>Cancel</button>
          </header>
          <section className="review-shell">
            <button className="back-button" onClick={() => setPhase('home')}>← Back</button>
            <div className="review-heading">
              <p className="eyebrow">Review your source</p>
              <h1>Ready to build your plan.</h1>
              <p>Confirm what PaperWork should help you do. You can add more sources later.</p>
            </div>

            <div className="review-grid">
              <section className="review-main-card">
                <div className="section-label-row"><span>1</span><h2>Your source</h2></div>
                <div className="source-item">
                  <span className="source-icon">{source.kind === 'link' ? '↗' : 'P'}</span>
                  <span className="source-copy"><strong>{source.name}</strong><small>{source.meta}</small></span>
                  <button aria-label="Remove source" onClick={() => { setSource(null); setPhase('home'); }}>×</button>
                </div>
                <button className="add-source-button" onClick={() => setPhase('home')}>＋ Add another source</button>

                <div className="section-divider" />
                <div className="section-label-row"><span>2</span><h2>What do you need?</h2></div>
                <div className="intent-grid">
                  {['Guide me', 'Find risks', 'Help me respond', 'Compare sources'].map((item) => (
                    <button key={item} className={intent === item ? 'selected' : ''} onClick={() => setIntent(item)}>
                      <span>{item === 'Guide me' ? '◎' : item === 'Find risks' ? '△' : item === 'Help me respond' ? '↗' : '⇄'}</span>{item}
                    </button>
                  ))}
                </div>
              </section>

              <aside className="review-side-card">
                <p className="trust-kicker">Processing receipt</p>
                <h2>Know before you analyse.</h2>
                <dl>
                  <div><dt>Processed on</dt><dd>This device</dd></div>
                  <div><dt>Sent externally</dt><dd>Nothing</dd></div>
                  <div><dt>Stored by PaperWork</dt><dd>No</dd></div>
                  <div><dt>External knowledge</dt><dd>Off</dd></div>
                </dl>
                <button className="preview-flow-link" onClick={() => setShowFlow(true)}>Review the full data flow →</button>
                <div className="assurance-note"><strong>Sample analysis mode</strong><p>This session uses a prepared Action Pack while the model connection is disabled. Your selected source is never transmitted.</p></div>
                <button className="primary-button large" onClick={() => setPhase('processing')}>Build my plan <span>→</span></button>
              </aside>
            </div>
          </section>
        </div>
      )}

      {phase === 'processing' && source && (
        <div className="processing-page">
          <div className="processing-top"><Brand /><TrustBadge compact /></div>
          <section className="processing-card" aria-live="polite">
            <div className="processing-paper"><span>P</span><i /><i /><i /></div>
            <p className="eyebrow">Preparing your Action Pack</p>
            <h1>Turning your paper into a plan.</h1>
            <p className="processing-file">{source.name}</p>
            <ol className="processing-list">
              {processingSteps.map((step, index) => (
                <li key={step} className={index < progress ? 'done' : index === progress ? 'active' : ''}>
                  <span>{index < progress ? '✓' : index === progress ? <i /> : index + 1}</span>{step}
                </li>
              ))}
            </ol>
            <button className="quiet-button" onClick={() => setPhase('review')}>Cancel</button>
          </section>
        </div>
      )}

      {phase === 'result' && source && (
        <div className="result-page">
          <header className="result-header">
            <Brand />
            <nav className="result-nav" aria-label="Action Pack sections">
              {(['overview', 'plan', 'sources'] as const).map((tab) => (
                <button key={tab} className={resultTab === tab ? 'active' : ''} onClick={() => setResultTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>
              ))}
            </nav>
            <button className="privacy-pill" onClick={() => setShowFlow(true)}><span>✓</span> Privacy receipt</button>
          </header>

          <div className="sample-banner"><strong>Sample analysis</strong><span>Prepared offer-letter content · No source transmitted · No AI provider connected</span></div>

          {resultTab === 'overview' && (
            <div className="result-grid">
              <aside className="result-sidebar">
                <p className="side-label">Your sources</p>
                <div className="mini-source"><span>{source.kind === 'link' ? '↗' : 'P'}</span><div><strong>{source.name}</strong><small>{source.meta}</small></div></div>
                <button className="side-add" onClick={() => setPhase('home')}>＋ Add source</button>
                <div className="side-rule" />
                <p className="side-label">Evidence coverage</p>
                <div className="coverage-ring"><span>8</span><small>claims cited</small></div>
                <p className="coverage-copy"><strong>2 need your review</strong><br />No unsupported claim is hidden.</p>
                <button className="side-receipt" onClick={() => setShowFlow(true)}>Where did my data go? →</button>
              </aside>

              <section className="result-main">
                <div className="result-title-row">
                  <div>
                    <p className="document-type">Employment offer · Sample analysis</p>
                    <h1>Software Engineer<br />Offer Letter</h1>
                  </div>
                  <div className="result-statuses"><span className="status-action">Action required</span><span>Due 5 Sep</span></div>
                </div>

                <div className="brief-card">
                  <p className="card-kicker">The brief</p>
                  <p>You have been offered a Software Engineer role. Before accepting, request the missing compensation annexure and confirm the work-location policy.</p>
                  <button onClick={() => openEvidence('deadline')}>3 source facts support this brief <span>→</span></button>
                </div>

                <section className="next-move-card">
                  <div className="next-number">01</div>
                  <div className="next-copy">
                    <p className="card-kicker">Your next move</p>
                    <h2>Request the missing compensation annexure.</h2>
                    <p>The ₹12,00,000 annual package points to Annexure B, but that attachment is missing from your sources.</p>
                    <div className="next-actions"><button className="primary-button" onClick={() => setChecked((items) => items.includes(1) ? items : [...items, 1])}>Mark as done</button><button className="evidence-chip inference" onClick={() => openEvidence('salary')}>◎ PaperWork inference</button></div>
                  </div>
                  <div className="next-due"><small>Complete</small><strong>Before accepting</strong></div>
                </section>

                <section className="facts-section">
                  <div className="section-heading"><div><p className="card-kicker">At a glance</p><h2>What matters most</h2></div><button>View all 8 facts →</button></div>
                  <div className="fact-grid">
                    <button onClick={() => openEvidence('deadline')}><small>Respond by</small><strong>5 Sep 2026</strong><span className="evidence-chip source">● From source</span></button>
                    <button onClick={() => openEvidence('salary')}><small>Annual CTC</small><strong>₹12,00,000</strong><span className="evidence-chip source">● From source</span></button>
                    <button onClick={() => openEvidence('notice')}><small>Notice period</small><strong>90 days</strong><span className="evidence-chip source">● From source</span></button>
                  </div>
                </section>

                <section className="attention-card">
                  <div className="attention-icon">!</div>
                  <div><p className="card-kicker">Needs your attention</p><h3>One referenced attachment is missing.</h3><p>The compensation section depends on Annexure B. Ask for it before accepting the offer.</p></div>
                  <button onClick={() => openEvidence('salary')}>View evidence →</button>
                </section>

                <section className="plan-section">
                  <div className="section-heading"><div><p className="card-kicker">Your plan</p><h2>Four steps to be ready</h2></div><span>{checked.length} of 4 complete</span></div>
                  <div className="progress-track"><span style={{ width: `${checked.length * 25}%` }} /></div>
                  <div className="task-list">
                    {tasks.map((task) => (
                      <article className={`task-item ${checked.includes(task.id) ? 'completed' : ''}`} key={task.id}>
                        <button className="task-check" aria-label={`Mark ${task.title} complete`} onClick={() => setChecked((items) => items.includes(task.id) ? items.filter((id) => id !== task.id) : [...items, task.id])}>{checked.includes(task.id) ? '✓' : ''}</button>
                        <div className="task-copy"><div><span className="task-priority">{task.priority}</span><span className="task-due">{task.due}</span></div><h3>{task.title}</h3><p>{task.detail}</p><button className={`evidence-chip ${evidence[task.evidence].kind}`} onClick={() => openEvidence(task.evidence)}>● {evidence[task.evidence].label}</button></div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="ask-card">
                  <div><p className="card-kicker">Ask PaperWork</p><h2>Questions grounded in your sources.</h2></div>
                  <form onSubmit={askPaperWork}><input aria-label="Ask a question about this paper" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What happens if I accept without Annexure B?" /><button type="submit">Ask →</button></form>
                  <div className="ask-suggestions"><button onClick={() => setQuestion('Draft an email asking for Annexure B')}>Draft a reply</button><button onClick={() => setQuestion('What am I missing?')}>What am I missing?</button><button onClick={() => setQuestion('Explain the notice period')}>Explain the notice period</button></div>
                  {answer && <div className="answer-box"><span className="evidence-chip source">● Source-grounded answer</span><p>{answer}</p><button onClick={() => openEvidence('deadline')}>View supporting evidence →</button></div>}
                </section>
              </section>

              <aside className={`evidence-panel ${activeEvidence.kind}`}>
                <div className="evidence-panel-head"><p className="side-label">Evidence</p><span className={`evidence-chip ${activeEvidence.kind}`}>● {activeEvidence.label}</span></div>
                <h2>{activeEvidence.title}</h2>
                <blockquote>“{activeEvidence.quote}”</blockquote>
                <p className="evidence-location">{activeEvidence.location}</p>
                <div className="evidence-explain"><small>Why you are seeing this</small><p>{activeEvidence.rationale}</p></div>
                <dl className="evidence-meta"><div><dt>OCR used</dt><dd>No</dd></div><div><dt>External sources</dt><dd>None</dd></div><div><dt>Last checked</dt><dd>Just now</dd></div></dl>
                <button className="outline-button">View in document</button>
                <button className="correct-link">Correct extracted text</button>
              </aside>
            </div>
          )}

          {resultTab === 'plan' && (
            <section className="standalone-panel">
              <p className="eyebrow">Action plan</p><h1>Four steps to be ready.</h1><p className="standalone-lede">Each task explains why it matters and what source evidence supports it.</p>
              <div className="task-list wide">{tasks.map((task) => <article className={`task-item ${checked.includes(task.id) ? 'completed' : ''}`} key={task.id}><button className="task-check" onClick={() => setChecked((items) => items.includes(task.id) ? items.filter((id) => id !== task.id) : [...items, task.id])}>{checked.includes(task.id) ? '✓' : ''}</button><div className="task-copy"><span className="task-priority">{task.priority}</span><h3>{task.title}</h3><p>{task.detail}</p><button className={`evidence-chip ${evidence[task.evidence].kind}`} onClick={() => { openEvidence(task.evidence); setResultTab('overview'); }}>● {evidence[task.evidence].label}</button></div><strong className="standalone-due">{task.due}</strong></article>)}</div>
            </section>
          )}

          {resultTab === 'sources' && (
            <section className="standalone-panel sources-panel">
              <p className="eyebrow">Sources & transparency</p><h1>Everything PaperWork used.</h1><p className="standalone-lede">No external source or hidden knowledge was added to this sample Action Pack.</p>
              <div className="source-detail"><div className="big-source-icon">{source.kind === 'link' ? '↗' : 'P'}</div><div><p className="card-kicker">Primary source</p><h2>{source.name}</h2><p>{source.meta}</p></div><span>Active</span></div>
              <div className="source-stats"><div><small>Claims extracted</small><strong>10</strong></div><div><small>Claims with citations</small><strong>8</strong></div><div><small>Need review</small><strong>2</strong></div><div><small>External references</small><strong>0</strong></div></div>
              <button className="outline-button" onClick={() => setShowFlow(true)}>Open privacy receipt</button>
            </section>
          )}
        </div>
      )}

      {showFlow && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowFlow(false)}>
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="flow-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFlow(false)} aria-label="Close">×</button>
            <p className="eyebrow">Transparency receipt</p>
            <h2 id="flow-title">Where did my data go?</h2>
            <p className="modal-lede">In this private session, your selected source stays in your browser. No file contents are read, uploaded, stored, or sent to an AI provider.</p>
            <div className="flow-diagram"><div><span>1</span><strong>Your source</strong><small>Browser memory only</small></div><i>→</i><div><span>2</span><strong>PaperWork workspace</strong><small>Sample Action Pack</small></div><i>→</i><div className="flow-stop"><span>×</span><strong>No external service</strong><small>Nothing transmitted</small></div></div>
            <dl className="receipt-list"><div><dt>Processed on</dt><dd>This browser</dd></div><div><dt>AI provider</dt><dd>Not connected</dd></div><div><dt>Sent externally</dt><dd>Nothing</dd></div><div><dt>Stored by PaperWork</dt><dd>Nothing</dd></div><div><dt>Used for training</dt><dd>No</dd></div><div><dt>Cleared</dt><dd>When this tab closes</dd></div></dl>
            <p className="future-note"><strong>Production principle:</strong> PaperWork will show this receipt before analysis and preview the exact content being sent whenever a user chooses cloud processing.</p>
            <button className="primary-button full" onClick={() => setShowFlow(false)}>Understood</button>
          </section>
        </div>
      )}

      {showOpenSource && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowOpenSource(false)}>
          <section className="modal-panel open-source-modal" role="dialog" aria-modal="true" aria-labelledby="oss-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOpenSource(false)} aria-label="Close">×</button>
            <p className="eyebrow">Built in public</p><h2 id="oss-title">Open by default.</h2>
            <p className="modal-lede">PaperWork’s interface, prompts, evidence schema, privacy threat model, and evaluation suite are designed to be inspectable and community-owned.</p>
            <div className="oss-grid"><div><span>01</span><strong>Inspect the logic</strong><p>See how source facts, inferences, and suggestions are separated.</p></div><div><span>02</span><strong>Test every claim</strong><p>Run citation-quality and hallucination evaluations locally.</p></div><div><span>03</span><strong>Bring your model</strong><p>Connect a local model or a provider you already trust.</p></div></div>
            <p className="future-note">The complete working source is included with PaperWork and licensed under MIT for community use, inspection, and contribution.</p>
            <button className="primary-button full" onClick={() => setShowOpenSource(false)}>Explore PaperWork</button>
          </section>
        </div>
      )}
    </main>
  );
}

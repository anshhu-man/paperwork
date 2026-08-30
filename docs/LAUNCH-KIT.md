# PaperWork launch kit

PaperWork is an open-source tool that turns an employment offer letter into a
plain-language, evidence-backed action plan. The first launch should attract a
small group of thoughtful users and contributors, not manufacture hype.

## Release bar

**Do not promote PaperWork until there is a usable public demo.** The URL must
complete a real offer-letter analysis, citations must open the supporting
passages, privacy disclosures must match production behavior, and the sample
flow must work on mobile and desktop. A landing page, waitlist, recorded mockup,
or local-only build is not enough.

Avoid “foolproof,” “100% accurate,” “replaces a lawyer,” “revolutionary,” and
revenue or million-dollar claims. Say what works today, name what does not, and
label sample data and staged results honestly.

## Faceless launch plan

### Audience and message

- Initial user: students and early-career professionals reviewing an offer
  letter.
- Promise: “See what the letter says, what needs attention, and what to do next —
  with evidence for every important claim.”
- Proof: a public sample, a real upload path, clickable citations, visible
  uncertainty, an outbound-data preview, and open source code.

### Sequence

1. Invite 10–20 consented testers to use the public demo with sample or redacted
   letters. Fix blocked uploads, wrong citations, confusing privacy copy, and
   mobile usability issues before broader promotion.
2. Publish a tagged release, a short changelog, the evaluation results, known
   limitations, security contact, and privacy model.
3. Record the screen-only demo below using a synthetic letter. Add captions and
   remove notifications, API keys, filenames, and personal information.
4. Launch on GitHub first, then submit a factual Show HN post. Share only in
   relevant subreddits whose rules allow creator posts, with clear affiliation.
5. Adapt the same proof-led message for LinkedIn and X. Link directly to the
   working demo and repository; do not collect emails merely to reveal access.
6. Spend launch day answering questions, documenting failures, and shipping
   small fixes. Publish corrections instead of quietly changing claims.

## Ready-to-edit launch copy

Replace all bracketed fields and verify every statement against the deployed
release before posting.

### GitHub release / repository announcement

**Title:** PaperWork v0.1 — evidence-backed offer-letter analysis

PaperWork is an open-source tool for turning an employment offer letter into a
clear action plan. Upload a PDF or image and it identifies important dates,
compensation details, obligations, missing information, and questions worth
asking. Every material claim links back to the supporting passage; unsupported
answers are marked “Not confirmed.”

The v0.1 demo supports [supported inputs] and uses [processing provider/mode].
[Precisely describe transmission, storage, and retention.] It is informational,
not legal or financial advice.

Try the demo: [DEMO URL]

Read the code: [REPOSITORY URL]

Known limitations and evaluation results: [LINK]

Useful feedback: incorrect citations, missed clauses, unclear privacy language,
and mobile accessibility problems.

### Hacker News

**Title:** Show HN: PaperWork – open-source, cited offer-letter analysis

I built PaperWork because AI document summaries often hide the distinction
between what a document says and what the model recommends. PaperWork turns an
offer letter into key facts, attention points, questions, and next actions. Each
material claim opens the supporting passage and is labelled as directly stated,
inferred, suggested, or not confirmed.

The public demo is here: [DEMO URL] and the code is here: [REPOSITORY URL]. It
currently supports [INPUTS]. Documents are [WHERE PROCESSED], [WHAT IS SENT], and
[RETENTION FACTS]. The evaluation set and current limitations are published at
[LINK].

I would especially value feedback on citation failures, the usefulness of the
action plan, and whether the pre-upload data-flow explanation is understandable.

### Reddit

**Suggested title:** I made an open-source tool that explains offer letters with
clickable evidence — looking for careful feedback

Disclosure: I am the creator of PaperWork. It turns an offer letter into a short
brief, prioritized checklist, missing-information list, and questions to ask.
Every important result links to the exact source passage, and the tool says “Not
confirmed” when the letter does not contain enough evidence.

Demo: [DEMO URL]

Source: [REPOSITORY URL]

It supports [INPUTS]. Documents are [PROCESSING/STORAGE FACTS]. Please use the
synthetic sample if you do not want to upload a private document. It is not
legal, financial, or employment advice.

I am looking for reports of wrong citations, missed terms, accessibility issues,
and anything in the privacy explanation that feels unclear. If this type of post
is not permitted here, I am happy to remove it.

Before posting, read the specific subreddit rules, avoid cross-posting identical
copy, and participate in the discussion rather than dropping a link.

### LinkedIn

I have released PaperWork v0.1, an open-source experiment in more transparent
document AI.

It analyzes employment offer letters and returns key facts, attention points,
questions, and next actions. The important difference is inspectability: every
material claim links to the supporting passage and clearly separates source
facts from inference and suggestions.

Try the working demo: [DEMO URL]

View the code and limitations: [REPOSITORY URL]

PaperWork currently supports [INPUTS]. Documents are [PROCESSING/STORAGE FACTS].
It is informational, not legal or financial advice. I would value specific
feedback on citation accuracy, privacy clarity, and whether the plan helps you
decide what to do next.

### X

**Post 1**

I built PaperWork, an open-source tool that turns an offer letter into an
evidence-backed action plan. Important claims link to the exact source passage;
missing support is labelled “Not confirmed.” [DEMO URL] [REPOSITORY URL]

**Post 2**

PaperWork separates 4 things that document summaries often blur: directly
stated facts, inferences, suggested actions, and unconfirmed gaps. Here is a
60-second screen-only walkthrough: [VIDEO URL]

**Post 3**

Current scope: [INPUTS AND LIMITS]. Data handling: [PROCESSING/STORAGE FACTS]. It
is not legal or financial advice. Feedback on wrong citations and unclear
privacy language is particularly useful: [ISSUES URL]

## Faceless demo-video storyboard

Target length: 60–75 seconds. Record only the browser window, use a synthetic
offer letter, add large captions, and provide an accurate transcript. Use quiet
background audio or none; narration is optional.

| Time | Screen | Caption or narration |
| --- | --- | --- |
| 0–5s | Start on the upload screen | “An offer letter is easy to summarize. It is harder to show what proves the summary.” |
| 5–12s | Choose the clearly labelled synthetic sample | “PaperWork is open source. You can try it without uploading a private document.” |
| 12–20s | Expand the pre-upload data-flow panel | “Before analysis, it shows what leaves your device, who processes it, and what is retained.” |
| 20–30s | Run the analysis and show the processing stages | “It extracts the document, finds material terms, and validates claims against the source.” |
| 30–42s | Land on the brief and next-action card | “The result starts with what this is, whether action is required, the nearest deadline, and the next step.” |
| 42–54s | Open compensation and notice-period citations | “Click any important claim to see the exact supporting passage and its evidence label.” |
| 54–62s | Show a missing annexure or unconfirmed term | “PaperWork exposes missing information instead of guessing.” |
| 62–70s | Open the processing receipt | “You can inspect the data path and analysis receipt.” |
| 70–75s | Show demo and repository links | “Try the public demo, inspect the code, and report a bad citation.” |

Do not edit around failures to imply capabilities the release does not have. If
the video uses preloaded or cached output, label that state on screen.

## Launch checklist

### Product and evidence

- [ ] The public URL completes a real analysis; sample results are labelled.
- [ ] Every material claim has a working citation or uncertainty label.
- [ ] Low-quality scans, missing pages, and provider failures have useful states.
- [ ] The synthetic demo letter has permission-safe content and no real identity.
- [ ] Limitations and evaluation results are public and match the release.

### Privacy and security

- [ ] Pre-upload copy accurately names processing, transmission, retention, and
      deletion behavior.
- [ ] Production logs and error tracking contain no document text or secrets.
- [ ] File validation, rate limits, security headers, dependency scans, and
      abuse controls have been verified.
- [ ] Privacy policy, security contact, and deletion instructions are reachable.

### Accessibility and reliability

- [ ] The full flow works by keyboard and with a screen reader.
- [ ] Contrast, focus states, captions, transcript, and 200% zoom are checked.
- [ ] Mobile Safari, mobile Chrome, and desktop Chrome/Firefox pass the core flow.
- [ ] Availability monitoring and rollback ownership are in place.

### Launch assets

- [ ] Demo URL, repository URL, issue tracker, and video URL are final.
- [ ] Screenshots and video show the current production build.
- [ ] Channel copy has accurate placeholders, disclosure, and no inflated claims.
- [ ] Reddit/community rules are checked before posting.

### Launch day and follow-through

- [ ] A maintainer is available to triage privacy, security, and citation reports.
- [ ] Track completed analyses, failure rate, citation opens, corrections, and
      qualitative feedback—not sign-up vanity metrics.
- [ ] Acknowledge reproducible problems and publish corrections or rollback.
- [ ] Summarize what users found and update the roadmap within one week.

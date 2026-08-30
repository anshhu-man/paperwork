# Contributing to PaperWork

Thank you for helping make paperwork easier to understand. Contributions to accessibility, translation, privacy, evaluation, document extraction, and evidence quality are especially welcome.

## Start here

1. Read the [roadmap](ROADMAP.md), [architecture](docs/ARCHITECTURE.md), and [privacy threat model](docs/PRIVACY-THREAT-MODEL.md).
2. Search existing issues and Discussions before starting substantial work.
3. Comment on the issue you want to take, or open a focused proposal first. Maintainers can help narrow the acceptance criteria.
4. Use synthetic, public-domain, or redistributable samples only. Never commit a real person's paperwork.

## Local setup

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run lint
npm run build
```

## Contribution requirements

- Describe the user problem and document type affected.
- Preserve distinct types and visible labels for source facts, PaperWork inferences, suggested actions, conflicts, and unconfirmed information.
- Add or update tests for citation coverage and unsupported claims when analysis behavior changes.
- Never add telemetry, retention, persistence, external fetching, or data transmission without an updated threat model and visible user disclosure.
- Keep pull requests focused and document limitations honestly.
- Meet WCAG-aligned keyboard, focus, contrast, zoom, and screen-reader expectations for affected UI.

Security reports belong in [private vulnerability reporting](https://github.com/anshhu-man/paperwork/security/advisories/new), not a public issue. By participating, you agree to follow the [community code of conduct](CODE_OF_CONDUCT.md).

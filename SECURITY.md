# Security policy

PaperWork is designed for documents that may contain sensitive information. Never disclose a vulnerability, exploit, credential, personal data, or private document in a public issue or discussion.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/anshhu-man/paperwork/security/advisories/new). Include the affected version or commit, impact, reproduction steps using synthetic data, and any suggested mitigation. The report is handled through a private repository security advisory rather than a public issue.

Please allow maintainers a reasonable opportunity to investigate before public disclosure. We will acknowledge a report, assess its impact, and coordinate next steps through the private advisory.

## Current security boundary

The current sample frontend does not read, upload, parse, retain, or send selected file contents to an AI provider. It has no application database, account system, telemetry, or document-processing backend. Hosting infrastructure and normal web requests remain outside that application boundary.

Any future parsing, URL fetching, AI call, storage, telemetry, or sharing capability must update the [privacy threat model](docs/PRIVACY-THREAT-MODEL.md), user-facing data-flow receipt, and negative transmission tests before release.

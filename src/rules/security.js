// community/security — SECURITY.md with a private reporting channel.
import { firstExisting, hasContactChannel } from './util.js';

const CANDIDATES = ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md'];

export const securityRule = {
  id: 'community/security',
  title: 'SECURITY.md with a private reporting channel',
  severity: 'error',
  tier: 'cheap',
  fixable: 'generate',
  docs: `Why: someone who discovers a vulnerability in your project needs to know
where to report it *privately*. If they can't find a channel, they either
publicise the issue or walk away — both are losses.

What dxlint checks:
  1. SECURITY.md exists (root, .github/, or docs/).
  2. It contains a contact channel — an email address, a mailto: link, or a
     URL (typically a GitHub security advisory form).

Pass example:
  ## Reporting a Vulnerability
  Email security@example.com or use
  https://github.com/acme/repo/security/advisories/new

Fixable: \`dxlint fix --apply\` creates SECURITY.md with a standard private-
reporting template (including an advisory URL placeholder). An existing
SECURITY.md that lacks a contact is reported, never rewritten.`,
  evaluate(ctx) {
    const path = firstExisting(ctx, CANDIDATES);
    if (!path) {
      return [
        {
          severity: 'error',
          message: 'This repository has no security policy',
          evidence: `looked for ${CANDIDATES.join(', ')}`,
          remediation:
            'Add SECURITY.md explaining how to report vulnerabilities privately (email or security advisory).',
          location: { path: 'SECURITY.md' },
          fixable: true,
        },
      ];
    }
    const text = ctx.fs.readFile(path) ?? '';
    if (!hasContactChannel(text)) {
      return [
        {
          severity: 'error',
          message: `${path} exists but gives reporters no way to reach you privately`,
          evidence: 'no email address, mailto: link, or URL found in the security policy',
          remediation: 'Add a private contact: a security email address or an advisory-reporting URL.',
          location: { path },
          fixable: false,
        },
      ];
    }
    return [];
  },
  fix() {
    const content = `# Security Policy

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, report them privately using one of these channels:

- GitHub Security Advisories: https://github.com/<owner>/<repo>/security/advisories/new
- Email: <replace with your security contact email>

We will acknowledge receipt within 72 hours and work with you on a fix and
coordinated disclosure.

> **dxlint-generated stub.** Replace \`<owner>/<repo>\` and the email placeholder
> with your real private contact before publishing.
`;
    return { path: 'SECURITY.md', content };
  },
};

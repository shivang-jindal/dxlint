// community/contributing — CONTRIBUTING exists, isn't stale, has a starting
// section. Freshness via git log or file mtime (injected clock).
import { ageInDays, firstExisting } from './util.js';

export const CONTRIBUTING_CANDIDATES = [
  'CONTRIBUTING.md',
  'CONTRIBUTING.rst',
  'CONTRIBUTING.txt',
  'CONTRIBUTING',
  '.github/CONTRIBUTING.md',
  'docs/CONTRIBUTING.md',
];

const SECTION_RE = new RegExp(
  [
    '^#{1,6}\\s+.*(getting[ -]started|quick[ -]?start|development|where to (start|begin)|how to contribute|setting up|setup|building|your first (pull request|contribution))',
    '\\bwhere (do i|to) start\\b',
    '\\bfirst (pull request|contribution)\\b',
  ].join('|'),
  'im',
);

export const contributingRule = {
  id: 'community/contributing',
  title: 'CONTRIBUTING.md exists, is fresh, and shows where to start',
  severity: 'error',
  tier: 'cheap',
  fixable: false,
  docs: `Why: CONTRIBUTING.md is the first file a motivated newcomer opens. A
missing file, one that went stale over a year, or one that never says "here is
where you start" all end the same way — the contributor gives up.

What dxlint checks:
  1. A CONTRIBUTING file exists (root, .github/, or docs/).
  2. It was touched within the last 12 months (git history first, file mtime
     as the fallback; the clock is injected so results stay deterministic).
  3. It contains a getting-started / development / "where to start" style
     section heading.

Pass example:
  ## Getting Started
  Fork, clone, \`npm install\`, then run \`npm test\`.

Fail example:
  (no CONTRIBUTING.md)
  → "A first-time contributor has no CONTRIBUTING.md to open"

Not auto-fixable: writing contribution guidelines is a judgment call, so
dxlint only reports — it never generates this file for you.`,
  evaluate(ctx) {
    const findings = [];
    const path = firstExisting(ctx, CONTRIBUTING_CANDIDATES);
    if (!path) {
      findings.push({
        severity: 'error',
        message: 'A first-time contributor has no CONTRIBUTING file to open',
        evidence: `looked for ${CONTRIBUTING_CANDIDATES.join(', ')}`,
        remediation:
          'Create CONTRIBUTING.md with a "Getting Started" section covering clone, install, test, and PR basics.',
        location: { path: 'CONTRIBUTING.md' },
        fixable: false,
      });
      return findings;
    }

    const age = ageInDays(ctx, path);
    if (age !== null && age > 365) {
      findings.push({
        severity: 'warning',
        message: `CONTRIBUTING.md may be out of date — it was last touched ${age} days ago`,
        evidence: `last touched ${age} days ago (> 365 days)`,
        remediation: 'Re-read it and refresh anything that no longer matches how the project works.',
        location: { path },
        fixable: false,
      });
    }

    const text = ctx.fs.readFile(path) ?? '';
    if (!SECTION_RE.test(text)) {
      findings.push({
        severity: 'warning',
        message: 'CONTRIBUTING.md has no "where do I start?" style section',
        evidence: 'no getting-started/development heading found',
        remediation:
          'Add a short "Getting Started" section: how to install, run tests, and open your first PR.',
        location: { path },
        fixable: false,
      });
    }
    return findings;
  },
};

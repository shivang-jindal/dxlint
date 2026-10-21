// docs/changelog — CHANGELOG exists and was touched in the last 90 days.
import { ageInDays, firstExisting } from './util.js';

const CANDIDATES = [
  'CHANGELOG.md',
  'CHANGELOG',
  'CHANGELOG.txt',
  'CHANGES.md',
  'CHANGES',
  'HISTORY.md',
  'NEWS.md',
  'docs/CHANGELOG.md',
  'releases/CHANGELOG.md',
];

export const STALE_DAYS = 90;

export const changelogRule = {
  id: 'docs/changelog',
  title: 'CHANGELOG exists and is fresh (≤ 90 days)',
  severity: 'info',
  tier: 'cheap',
  fixable: false,
  docs: `Why: a newcomer deciding whether a project is alive checks two things —
recent commits and a recent changelog. A changelog that last moved 400 days
ago answers the question for them.

What dxlint checks:
  1. A changelog exists (CHANGELOG/CHANGES/HISTORY/NEWS at root, docs/, or
     releases/).
  2. It was touched within the last 90 days (git history first, file mtime
     fallback; clock injected for determinism).

Pass example: CHANGELOG.md last touched 12 days ago.

Fail example: (no CHANGELOG.md) → one info finding, severity "info" so it
nudges the grade without blocking anyone.

Not auto-fixable: only maintainers know what changed since the last release.`,
  evaluate(ctx) {
    const path = firstExisting(ctx, CANDIDATES);
    if (!path) {
      return [
        {
          severity: 'info',
          message: 'This repository has no changelog for newcomers to scan',
          evidence: `looked for ${CANDIDATES.join(', ')}`,
          remediation: 'Create CHANGELOG.md (Keep a Changelog format is fine) and keep it updated per release.',
          location: { path: 'CHANGELOG.md' },
          fixable: false,
        },
      ];
    }
    const age = ageInDays(ctx, path);
    if (age !== null && age > STALE_DAYS) {
      return [
        {
          severity: 'info',
          message: `The changelog was last touched ${age} days ago, so it may not reflect the current release`,
          evidence: `last touched ${age} days ago (> ${STALE_DAYS} days)`,
          remediation: `Add the changes since the last release to ${path}.`,
          location: { path },
          fixable: false,
        },
      ];
    }
    return [];
  },
};

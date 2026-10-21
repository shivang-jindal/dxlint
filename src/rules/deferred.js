// Deferred rules. They are part of the catalog (so coverage reporting stays
// honest) but v0 never scores them: the api tier needs the GitHub API and the
// container tier needs probe infrastructure. Both land in v1.

export const gfiFreshnessRule = {
  id: 'triage/gfi-freshness',
  title: '≥3 good first issues, median age < 90 days',
  severity: 'warning',
  tier: 'api',
  fixable: false,
  deferred: true,
  docs: `Why: "good first issue" labels are the on-ramp for first-time
contributors. If the label exists but every item is 400 days stale, the
on-ramp is a lie.

v0 status: **deferred.** This rule needs the GitHub API (cached 24h) and is
not implemented yet — it is skipped, excluded from the grade denominator, and
reported as unevaluated so the grade never silently improves.`,
  async evaluate() {
    return { skip: 'deferred to v1 (requires the GitHub API)' };
  },
};

export const freshCloneRule = {
  id: 'build/fresh-clone',
  title: 'Clean checkout installs and tests green',
  severity: 'error',
  tier: 'container',
  fixable: false,
  deferred: true,
  docs: `Why: the classic newcomer failure — clone, install, \`npm test\` fails
on a clean machine. Only a clean-room probe catches it.

v0 status: **deferred.** This rule needs container probe infrastructure
(build image from lockfile hash, run install + test with a hard timeout) and
is not implemented yet — it is skipped, excluded from the grade denominator,
and reported as unevaluated so the grade never silently improves.`,
  async evaluate() {
    return { skip: 'deferred to v1 (requires container probes)' };
  },
};

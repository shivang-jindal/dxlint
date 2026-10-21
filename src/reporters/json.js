// JSON reporter — stable schema (SPEC §6):
// {version, tool, target, tier, grade, coverage, groups, results, findings, ruleErrors}
// No timestamps or absolute paths: two runs over the same tree are identical.
export function buildReport({ target, tier, toolVersion, scan, grade }) {
  return {
    version: 1,
    tool: { name: 'dxlint', version: toolVersion },
    target,
    tier,
    grade: { letter: grade.letter, score: grade.score },
    coverage: grade.coverage,
    groups: grade.groups,
    results: scan.results.map((r) => {
      const entry = {
        ruleId: r.id,
        group: r.group,
        severity: r.severity,
        tier: r.tier,
        status: r.status,
      };
      if (r.reason !== undefined) entry.reason = r.reason;
      if (r.error !== undefined) entry.error = r.error;
      return entry;
    }),
    findings: scan.findings,
    ruleErrors: scan.ruleErrors,
  };
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2) + '\n';
}

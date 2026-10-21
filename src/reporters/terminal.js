// Terminal reporter: findings grouped by severity, then the newcomer
// narrative, the grade + coverage, and the `dxlint fix` hint (SPEC §6).
const ICONS = { error: '❌', warning: '⚠️ ', info: 'ℹ️ ' };
const HEADINGS = { error: 'ERRORS', warning: 'WARNINGS', info: 'INFO' };

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function narrative(findings) {
  const blockers = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const parts = [];
  if (blockers > 0) {
    parts.push(
      `a first-time contributor hits ${blockers === 1 ? '1 blocker' : `${blockers} blockers`}`,
    );
  }
  if (warnings > 0) {
    parts.push(
      blockers > 0
        ? `${plural(warnings, 'warning')} also needs attention`
        : `${plural(warnings, 'warning')} would trip up a newcomer`,
    );
  }
  if (parts.length === 0) return 'a first-time contributor hits no blockers in the checked rules';
  return parts.join('; ');
}

function fixHint(report) {
  const fixable = report.findings.filter((f) => f.fixable);
  if (fixable.length === 0) return null;
  return (
    `→ dxlint fix can create ${plural(fixable.length, 'missing file')}. ` +
    'Preview with `dxlint fix` · apply with `dxlint fix --apply`.'
  );
}

function findingBlock(f, out) {
  out.push(`  ${ICONS[f.severity]} ${f.ruleId} — ${f.message}`);
  if (f.evidence) out.push(`      evidence: ${f.evidence}`);
  out.push(`      fix:      ${f.remediation}`);
  if (f.location?.path) {
    out.push(`      at:       ${f.location.path}${f.location.line ? `:${f.location.line}` : ''}`);
  }
}

export function renderTerminal(report) {
  const out = [];
  out.push(`dxlint v${report.tool.version} · ${report.target} · tier ${report.tier}`);
  out.push('');

  for (const severity of ['error', 'warning', 'info']) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    out.push(`${HEADINGS[severity]} (${group.length})`);
    for (const f of group) findingBlock(f, out);
    out.push('');
  }

  const notEvaluated = report.results.filter((r) => r.status === 'skipped');
  if (notEvaluated.length > 0) {
    out.push(`NOT EVALUATED (${notEvaluated.length})`);
    for (const r of notEvaluated) out.push(`  · ${r.ruleId} — ${r.reason}`);
    out.push('');
  }

  if (report.ruleErrors.length > 0) {
    out.push(`RULE ERRORS (${report.ruleErrors.length})`);
    for (const e of report.ruleErrors) {
      out.push(`  ! ${e.ruleId} — ${e.error}`);
      out.push('      this rule did not run; the scan continued and its results are excluded from the grade.');
    }
    out.push('');
  }

  const passed = report.results.filter((r) => r.status === 'pass');
  if (passed.length > 0) {
    out.push(`PASSING (${passed.length}): ${passed.map((r) => r.ruleId).join(', ')}`);
    out.push('');
  }

  const { letter, score } = report.grade;
  const cov = report.coverage;
  out.push(`Grade: ${letter} (${score}) — ${cov.evaluated}/${cov.total} rules evaluated (${cov.percent}%)`);
  out.push('');
  const n = narrative(report.findings);
  out.push(`${n.charAt(0).toUpperCase()}${n.slice(1)}.`);
  const hint = fixHint(report);
  if (hint) out.push(hint);

  return out.join('\n') + '\n';
}

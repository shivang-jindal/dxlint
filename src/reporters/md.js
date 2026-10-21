// Markdown reporter — for PR bodies and discussion posts (SPEC §6).
const SEV_LABEL = { error: 'Errors', warning: 'Warnings', info: 'Info' };

function esc(cell) {
  return String(cell ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderMarkdown(report) {
  const out = [];
  const { letter, score } = report.grade;
  const cov = report.coverage;
  out.push(`# dxlint report — \`${report.target}\``);
  out.push('');
  out.push(`**Grade: ${letter}** (${score}/100) — ${cov.evaluated}/${cov.total} rules evaluated (${cov.percent}%)`);
  out.push('');

  if (report.findings.length === 0) {
    out.push('No findings — every evaluated rule passed.');
    out.push('');
  } else {
    for (const sev of ['error', 'warning', 'info']) {
      const group = report.findings.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      out.push(`## ${SEV_LABEL[sev]} (${group.length})`);
      out.push('');
      out.push('| Rule | Finding | Evidence | Location | Fixable |');
      out.push('|------|---------|----------|----------|---------|');
      for (const f of group) {
        out.push(
          `| \`${f.ruleId}\` | ${esc(f.message)} | ${esc(f.evidence ?? '—')} | \`${esc(f.location?.path ?? '—')}\` | ${f.fixable ? 'yes' : 'no'} |`,
        );
      }
      out.push('');
      out.push('Remediation:');
      for (const f of group) out.push(`- \`${f.ruleId}\`: ${f.remediation}`);
      out.push('');
    }
  }

  const notEvaluated = report.results.filter((r) => r.status === 'skipped');
  if (notEvaluated.length > 0) {
    out.push('## Not evaluated');
    out.push('');
    for (const r of notEvaluated) out.push(`- \`${r.ruleId}\` — ${r.reason}`);
    out.push('');
  }

  if (report.ruleErrors.length > 0) {
    out.push('## Rule errors');
    out.push('');
    for (const e of report.ruleErrors) {
      out.push(`- \`${e.ruleId}\` — ${e.error} (excluded from the grade)`);
    }
    out.push('');
  }

  out.push('## Grade detail');
  out.push('');
  out.push('| Group | Weight | Score | Rules evaluated |');
  out.push('|-------|--------|-------|-----------------|');
  for (const g of report.groups) {
    out.push(
      `| ${g.id} | ${g.weight} | ${g.score === null ? 'n/a' : g.score} | ${g.evaluated}/${g.total} |`,
    );
  }
  out.push('');

  out.push('## Rule results');
  out.push('');
  out.push('| Rule | Status | Severity |');
  out.push('|------|--------|----------|');
  for (const r of report.results) {
    out.push(`| \`${r.ruleId}\` | ${r.status} | ${r.severity} |`);
  }
  out.push('');

  const fixable = report.findings.filter((f) => f.fixable).length;
  if (fixable > 0) {
    out.push(`> ${fixable} finding(s) can be created automatically — run \`dxlint fix --apply\`.`);
    out.push('');
  }
  return out.join('\n');
}

// GitHub Actions reporter — workflow commands for job annotations.
// https://docs.github.com/actions/writing-workflows/workflow-commands-for-github-actions
// Escaping per GH rules: % → %25, \r → %0D, \n → %0A (message data);
// properties additionally escape : → %3A and , → %2C so the command
// syntax itself can never be broken by a path or rule id.

export function escapeData(text) {
  return String(text ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(text) {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Render a lint report as GitHub Actions workflow commands: one
 * `::error file=…,line=…,col=…,title=<ruleId>::<message>` line per finding
 * (v0 findings without an explicit line/col annotate the file at 1:1), then
 * a final `::notice::dxlint: <grade> grade, <N> findings` summary.
 */
export function renderGithub(report) {
  const lines = [];
  for (const f of report.findings) {
    const file = f.location?.path ?? report.target;
    const line = Number.isFinite(f.location?.line) ? f.location.line : 1;
    const col = Number.isFinite(f.location?.col) ? f.location.col : 1;
    lines.push(
      `::error file=${escapeProperty(file)},line=${line},col=${col},title=${escapeProperty(f.ruleId)}::${escapeData(f.message)}`
    );
  }
  lines.push(`::notice::dxlint: ${report.grade.letter} grade, ${report.findings.length} findings`);
  return `${lines.join('\n')}\n`;
}

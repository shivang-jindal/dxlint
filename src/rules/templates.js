// community/templates — ≥1 issue template + a pull request template.
export const ISSUE_TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';
const ISSUE_CANDIDATES = [ISSUE_TEMPLATE_DIR, '.github/ISSUE_TEMPLATE.md', 'ISSUE_TEMPLATE.md'];
const PR_CANDIDATES = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  '.github/PULL_REQUEST_TEMPLATE/pull_request_template.md',
];

function issueTemplateExists(ctx) {
  const dir = ISSUE_TEMPLATE_DIR;
  if (ctx.fs.isDirectory(dir)) {
    const files = ctx.fs.list(dir).filter((f) => /\.(md|yml|yaml)$/i.test(f));
    if (files.length > 0) return true;
  }
  return ISSUE_CANDIDATES.slice(1).some((p) => ctx.fs.exists(p));
}

export const templatesRule = {
  id: 'community/templates',
  title: 'Issue template and pull request template exist',
  severity: 'error',
  tier: 'cheap',
  fixable: 'generate',
  docs: `Why: without templates, a newcomer has to guess what a good issue or PR
looks like — and guessing wrong is embarrassing, so many never open one.

What dxlint checks:
  1. At least one issue template: .github/ISSUE_TEMPLATE/ containing a
     .md/.yml/.yaml form, or a legacy ISSUE_TEMPLATE.md.
  2. A pull request template (PULL_REQUEST_TEMPLATE.md in .github/, root,
     or docs/).

Pass example:
  .github/ISSUE_TEMPLATE/bug_report.yml
  .github/PULL_REQUEST_TEMPLATE.md

Fixable: \`dxlint fix --apply\` generates only the missing side — a bug-report
issue template and/or a PR template checklist. Existing templates are never
touched.`,
  evaluate(ctx) {
    const findings = [];
    if (!issueTemplateExists(ctx)) {
      findings.push({
        severity: 'error',
        message: 'This repository has no issue template, so bug reports arrive unstructured',
        evidence: `looked for ${ISSUE_CANDIDATES.join(', ')} (directory needs ≥1 .md/.yml file)`,
        remediation: 'Add .github/ISSUE_TEMPLATE/ with at least one template (bug report is enough).',
        location: { path: `${ISSUE_TEMPLATE_DIR}/` },
        fixable: true,
      });
    }
    const prPath = PR_CANDIDATES.find((p) => ctx.fs.exists(p));
    if (!prPath) {
      findings.push({
        severity: 'error',
        message: 'This repository has no pull request template',
        evidence: `looked for ${PR_CANDIDATES.join(', ')}`,
        remediation: 'Add .github/PULL_REQUEST_TEMPLATE.md with a short checklist (tests, docs, issue link).',
        location: { path: '.github/PULL_REQUEST_TEMPLATE.md' },
        fixable: true,
      });
    }
    return findings;
  },
  fix(ctx, finding) {
    const loc = finding?.location?.path ?? '';
    if (loc.startsWith(ISSUE_TEMPLATE_DIR)) {
      return {
        path: `${ISSUE_TEMPLATE_DIR}/bug_report.md`,
        content: `---
name: Bug report
about: Something isn't working as documented
title: ''
labels: bug
assignees: ''
---

**Describe the bug**
A clear description of what went wrong.

**To reproduce**
Steps and the exact command you ran.

**Expected behaviour**
What you expected to happen.

**Environment**
OS, runtime/toolchain version, dxlint version (if relevant).
`,
      };
    }
    return {
      path: '.github/PULL_REQUEST_TEMPLATE.md',
      content: `## What does this PR do?

<!-- One or two sentences; link the issue if there is one. -->

## Checklist

- [ ] Tests added or updated
- [ ] Documentation updated
- [ ] \`npm test\` (or the project's test command) passes locally
`,
    };
  },
};

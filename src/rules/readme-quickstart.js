// docs/readme-quickstart — README has install + usage snippets in fences.
import { codeFences, firstExisting } from './util.js';

const README_CANDIDATES = ['README.md', 'README.rst', 'README.markdown', 'README.txt', 'README'];

const INSTALL_RE =
  /\b(npm (install|i|add)\b|yarn add\b|pnpm (add|install)\b|bun (add|install)\b|pip3? install\b|pipx install\b|uv (pip )?install\b|poetry add\b|cargo (install|add)\b|go (install|get)\b|gem install\b|bundle install\b|composer require\b|brew (install|cask)\b|apt(-get)? install\b|dnf install\b|docker (pull|run)\b|make install\b|curl\b[^\n]*\|\s*(sh|bash))/i;

const USAGE_HEADING_RE = /^#{1,6}\s*(usage|quick ?start|getting started|examples?|in (action|use)|how to use)\b/im;
const SHELL_PROMPT_RE = /^\s*[$#]\s+\S+/m;

export function classifyFences(text) {
  const fences = codeFences(text);
  let hasInstall = false;
  let hasUsage = false;
  const headingMatch = USAGE_HEADING_RE.test(text);
  for (const { body } of fences) {
    if (INSTALL_RE.test(body)) hasInstall = true;
    if (SHELL_PROMPT_RE.test(body)) hasUsage = true;
  }
  // A Usage/Quickstart heading followed by any command fence counts as usage.
  if (!hasUsage && headingMatch) {
    hasUsage = fences.some((f) => /^\s*\S[\w.:/-]*(\s|$)/m.test(f.body));
  }
  return { hasInstall, hasUsage, fenceCount: fences.length };
}

export const readmeQuickstartRule = {
  id: 'docs/readme-quickstart',
  title: 'README contains install and usage snippets',
  severity: 'error',
  tier: 'cheap',
  fixable: false,
  docs: `Why: the README quickstart is the literal first five minutes of a
contributor's evening. If it doesn't say how to install and how to run the
thing, they close the tab.

What dxlint checks (presence only in v0; execution via snipci lands in v1):
  1. A README exists at the repository root.
  2. Some fenced code block contains an install command
     (\`npm i …\`, \`pip install …\`, \`cargo install …\`, \`go get …\`, etc.).
  3. A fenced block shows usage — a shell prompt line (\`$ dxlint ./repo\`) or
     a fence under a Usage / Quickstart / Getting Started heading.

Pass example:
  ## Install
  \`\`\`bash
  npm install dxlint
  \`\`\`
  ## Usage
  \`\`\`bash
  $ dxlint ./myrepo
  \`\`\`

Fail example:
  A prose-only README with no fenced commands → two findings (install, usage).

Not auto-fixable: inventing usage prose for your project would be an
opinionated rewrite — dxlint reports it instead.`,
  evaluate(ctx) {
    const path = firstExisting(ctx, README_CANDIDATES);
    if (!path) {
      return [
        {
          severity: 'error',
          message: 'This repository has no README, so visitors cannot learn what it does',
          evidence: `looked for ${README_CANDIDATES.join(', ')}`,
          remediation: 'Add README.md with a one-line description, an install snippet, and a usage snippet.',
          location: { path: 'README.md' },
          fixable: false,
        },
      ];
    }
    const text = ctx.fs.readFile(path) ?? '';
    const { hasInstall, hasUsage, fenceCount } = classifyFences(text);
    const findings = [];
    if (!hasInstall) {
      findings.push({
        severity: 'error',
        message: 'The README shows no way to install or depend on this project',
        evidence: `${path} has ${fenceCount} code fence(s), none containing an install command`,
        remediation: 'Add a fenced install snippet (e.g. `npm install your-package`) under an Install heading.',
        location: { path },
        fixable: false,
      });
    }
    if (!hasUsage) {
      findings.push({
        severity: 'error',
        message: 'The README never shows the tool being used',
        evidence: `${path} has no usage fence (no shell prompt line and no fence under a Usage heading)`,
        remediation: 'Add a fenced usage snippet, e.g. `$ your-command --help`, under a Usage heading.',
        location: { path },
        fixable: false,
      });
    }
    return findings;
  },
};

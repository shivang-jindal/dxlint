// community/codeowners — CODEOWNERS covers ≥80% of top-level paths.
const CANDIDATES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
const MIN_COVERAGE = 0.8;

function parsePatterns(text) {
  const patterns = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pattern = line.split(/\s+/)[0];
    if (pattern) patterns.push(pattern.replace(/^\\?#/, '#'));
  }
  return patterns;
}

function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(out + '$');
}

function normalizePattern(pattern) {
  let p = pattern.replace(/^\//, '');
  if (p.endsWith('/**')) p = p.slice(0, -3);
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Does a CODEOWNERS pattern claim this top-level path? */
export function patternCoversTopLevel(pattern, topPath) {
  const raw = pattern.replace(/^\//, '');
  if (raw === '*' || raw === '**') return true;
  const p = normalizePattern(pattern);
  if (!p) return false;
  if (globToRegExp(p).test(topPath)) return true;
  if (raw === topPath || raw.startsWith(`${topPath}/`)) return true;
  return false;
}

export const codeownersRule = {
  id: 'community/codeowners',
  title: 'CODEOWNERS covers most top-level paths',
  severity: 'warning',
  tier: 'cheap',
  fixable: false,
  docs: `Why: CODEOWNERS is how a first-time PR gets routed to a human who cares.
Without coverage, PRs sit unreviewed — the number-one complaint in the
"nobody reviews my PR" graveyard.

What dxlint checks: a CODEOWNERS file exists (.github/, root, or docs/) and
its patterns claim at least 80% of the repository's top-level paths (dirs and
files, ignoring .git and node_modules). A pattern covers a top-level path when
it matches it, is rooted under it (e.g. \`src/\` covers \`src\`), or is \`*\`.

Pass example (6 of 7 top-level paths covered → 86%):
  /src/         @alice
  docs/         @bob
  package.json  @carol

Fail example:
  /src/ @alice           (covers 2 of 5 paths → 40%)
  /docs/ @bob

Not auto-fixable: only the maintainers know who should own each path, so
dxlint reports the gap instead of inventing owners.`,
  evaluate(ctx) {
    const path = CANDIDATES.find((p) => ctx.fs.exists(p));
    if (!path) {
      return [
        {
          severity: 'warning',
          message: 'No CODEOWNERS file, so new pull requests may get no reviewer',
          evidence: `looked for ${CANDIDATES.join(', ')}`,
          remediation:
            'Add .github/CODEOWNERS assigning owners for your most active paths (or "*" for the core team).',
          location: { path: '.github/CODEOWNERS' },
          fixable: false,
        },
      ];
    }
    // The CODEOWNERS file itself is not counted — requiring it to own itself
    // is a paradox, not a newcomer signal.
    const topPaths = ctx.fs
      .list('.')
      .filter((name) => name !== '.git' && name !== 'node_modules' && name !== path);
    if (topPaths.length === 0) {
      return { skip: 'repository has no top-level paths to cover' };
    }
    const patterns = parsePatterns(ctx.fs.readFile(path) ?? '');
    const covered = topPaths.filter((tp) => patterns.some((pat) => patternCoversTopLevel(pat, tp)));
    const ratio = covered.length / topPaths.length;
    if (ratio >= MIN_COVERAGE) return [];
    const percent = Math.round(ratio * 100);
    return [
      {
        severity: 'warning',
        message: `CODEOWNERS only covers ${covered.length} of ${topPaths.length} top-level paths`,
        evidence: `${path} covers ${covered.length}/${topPaths.length} top-level paths (${percent}%, need ≥ 80%); uncovered: ${topPaths
          .filter((tp) => !covered.includes(tp))
          .join(', ')}`,
        remediation: `Extend ${path} so at least 80% of top-level paths (here, ${Math.ceil(0.8 * topPaths.length)} of ${topPaths.length}) have owners.`,
        location: { path },
        fixable: false,
      },
    ];
  },
};

// build/test-command — a single documented command runs the tests.
import { codeFences, firstExisting, parseJson } from './util.js';

const README_CANDIDATES = ['README.md', 'README.rst', 'README.txt', 'README'];
const DOC_COMMAND_RE =
  /(^|\n)\s*(?:[$#]\s*)?(?:npm (?:run )?test|yarn test|pnpm test|bun test|make test|make check|cargo test|go test|pytest|tox -p|deno test)\b/;

export const testCommandRule = {
  id: 'build/test-command',
  title: 'One documented command runs the test suite',
  severity: 'error',
  tier: 'cheap',
  fixable: false,
  docs: `Why: "clone it and make sure it works" is step one for every contributor.
If there is no single command that runs the tests — and nobody documents what
it is — contributors can't verify their own change and CI becomes the only
feedback loop (after a 47-minute wait).

What dxlint checks (any one suffices):
  1. package.json declares a non-empty \`scripts.test\`.
  2. A Makefile has a \`test:\` (or \`check:\`) target.
  3. The README documents a test command in a fence or line:
     \`npm test\`, \`make test\`, \`cargo test\`, \`go test\`, \`pytest\`, …

Pass example:
  package.json → "scripts": { "test": "node --test test/" }

Fail example:
  package.json with no "test" script, no Makefile, README silent about tests
  → "Contributors cannot verify their own changes locally"

Not auto-fixable: wiring up a real test runner is a project decision.`,
  evaluate(ctx) {
    const evidence = [];

    if (ctx.fs.exists('package.json')) {
      const text = ctx.fs.readFile('package.json');
      const { value } = parseJson(text ?? '');
      const script = value?.scripts?.test;
      if (typeof script === 'string' && script.trim()) {
        return [];
      }
      evidence.push('package.json has no scripts.test');
    } else {
      evidence.push('no package.json');
    }

    const makefilePath = firstExisting(ctx, ['Makefile', 'makefile', 'GNUmakefile']);
    if (makefilePath) {
      const mk = ctx.fs.readFile(makefilePath) ?? '';
      if (/^\s*(?:test|check)\s*::?/m.test(mk)) return [];
      evidence.push(`${makefilePath} has no test/check target`);
    } else {
      evidence.push('no Makefile');
    }

    const readmePath = firstExisting(ctx, README_CANDIDATES);
    const readme = readmePath ? ctx.fs.readFile(readmePath) : null;
    if (readme && DOC_COMMAND_RE.test(readme)) return [];
    if (readme) evidence.push(`${readmePath} documents no test command`);
    else evidence.push('no README documenting a test command');

    return [
      {
        severity: 'error',
        message: 'There is no single command a newcomer can run to test this project',
        evidence: evidence.join('; '),
        remediation:
          'Add a "test" script to package.json (or a Makefile test target) and document it in the README.',
        location: { path: 'package.json' },
        fixable: false,
      },
    ];
  },
};

// Exported for tests that want the fence scanner without re-implementing it.
export { codeFences };

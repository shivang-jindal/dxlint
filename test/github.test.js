// --format github: GitHub Actions workflow-command annotations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.js';
import { renderGithub } from '../src/reporters/github.js';
import { stageFixture, makeRepo, testClock, makeContext } from './helpers.js';

function io() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    deps: {
      clock: testClock,
      makeContext: (root) => makeContext(root),
      stdout: {
        write: (s) => {
          out.stdout += s;
        },
      },
      stderr: {
        write: (s) => {
          out.stderr += s;
        },
      },
    },
  };
}

test('--format github emits one annotation per finding plus the grade notice', async (t) => {
  const repo = makeRepo(
    t,
    { 'README.md': '# Prose only\n\nThis README has no fenced commands at all.\n' },
    { name: 'gh-format' },
  );
  const env = io();
  const code = await main(['--rules', 'docs/readme-quickstart', '--format', 'github', repo], env.deps);
  assert.equal(code, 1, env.out.stderr); // two error findings, fail-on default error
  assert.equal(
    env.out.stdout,
    '::error file=README.md,line=1,col=1,title=docs/readme-quickstart::' +
      'The README shows no way to install or depend on this project\n' +
      '::error file=README.md,line=1,col=1,title=docs/readme-quickstart::' +
      'The README never shows the tool being used\n' +
      '::notice::dxlint: F grade, 2 findings\n',
  );
});

test('github format escapes %, CR and LF in messages and properties', () => {
  const report = {
    target: '.',
    grade: { letter: 'B', score: 70 },
    findings: [
      {
        ruleId: 'docs/readme-quickstart',
        severity: 'error',
        message: '50% of installs fail\nsecond line\rthird line',
        location: { path: 'docs/100%,a.md', line: 42, col: 7 },
      },
      {
        // No location at all: falls back to the target, line 1, col 1.
        ruleId: 'community/license',
        severity: 'error',
        message: 'no license',
      },
    ],
  };
  assert.equal(
    renderGithub(report),
    '::error file=docs/100%25%2Ca.md,line=42,col=7,title=docs/readme-quickstart::' +
      '50%25 of installs fail%0Asecond line%0Dthird line\n' +
      '::error file=.,line=1,col=1,title=community/license::no license\n' +
      '::notice::dxlint: B grade, 2 findings\n',
  );

  // Zero findings is still a valid report: just the summary line.
  assert.equal(
    renderGithub({ target: '.', grade: { letter: 'A', score: 100 }, findings: [] }),
    '::notice::dxlint: A grade, 0 findings\n',
  );
});

test('github annotations for a fixture repo match the JSON findings exactly', async (t) => {
  const repo = stageFixture(t, 'golden/mixed');

  const jsonRun = io();
  assert.equal(await main([repo, '--format', 'json'], jsonRun.deps), 1, jsonRun.out.stderr);
  const report = JSON.parse(jsonRun.out.stdout);
  assert.ok(report.findings.length > 0, 'mixed fixture must have findings');

  const ghRun = io();
  assert.equal(await main([repo, '--format', 'github'], ghRun.deps), 1, ghRun.out.stderr);
  const lines = ghRun.out.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, report.findings.length + 1);
  report.findings.forEach((f, i) => {
    const file = f.location?.path ?? report.target;
    const line = Number.isFinite(f.location?.line) ? f.location.line : 1;
    const col = Number.isFinite(f.location?.col) ? f.location.col : 1;
    assert.equal(lines[i], `::error file=${file},line=${line},col=${col},title=${f.ruleId}::${f.message}`);
  });
  assert.equal(
    lines[lines.length - 1],
    `::notice::dxlint: ${report.grade.letter} grade, ${report.findings.length} findings`,
  );
});

test('default format output is unchanged (byte-identical to --format terminal)', async (t) => {
  const repo = stageFixture(t, 'golden/mixed');

  const defaultRun = io();
  const defaultCode = await main([repo], defaultRun.deps);
  const terminalRun = io();
  const terminalCode = await main([repo, '--format', 'terminal'], terminalRun.deps);

  assert.equal(defaultCode, terminalCode);
  assert.equal(defaultRun.out.stdout, terminalRun.out.stdout);
  assert.doesNotMatch(defaultRun.out.stdout, /^::/m, 'default output stays free of workflow commands');
});

// CLI end-to-end tests: real process spawns, exit codes (0/1/2), help/version,
// reporters, explain/rules/badge subcommands.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageFixture, FIXTURES_DIR } from './helpers.js';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(BASE, 'src', 'cli.js');
const ALL_PASS = path.join(FIXTURES_DIR, 'golden', 'all-pass');
const MIXED = path.join(FIXTURES_DIR, 'golden', 'mixed');

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: BASE,
    ...opts,
  });
  assert.equal(res.error, undefined, `spawn failed: ${res.error}`);
  return res;
}

describe('cli basics', () => {
  test('--help exits 0 and prints usage', () => {
    const res = run(['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage:/);
    assert.match(res.stdout, /dxlint explain <rule-id>/);
    assert.equal(res.stderr, '');
  });

  test('lint --help and -h also exit 0', () => {
    assert.equal(run(['lint', '--help']).status, 0);
    assert.equal(run(['-h']).status, 0);
  });

  test('--version prints the package version and exits 0', () => {
    const res = run(['--version']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^dxlint \d+\.\d+\.\d+\n$/);
    const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'dxlint');
    assert.equal(pkg.version, '0.1.0');
  });

  test('unknown option → exit 2', () => {
    const res = run(['--definitely-not-a-flag']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown option/);
    assert.match(res.stderr, /--help/);
  });

  test('invalid --format / --fail-on / path → exit 2', () => {
    assert.equal(run(['lint', MIXED, '--format', 'yaml']).status, 2);
    assert.equal(run(['lint', MIXED, '--fail-on', 'fatal']).status, 2);
    assert.equal(run(['lint', path.join(BASE, 'no-such-dir-xyz')]).status, 2);
    assert.equal(run(['lint', MIXED, '--tier', 'quantum']).status, 2);
  });

  test("'init' is a known-but-unimplemented command, exit 2", () => {
    const res = run(['init']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /not implemented in v0/);
  });
});

describe('lint exits and output', () => {
  test('all-pass fixture → exit 0, graded terminal output', () => {
    const res = run(['lint', ALL_PASS]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /Grade: A\+ \(100\) — 10\/12 rules evaluated \(83\.3%\)/);
    assert.match(res.stdout, /first-time contributor hits no blockers/);
    assert.match(res.stdout, /PASSING \(10\)/);
    assert.match(res.stdout, /NOT EVALUATED \(2\)/);
    assert.ok(!res.stdout.includes('dxlint fix can create'), 'no fix hint when nothing is fixable');
  });

  test('mixed fixture → exit 1 (error ≥ fail-on default), narrative + fix hint', () => {
    const res = run(['lint', MIXED]);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /Grade: A- \(91\.42\) — 10\/12 rules evaluated/);
    assert.match(res.stdout, /ERRORS \(1\)/);
    assert.ok(!res.stdout.includes('WARNINGS'), 'empty severity sections are omitted');
    assert.match(res.stdout, /A first-time contributor hits 1 blocker/);
    assert.match(res.stdout, /dxlint fix can create 1 missing file/);
    assert.match(res.stdout, /`dxlint fix`/);
  });

  test('--fail-on none / warning / info adjust the exit code', () => {
    assert.equal(run(['lint', MIXED, '--fail-on', 'none']).status, 0);
    assert.equal(run(['lint', MIXED, '--fail-on', 'warning']).status, 1);
    assert.equal(run(['lint', MIXED, '--fail-on', 'info']).status, 1);
    assert.equal(run(['lint', MIXED, '--strict']).status, 1);
    assert.equal(run(['lint', ALL_PASS, '--strict']).status, 0);
  });

  test('--format json emits the stable schema; two runs are identical', () => {
    const a = run(['lint', MIXED, '--format', 'json']);
    const b = run(['lint', MIXED, '--format', 'json']);
    assert.equal(a.status, 1);
    assert.equal(a.stdout, b.stdout, 'two CLI runs must produce identical JSON');
    const parsed = JSON.parse(a.stdout);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.grade.letter, 'A-');
    assert.equal(parsed.grade.score, 91.42);
    assert.deepEqual(parsed.coverage, { evaluated: 10, total: 12, percent: 83.3 });
    assert.equal(parsed.findings.length, 2);
    assert.equal(parsed.ruleErrors.length, 0);
  });

  test('--format md renders a markdown report', () => {
    const res = run(['lint', MIXED, '--format', 'md']);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /^# dxlint report/m);
    assert.match(res.stdout, /\*\*Grade: A-\*\*/);
    assert.match(res.stdout, /^\| Rule \| Finding \|/m);
    assert.match(res.stdout, /## Not evaluated/);
  });

  test('--output writes the report file and confirms it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxlint-cli-out-'));
    try {
      const outFile = path.join(dir, 'report.json');
      const res = run(['lint', MIXED, '--format', 'json', '--output', outFile]);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /report written to/);
      const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.equal(parsed.grade.letter, 'A-');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('explain / rules / badge', () => {
  test('explain <rule-id> prints docs with rationale and examples', () => {
    const res = run(['explain', 'community/license']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^community\/license — /);
    assert.match(res.stdout, /severity: error/);
    assert.match(res.stdout, /fixable: generate/);
    assert.match(res.stdout, /Why:/);
    assert.match(res.stdout, /Pass example/);
    assert.match(res.stdout, /Fixable: `dxlint fix --apply`/);
  });

  test('explain of a deferred rule says deferred to v1', () => {
    const res = run(['explain', 'build/fresh-clone']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /status: deferred to v1/);
    assert.match(res.stdout, /v0 status: \*\*deferred\.\*\*/);
  });

  test('explain with missing/unknown id → exit 2', () => {
    assert.equal(run(['explain']).status, 2);
    const res = run(['explain', 'community/licence']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown rule/);
  });

  test('rules --format json emits the full catalog', () => {
    const res = run(['rules', '--format', 'json']);
    assert.equal(res.status, 0);
    const catalog = JSON.parse(res.stdout);
    assert.equal(catalog.length, 12);
    assert.equal(catalog.filter((r) => r.tier === 'cheap').length, 10);
    assert.equal(catalog.filter((r) => r.deferred).length, 2);
    const ids = catalog.map((r) => r.id);
    assert.ok(ids.includes('community/license'));
    assert.ok(ids.includes('docs/changelog'));
    assert.ok(ids.includes('build/lockfile'));
    for (const r of catalog) {
      assert.ok(r.title && r.docs && r.group && r.severity, `catalog entry incomplete: ${r.id}`);
    }
  });

  test('rules (text) prints a table and count', () => {
    const res = run(['rules']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /community\/license/);
    assert.match(res.stdout, /12 rules · 10 cheap \(v0\)/);
  });

  test('badge writes Shields JSON for an existing report', (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const res = run(['badge', root]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const badgePath = path.join(root, 'dxlint-badge.json');
    const badge = JSON.parse(fs.readFileSync(badgePath, 'utf8'));
    assert.deepEqual(badge, {
      schemaVersion: 1,
      label: 'dxlint',
      message: 'A+',
      color: 'brightgreen',
    });
  });

  test('badge --out writes to the requested path', (t) => {
    const root = stageFixture(t, 'golden/mixed');
    const out = path.join(root, 'custom-badge.json');
    const res = run(['badge', root, '--out', out]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const badge = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(badge.message, 'A-');
    assert.equal(badge.color, 'green');
  });
});

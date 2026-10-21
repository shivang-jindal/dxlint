// `dxlint fix` tests: dry-run writes nothing; --apply creates only missing
// files; second run is a no-op (idempotence property); existing prose is
// never edited (SPEC §1.3, §7.3, §11.3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { stageFixture, makeRepo, scanAll, makeContext } from './helpers.js';
import { planFixes, applyFixes } from '../src/fix.js';
import { main } from '../src/cli.js';

function snapshotDir(root) {
  const snap = new Map();
  const walk = (rel) => {
    const abs = path.join(root, rel);
    for (const name of fs.readdirSync(abs).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const stat = fs.statSync(path.join(root, r));
      if (stat.isDirectory()) walk(r);
      else snap.set(r, { content: fs.readFileSync(path.join(root, r), 'utf8'), mtimeMs: stat.mtimeMs });
    }
  };
  walk('');
  return snap;
}

function collector() {
  const chunks = [];
  return {
    write: (s) => chunks.push(s),
    get text() {
      return chunks.join('');
    },
  };
}

async function fix(args, root) {
  const stdout = collector();
  const stderr = collector();
  const code = await main(['fix', root, ...args], { stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

const EXPECTED_PLAN = [
  'LICENSE',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

describe('dxlint fix', () => {
  test('dry-run (default) previews every file and writes nothing', async (t) => {
    const root = stageFixture(t, 'fixable');
    const before = snapshotDir(root);

    const { code, stdout } = await fix([], root);
    assert.equal(code, 0);
    assert.match(stdout, /dry run — would create 5 files/);
    for (const p of EXPECTED_PLAN) assert.ok(stdout.includes(`+ ${p}`), `preview missing ${p}`);
    assert.match(stdout, /No files were written/);
    // Content previews are actually shown.
    assert.match(stdout, /SPDX-License-Identifier/);
    assert.match(stdout, /security\/advisories/);

    assert.deepEqual(snapshotDir(root), before, 'dry run must not touch the tree');
  });

  test('explicit --dry-run also writes nothing', async (t) => {
    const root = stageFixture(t, 'fixable');
    const before = snapshotDir(root);
    const { code, stdout } = await fix(['--dry-run'], root);
    assert.equal(code, 0);
    assert.match(stdout, /would create 5 files/);
    assert.deepEqual(snapshotDir(root), before);
  });

  test('--apply creates exactly the missing files, nothing else', async (t) => {
    const root = stageFixture(t, 'fixable');
    const before = snapshotDir(root);

    const { code, stdout } = await fix(['--apply'], root);
    assert.equal(code, 0);
    assert.equal(stderrClean(stdout), true);
    assert.match(stdout, /created 5 files/);

    const after = snapshotDir(root);
    const created = [...after.keys()].filter((p) => !before.has(p));
    assert.deepEqual([...created].sort(), [...EXPECTED_PLAN].sort());

    // Existing files are byte-identical (never edited).
    for (const [p, entry] of before) {
      assert.equal(after.get(p).content, entry.content, `${p} must be untouched`);
    }

    // The generated content is sane.
    const license = after.get('LICENSE').content;
    assert.match(license, /SPDX-License-Identifier: MIT/, 'LICENSE stub carries the manifest SPDX');
    assert.match(license, /dxlint-generated stub/);
    const security = after.get('SECURITY.md').content;
    assert.match(security, /https?:\/\//, 'SECURITY.md stub includes a reporting URL');

    // …and the security rule now passes on the fixed tree.
    const scan = await scanAll(root);
    const securityResult = scan.results.find((r) => r.id === 'community/security');
    assert.equal(securityResult.status, 'pass');
    const licenseResult = scan.results.find((r) => r.id === 'community/license');
    assert.equal(licenseResult.status, 'pass');
  });

  test('idempotence: a second --apply is a no-op (property)', async (t) => {
    const root = stageFixture(t, 'fixable');
    await fix(['--apply'], root);
    const afterFirst = snapshotDir(root);

    const second = await fix(['--apply'], root);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /nothing to do/);
    assert.deepEqual(snapshotDir(root), afterFirst, 'second run must not create or rewrite anything');

    // Planning after the fix yields an empty plan too.
    const scan = await scanAll(root);
    const { plan, errors } = await planFixes({ scan, ctx: makeContext(root) });
    assert.deepEqual(plan, []);
    assert.deepEqual(errors, []);
  });

  test('idempotence property across synthetic repos', async (t) => {
    const scenarios = [
      { 'README.md': '# x\n' }, // missing everything fixable
      { 'CODE_OF_CONDUCT.md': '# CoC\n' }, // only coc exists
      { 'SECURITY.md': '# Security\nhttps://example.com/report\n' },
      { LICENSE: 'MIT License\nPermission is hereby granted, free of charge\n' },
      { 'package.json': '{\n  "license": "Apache-2.0"\n}\n' },
    ];
    for (const [i, files] of scenarios.entries()) {
      const root = makeRepo(t, files, { name: `idem-${i}` });
      const first = await fix(['--apply'], root);
      assert.equal(first.code, 0, `scenario ${i} first apply`);
      const snap = snapshotDir(root);
      const second = await fix(['--apply'], root);
      assert.equal(second.code, 0, `scenario ${i} second apply`);
      assert.match(second.stdout, /nothing to do/, `scenario ${i}`);
      assert.deepEqual(snapshotDir(root), snap, `scenario ${i}: second run changed the tree`);
    }
  });

  test('never edits an existing file that still has a finding', async (t) => {
    const root = makeRepo(t, {
      'SECURITY.md': 'Report things in the tracker somehow.\n', // exists but has no contact
      'README.md': '# x\n',
    });
    const before = snapshotDir(root);
    const { code } = await fix(['--apply'], root);
    assert.equal(code, 0);
    const after = snapshotDir(root);
    assert.equal(after.get('SECURITY.md').content, before.get('SECURITY.md').content);

    // The unfixable finding is still reported after fixing.
    const scan = await scanAll(root);
    const sec = scan.results.find((r) => r.id === 'community/security');
    assert.equal(sec.status, 'fail');
    assert.equal(sec.findings[0].fixable, false);
  });

  test('planFixes reports fix() crashes instead of throwing', async (t) => {
    const root = makeRepo(t, { 'README.md': '# x\n' });
    const scan = await scanAll(root);
    const brokenRule = {
      id: 'community/broken-fix',
      title: 'broken fix',
      severity: 'error',
      tier: 'cheap',
      fixable: 'generate',
      docs: 'fix() throws',
      evaluate: () => [],
      fix() {
        throw new Error('boom in fix');
      },
    };
    scan.results.push({
      rule: brokenRule,
      id: brokenRule.id,
      group: 'community',
      severity: 'error',
      tier: 'cheap',
      status: 'fail',
      findings: [
        { ruleId: brokenRule.id, severity: 'error', message: 'x', remediation: 'y', fixable: true },
      ],
    });
    const { plan, errors } = await planFixes({ scan, ctx: makeContext(root) });
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /boom in fix/);
    assert.ok(plan.length > 0, 'other fixes still planned');
  });

  test('applyFixes honors an injected writer (no direct fs use)', () => {
    const calls = [];
    const created = applyFixes('/nowhere', [{ path: 'a/b.md', content: 'hi' }], {
      writer: (root, rel, content) => calls.push([root, rel, content]),
    });
    assert.deepEqual(created, ['a/b.md']);
    assert.deepEqual(calls, [['/nowhere', 'a/b.md', 'hi']]);
  });
});

function stderrClean(stdoutText) {
  // Helper for readability in assertions above: fix output has no error lines.
  return !/failed/.test(stdoutText);
}

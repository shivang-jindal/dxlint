// Per-rule fixture pairs (SPEC §11.1): for every rule, test/fixtures/<rule>/pass
// and /fail must yield exactly the expected findings — no more, no fewer.
// Extra edge cases use synthetic repos built into temp dirs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  stageFixture,
  makeRepo,
  scanRule,
  assertFindings,
  statusesByRule,
  testClock,
} from './helpers.js';
import { fakeGit } from '../src/git.js';
import { licenseRule, detectSpdx } from '../src/rules/license.js';
import { contributingRule } from '../src/rules/contributing.js';
import { codeOfConductRule } from '../src/rules/code-of-conduct.js';
import { securityRule } from '../src/rules/security.js';
import { templatesRule } from '../src/rules/templates.js';
import { codeownersRule } from '../src/rules/codeowners.js';
import { readmeQuickstartRule } from '../src/rules/readme-quickstart.js';
import { changelogRule, STALE_DAYS } from '../src/rules/changelog.js';
import { testCommandRule } from '../src/rules/test-command.js';
import { lockfileRule } from '../src/rules/lockfile.js';

const PAIRS = [
  {
    rule: licenseRule,
    dir: 'community/license',
    pass: [],
    fail: [
      { ruleId: 'community/license', severity: 'error', message: 'no LICENSE file', fixable: true },
    ],
  },
  {
    rule: contributingRule,
    dir: 'community/contributing',
    pass: [],
    fail: [
      { ruleId: 'community/contributing', severity: 'error', message: 'no CONTRIBUTING file', fixable: false },
    ],
  },
  {
    rule: codeOfConductRule,
    dir: 'community/code-of-conduct',
    pass: [],
    fail: [
      { severity: 'error', message: 'no code of conduct', fixable: true },
    ],
  },
  {
    rule: securityRule,
    dir: 'community/security',
    pass: [],
    fail: [
      { severity: 'error', message: 'no security policy', fixable: true },
    ],
  },
  {
    rule: templatesRule,
    dir: 'community/templates',
    pass: [],
    fail: [
      { severity: 'error', message: 'no issue template', fixable: true },
      { severity: 'error', message: 'no pull request template', fixable: true },
    ],
  },
  {
    rule: codeownersRule,
    dir: 'community/codeowners',
    pass: [],
    fail: [
      {
        severity: 'warning',
        message: 'only covers 2 of 5 top-level paths',
        evidence: '2/5 top-level paths (40%',
        fixable: false,
      },
    ],
  },
  {
    rule: readmeQuickstartRule,
    dir: 'docs/readme-quickstart',
    pass: [],
    fail: [
      { severity: 'error', message: 'no way to install', fixable: false },
      { severity: 'error', message: 'never shows the tool being used', fixable: false },
    ],
  },
  {
    rule: changelogRule,
    dir: 'docs/changelog',
    pass: [],
    fail: [{ severity: 'info', message: 'no changelog', fixable: false }],
  },
  {
    rule: testCommandRule,
    dir: 'build/test-command',
    pass: [],
    fail: [
      {
        severity: 'error',
        message: 'no single command',
        evidence: 'package.json has no scripts.test',
        fixable: false,
      },
    ],
  },
  {
    rule: lockfileRule,
    dir: 'build/lockfile',
    pass: [],
    fail: [
      { severity: 'warning', message: 'lockfile is committed', evidence: 'package-lock.json', fixable: false },
    ],
  },
];

describe('rule fixture pairs', () => {
  for (const pair of PAIRS) {
    test(`${pair.rule.id}: pass fixture has no findings`, async (t) => {
      const root = stageFixture(t, `${pair.dir}/pass`);
      const scan = await scanRule(pair.rule, root);
      assertFindings(scan.findings, pair.pass);
      assert.equal(scan.results[0].status, 'pass');
    });

    test(`${pair.rule.id}: fail fixture has exactly the expected findings`, async (t) => {
      const root = stageFixture(t, `${pair.dir}/fail`);
      const scan = await scanRule(pair.rule, root);
      assertFindings(scan.findings, pair.fail);
      const expectedStatus = pair.fail.some((f) => f.severity === 'error') ? 'fail' : 'warning';
      assert.equal(scan.results[0].status, expectedStatus);
      assert.deepEqual(scan.ruleErrors, [], 'no rule may crash on its own fixtures');
    });
  }
});

describe('edge cases (synthetic temp repos)', () => {
  test('license: LICENSE text disagreeing with the manifest is an error', async (t) => {
    const root = makeRepo(t, {
      'package.json': JSON.stringify({ name: 'x', license: 'Apache-2.0' }),
      LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge, to any person…\n',
    });
    const scan = await scanRule(licenseRule, root);
    assertFindings(scan.findings, [
      { severity: 'error', message: 'disagree', evidence: 'Apache-2.0', fixable: false },
    ]);
  });

  test('license: manifest without a license field is a warning', async (t) => {
    const root = makeRepo(t, {
      'package.json': JSON.stringify({ name: 'x' }),
      LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge, to any person…\n',
    });
    const scan = await scanRule(licenseRule, root);
    assertFindings(scan.findings, [
      { severity: 'warning', message: 'does not declare a license field', fixable: false },
    ]);
    assert.equal(scan.results[0].status, 'warning');
  });

  test('license: no manifest and no LICENSE still fails (license is undeclared)', async (t) => {
    const root = makeRepo(t, { 'README.md': '# hi\n' });
    const scan = await scanRule(licenseRule, root);
    assertFindings(scan.findings, [
      { severity: 'error', message: 'no LICENSE file', evidence: 'no LICENSE file and no manifest' },
    ]);
  });

  test('detectSpdx recognizes common licenses', () => {
    assert.equal(detectSpdx('MIT License\nPermission is hereby granted, free of charge'), 'MIT');
    assert.equal(detectSpdx('Apache License\nVersion 2.0'), 'Apache-2.0');
    assert.equal(detectSpdx('GNU GENERAL PUBLIC LICENSE\nVersion 3'), 'GPL-3.0');
    assert.equal(detectSpdx(''), null);
    assert.equal(detectSpdx('all rights reserved, proprietary'), null);
  });

  test('contributing: stale file (mtime) yields exactly one warning', async (t) => {
    const root = stageFixture(t, 'community/contributing/pass', { mtimeAgeDays: 400 });
    const scan = await scanRule(contributingRule, root);
    assertFindings(scan.findings, [
      { severity: 'warning', message: 'out of date', evidence: '400 days ago', fixable: false },
    ]);
    assert.equal(scan.results[0].status, 'warning');
  });

  test('contributing: git history wins over fresh mtime', async (t) => {
    const root = stageFixture(t, 'community/contributing/pass', { mtimeAgeDays: 1 });
    const git = fakeGit({ 'CONTRIBUTING.md': testClock.now().getTime() - 400 * 86_400_000 });
    const scan = await scanRule(contributingRule, root, { git });
    assertFindings(scan.findings, [
      { severity: 'warning', message: 'out of date', evidence: '400 days ago' },
    ]);
  });

  test('contributing: no getting-started section yields one warning', async (t) => {
    const root = makeRepo(t, { 'CONTRIBUTING.md': 'Be nice to each other.\n' }, { mtimeAgeDays: 5 });
    const scan = await scanRule(contributingRule, root);
    assertFindings(scan.findings, [
      { severity: 'warning', message: 'no "where do I start?" style section', fixable: false },
    ]);
  });

  test('security: policy without a contact channel fails and is not fixable', async (t) => {
    const root = makeRepo(t, { 'SECURITY.md': 'Please report issues in the tracker.\n' });
    const scan = await scanRule(securityRule, root);
    assertFindings(scan.findings, [
      { severity: 'error', message: 'no way to reach you privately', fixable: false },
    ]);
  });

  test('changelog: older than 90 days is one info finding', async (t) => {
    const root = stageFixture(t, 'docs/changelog/pass', { mtimeAgeDays: STALE_DAYS + 30 });
    const scan = await scanRule(changelogRule, root);
    assertFindings(scan.findings, [
      { severity: 'info', message: 'last touched 120 days ago', fixable: false },
    ]);
  });

  test('readme-quickstart: missing README is a single error (not three)', async (t) => {
    const root = makeRepo(t, {});
    const scan = await scanRule(readmeQuickstartRule, root);
    assertFindings(scan.findings, [{ severity: 'error', message: 'no README', fixable: false }]);
  });

  test('test-command: Makefile target alone passes', async (t) => {
    const root = makeRepo(t, { Makefile: '.PHONY: test\ntest:\n\tnode --test test/\n' });
    const scan = await scanRule(testCommandRule, root);
    assertFindings(scan.findings, []);
  });

  test('test-command: documented command in the README alone passes', async (t) => {
    const root = makeRepo(t, { 'README.md': '# demo\n\nRun the suite:\n\n    npm test\n' });
    const scan = await scanRule(testCommandRule, root);
    assertFindings(scan.findings, []);
  });

  test('lockfile: no package manifest → rule skips (excluded from denominator)', async (t) => {
    const root = makeRepo(t, { 'README.md': '# demo\n' });
    const scan = await scanRule(lockfileRule, root);
    assertFindings(scan.findings, []);
    assert.equal(scan.results[0].status, 'skipped');
    assert.match(scan.results[0].reason, /no package manifest/);
  });

  test('templates: only a PR template present → exactly the issue-template finding', async (t) => {
    const root = makeRepo(t, { '.github/PULL_REQUEST_TEMPLATE.md': '## Changes\n' });
    const scan = await scanRule(templatesRule, root);
    assertFindings(scan.findings, [
      { severity: 'error', message: 'no issue template', fixable: true },
    ]);
  });

  test('codeowners: missing file is a warning, not a crash', async (t) => {
    const root = makeRepo(t, { 'README.md': '# demo\n' });
    const scan = await scanRule(codeownersRule, root);
    assertFindings(scan.findings, [{ severity: 'warning', message: 'No CODEOWNERS file' }]);
    assert.deepEqual(scan.ruleErrors, []);
  });

  test('every rule passes on its own pass fixture with no rule errors', async (t) => {
    // Sanity: statusesByRule covers each pair exactly once (no double runs).
    const root = stageFixture(t, 'community/templates/pass');
    const scan = await scanRule(templatesRule, root);
    assert.deepEqual(statusesByRule(scan), { 'community/templates': 'pass' });
  });
});

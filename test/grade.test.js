// Grade golden tests (SPEC §5): fixed fixtures → exact letter + coverage math,
// including the "some rules unavailable" denominator case.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stageFixture, scanAll, gradeOf } from './helpers.js';
import { computeGrade, letterFor, scoreForStatus, severityWeight } from '../src/grade.js';
import { parseRuleFilter } from '../src/engine.js';

function groupById(grade, id) {
  const g = grade.groups.find((x) => x.id === id);
  assert.ok(g, `group ${id} missing from grade`);
  return g;
}

describe('letter thresholds', () => {
  test('boundary table matches SPEC §5', () => {
    assert.equal(letterFor(97), 'A+');
    assert.equal(letterFor(96.99), 'A');
    assert.equal(letterFor(93), 'A');
    assert.equal(letterFor(92.99), 'A-');
    assert.equal(letterFor(90), 'A-');
    assert.equal(letterFor(89.99), 'B+');
    assert.equal(letterFor(86), 'B+');
    assert.equal(letterFor(85.99), 'B');
    assert.equal(letterFor(82), 'B');
    assert.equal(letterFor(81.99), 'B-');
    assert.equal(letterFor(78), 'B-');
    assert.equal(letterFor(77.99), 'C+');
    assert.equal(letterFor(74), 'C+');
    assert.equal(letterFor(73.99), 'C');
    assert.equal(letterFor(70), 'C');
    assert.equal(letterFor(69.99), 'C-');
    assert.equal(letterFor(66), 'C-');
    assert.equal(letterFor(65.99), 'D');
    assert.equal(letterFor(55), 'D');
    assert.equal(letterFor(54.99), 'F');
    assert.equal(letterFor(0), 'F');
  });

  test('per-rule scores and severity weights per SPEC', () => {
    assert.equal(scoreForStatus('pass'), 1);
    assert.equal(scoreForStatus('warning'), 0.5);
    assert.equal(scoreForStatus('fail'), 0);
    assert.equal(scoreForStatus('skipped'), null);
    assert.equal(scoreForStatus('error'), null);
    assert.equal(severityWeight('error'), 3);
    assert.equal(severityWeight('warning'), 2);
    assert.equal(severityWeight('info'), 1);
  });

  test('a single present group normalizes to a full score (weights renormalize)', () => {
    const results = [
      { group: 'docs', severity: 'error', status: 'pass', rule: { severity: 'error' } },
      { group: 'docs', severity: 'warning', status: 'fail', rule: { severity: 'warning' } },
    ];
    // docs: pass(error=3)=3, fail(warning=2)=0 → 3/5 = 0.6 → final 60 → D
    const grade = computeGrade(results);
    assert.equal(groupById(grade, 'docs').score, 0.6);
    assert.equal(grade.score, 60);
    assert.equal(grade.letter, 'D');
    assert.equal(grade.coverage.evaluated, 2);
    assert.equal(grade.coverage.total, 2);
    for (const id of ['build', 'ci', 'triage', 'community']) {
      assert.equal(groupById(grade, id).included, false, `${id} must be excluded`);
    }
  });

  test('rule errors shrink the denominator like skips do', () => {
    const results = [
      { group: 'docs', severity: 'error', status: 'pass', rule: { severity: 'error' } },
      { group: 'docs', severity: 'error', status: 'error', rule: { severity: 'error' } },
    ];
    const grade = computeGrade(results);
    assert.equal(grade.score, 100);
    assert.deepEqual(grade.coverage, { evaluated: 1, total: 2, percent: 50 });
  });
});

describe('golden fixtures', () => {
  test('golden/all-pass → A+, 100, coverage 10/12', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const scan = await scanAll(root);
    assert.deepEqual(scan.findings, []);
    assert.deepEqual(scan.ruleErrors, []);
    const grade = gradeOf(scan);
    assert.equal(grade.score, 100);
    assert.equal(grade.letter, 'A+');
    assert.deepEqual(grade.coverage, { evaluated: 10, total: 12, percent: 83.3 });
    assert.equal(groupById(grade, 'community').score, 1);
    assert.equal(groupById(grade, 'docs').score, 1);
    assert.equal(groupById(grade, 'build').score, 1);
    assert.equal(groupById(grade, 'ci').included, false);
    assert.equal(groupById(grade, 'triage').included, false);
  });

  test('golden/mixed → A-, 91.42 with exact group math', async (t) => {
    const root = stageFixture(t, 'golden/mixed');
    const scan = await scanAll(root);
    // license error + changelog info, and nothing else.
    assert.equal(scan.findings.length, 2);
    assert.deepEqual(
      scan.findings.map((f) => [f.ruleId, f.severity]),
      [
        ['community/license', 'error'],
        ['docs/changelog', 'info'],
      ],
    );
    const grade = gradeOf(scan);
    // community: 0+3+3+3+3+2 / (3+3+3+3+3+2) = 14/17
    assert.equal(groupById(grade, 'community').score, 0.8235);
    // docs: readme pass(3) + changelog info-finding→warning 0.5×1 → 3.5/4
    assert.equal(groupById(grade, 'docs').score, 0.875);
    // build: both pass → 1
    assert.equal(groupById(grade, 'build').score, 1);
    // (0.15×14/17 + 0.20×0.875 + 0.25×1) / 0.60 × 100 = 91.4215…
    assert.equal(grade.score, 91.42);
    assert.equal(grade.letter, 'A-');
    assert.deepEqual(grade.coverage, { evaluated: 10, total: 12, percent: 83.3 });
  });

  test('golden/partial → skipped lockfile leaves the denominator (A, 9/12)', async (t) => {
    const root = stageFixture(t, 'golden/partial');
    const scan = await scanAll(root);
    const byId = Object.fromEntries(scan.results.map((r) => [r.id, r]));
    assert.equal(byId['build/lockfile'].status, 'skipped');
    assert.match(byId['build/lockfile'].reason, /no package manifest/);
    assert.equal(byId['build/test-command'].status, 'pass');
    assert.equal(byId['triage/gfi-freshness'].status, 'skipped');
    assert.equal(byId['build/fresh-clone'].status, 'skipped');

    const grade = gradeOf(scan);
    assert.deepEqual(grade.coverage, { evaluated: 9, total: 12, percent: 75 });
    // build group counts only the evaluated rule: 3×1/3 = 1
    assert.equal(groupById(grade, 'build').score, 1);
    assert.equal(groupById(grade, 'build').evaluated, 1);
    assert.equal(groupById(grade, 'build').total, 3); // test-command, lockfile, fresh-clone
    // (0.15×1 + 0.20×0.875 + 0.25×1) / 0.60 × 100 = 95.833…
    assert.equal(grade.score, 95.83);
    assert.equal(grade.letter, 'A');
  });

  test('tier honesty: --tier api/container never inflates coverage', async (t) => {
    const root = stageFixture(t, 'golden/partial');
    for (const tier of ['cheap', 'api', 'container']) {
      const scan = await scanAll(root, { tier });
      const grade = gradeOf(scan);
      assert.equal(grade.coverage.total, 12, `tier ${tier}`);
      assert.equal(grade.coverage.evaluated, 9, `tier ${tier}: deferred rules never evaluate in v0`);
      assert.equal(grade.score, 95.83, `tier ${tier}: grade must not move with skipped rules`);
    }
  });

  test('--rules selection shrinks the catalog, not the math', async (t) => {
    const root = stageFixture(t, 'golden/partial');
    const scan = await scanAll(root, { ruleFilter: parseRuleFilter('docs/*') });
    assert.deepEqual(
      scan.results.map((r) => r.id),
      ['docs/readme-quickstart', 'docs/changelog'],
    );
    const grade = gradeOf(scan);
    assert.deepEqual(grade.coverage, { evaluated: 2, total: 2, percent: 100 });
    // docs only: (3×1 + 1×0.5)/4 = 0.875 → 87.5 → B+
    assert.equal(grade.score, 87.5);
    assert.equal(grade.letter, 'B+');
    assert.equal(groupById(grade, 'community').included, false);
  });

  test('exclusion patterns work in --rules', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const filter = parseRuleFilter('community/*,!community/license');
    const scan = await scanAll(root, { ruleFilter: filter });
    assert.ok(!scan.results.some((r) => r.id === 'community/license'));
    assert.equal(scan.results.length, 5);
  });
});

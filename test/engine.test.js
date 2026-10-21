// Engine tests: rule-crash isolation (SPEC §12), tier/deferred honesty,
// and the determinism gate (SPEC §11.4): two runs → identical JSON.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stageFixture, scanAll, makeContext, reportOf } from './helpers.js';
import { runScan, parseRuleFilter, selectRules, TIER_RANK } from '../src/engine.js';
import { ALL_RULES, getRule } from '../src/rules/index.js';
import { renderJson } from '../src/reporters/json.js';

/** Test-only rule that crashes when its fixture contains boom.txt content. */
const crashProbeRule = {
  id: 'docs/crash-probe',
  title: 'Crash probe (test-only)',
  severity: 'warning',
  tier: 'cheap',
  fixable: false,
  docs: 'Throws on purpose to prove per-rule isolation.',
  evaluate(ctx) {
    const text = ctx.fs.readFile('boom.txt');
    if (text && text.includes('boom')) throw new Error('simulated rule crash');
    return [];
  },
};

describe('rule crash isolation', () => {
  test('a crashing rule never aborts the scan and is reported as a rule error', async (t) => {
    const root = stageFixture(t, 'rule-crash');
    const ctx = makeContext(root);
    const scan = await runScan({ rules: [...ALL_RULES, crashProbeRule], ctx, tier: 'cheap' });

    // The scan completed: every catalog rule still produced a result.
    assert.equal(scan.results.length, ALL_RULES.length + 1);

    const crash = scan.results.find((r) => r.id === 'docs/crash-probe');
    assert.equal(crash.status, 'error');
    assert.match(crash.error, /simulated rule crash/);
    assert.deepEqual(scan.ruleErrors, [
      { ruleId: 'docs/crash-probe', error: 'simulated rule crash' },
    ]);

    // Every other rule ran normally (no cascading failure).
    for (const r of scan.results) {
      if (r.id === 'docs/crash-probe') continue;
      assert.ok(
        ['pass', 'warning', 'fail', 'skipped'].includes(r.status),
        `${r.id} unexpectedly ${r.status}${r.error ? `: ${r.error}` : ''}`,
      );
    }

    // The crashed rule is excluded from the grade denominator, and the grade
    // still renders honestly.
    const report = reportOf(scan);
    assert.equal(report.coverage.total, ALL_RULES.length + 1); // catalog + probe
    const lockfile = scan.results.find((r) => r.id === 'build/lockfile');
    assert.equal(lockfile.status, 'pass', 'crash fixture has a lockfile');
    // 10 cheap rules evaluated; the probe (status error) is excluded.
    assert.equal(report.coverage.evaluated, 10);
    assert.ok(report.grade.letter);
  });

  test('a rule returning garbage is isolated as a rule error too', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const badRule = {
      id: 'docs/bad-return',
      title: 'Bad return (test-only)',
      severity: 'info',
      tier: 'cheap',
      fixable: false,
      docs: 'returns the wrong shape',
      evaluate() {
        return { oops: true };
      },
    };
    const scan = await runScan({ rules: [badRule], ctx: makeContext(root), tier: 'cheap' });
    assert.equal(scan.results[0].status, 'error');
    assert.match(scan.results[0].error, /expected Finding/);
  });

  test('a rule with an unknown group prefix is isolated as a rule error', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const weirdRule = {
      id: 'martian/whatever',
      title: 'Unknown group (test-only)',
      severity: 'info',
      tier: 'cheap',
      fixable: false,
      docs: 'lives in a group with no weight',
      evaluate() {
        return [];
      },
    };
    const scan = await runScan({ rules: [weirdRule], ctx: makeContext(root), tier: 'cheap' });
    assert.equal(scan.results[0].status, 'error');
    assert.match(scan.results[0].error, /unknown group/);
    assert.equal(scan.ruleErrors.length, 1);
  });
});

describe('tier and deferred honesty', () => {
  test('default tier marks api/container rules skipped with a reason', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const scan = await scanAll(root);
    const byId = Object.fromEntries(scan.results.map((r) => [r.id, r]));
    assert.equal(byId['triage/gfi-freshness'].status, 'skipped');
    assert.match(byId['triage/gfi-freshness'].reason, /tier api not selected/);
    assert.equal(byId['build/fresh-clone'].status, 'skipped');
    assert.match(byId['build/fresh-clone'].reason, /tier container not selected/);
  });

  test('selecting higher tiers surfaces "deferred", not a fake pass', async (t) => {
    const root = stageFixture(t, 'golden/all-pass');
    const scan = await scanAll(root, { tier: 'container' });
    const byId = Object.fromEntries(scan.results.map((r) => [r.id, r]));
    assert.equal(byId['triage/gfi-freshness'].status, 'skipped');
    assert.match(byId['triage/gfi-freshness'].reason, /deferred to v1/);
    assert.equal(byId['build/fresh-clone'].status, 'skipped');
    assert.match(byId['build/fresh-clone'].reason, /deferred to v1/);
  });
});

describe('determinism gate (SPEC §11.4)', () => {
  test('two runs on the same fixture produce identical JSON', async (t) => {
    const root = stageFixture(t, 'golden/mixed');
    const first = renderJson(reportOf(await scanAll(root)));
    const second = renderJson(reportOf(await scanAll(root)));
    assert.equal(first, second);
    // And the JSON parses into the stable schema.
    const parsed = JSON.parse(first);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.grade.letter, 'A-');
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(Array.isArray(parsed.groups));
    assert.ok(Array.isArray(parsed.results));
    assert.deepEqual(Object.keys(parsed), [
      'version',
      'tool',
      'target',
      'tier',
      'grade',
      'coverage',
      'groups',
      'results',
      'findings',
      'ruleErrors',
    ]);
  });

  test('staged fixture mtimes are pinned, so age evidence is stable', async (t) => {
    const root = stageFixture(t, 'docs/changelog/pass', { mtimeAgeDays: 5 });
    const a = await scanAll(root);
    const b = await scanAll(root);
    assert.equal(renderJson(reportOf(a)), renderJson(reportOf(b)));
  });
});

describe('rule selection', () => {
  test('parseRuleFilter handles ids, globs, exclusions, and whitespace', () => {
    assert.deepEqual(parseRuleFilter(''), { include: [], exclude: [] });
    assert.deepEqual(parseRuleFilter(null), { include: [], exclude: [] });
    assert.deepEqual(parseRuleFilter('docs/*, community/license'), {
      include: ['docs/*', 'community/license'],
      exclude: [],
    });
    assert.deepEqual(parseRuleFilter('community/*,!community/security'), {
      include: ['community/*'],
      exclude: ['community/security'],
    });
  });

  test('selectRules applies include then exclude', () => {
    const keep = selectRules(ALL_RULES, { ruleFilter: parseRuleFilter('docs/*') });
    assert.deepEqual(
      keep.map((r) => r.id),
      ['docs/readme-quickstart', 'docs/changelog'],
    );
    const without = selectRules(ALL_RULES, {
      ruleFilter: parseRuleFilter('*,!build/*,!triage/*'),
    });
    assert.ok(without.every((r) => !r.id.startsWith('build/') && !r.id.startsWith('triage/')));
  });

  test('registry holds exactly 10 cheap rules plus 2 deferred', () => {
    const cheap = ALL_RULES.filter((r) => r.tier === 'cheap');
    const deferred = ALL_RULES.filter((r) => r.deferred);
    assert.equal(cheap.length, 10);
    assert.equal(deferred.length, 2);
    assert.deepEqual(
      deferred.map((r) => r.id),
      ['triage/gfi-freshness', 'build/fresh-clone'],
    );
    for (const id of [
      'community/license',
      'community/contributing',
      'community/code-of-conduct',
      'community/security',
      'community/templates',
      'community/codeowners',
      'docs/readme-quickstart',
      'docs/changelog',
      'build/test-command',
      'build/lockfile',
    ]) {
      assert.ok(getRule(id), `missing rule ${id}`);
      assert.equal(getRule(id).tier, 'cheap');
    }
    assert.equal(TIER_RANK.api > TIER_RANK.cheap, true);
  });
});

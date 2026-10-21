// Shared test utilities: temp staging (temp-dir writes only), a fixed clock,
// and small wrappers around the engine. Every fixture the rules see is staged
// into a temp dir first, so freshness checks are deterministic (mtime age is
// set explicitly relative to the injected clock) and nothing under
// test/fixtures is ever modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { fixedClock } from '../src/clock.js';
import { createContext } from '../src/context.js';
import { runScan } from '../src/engine.js';
import { computeGrade } from '../src/grade.js';
import { ALL_RULES } from '../src/rules/index.js';
import { buildReport } from '../src/reporters/json.js';

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Frozen clock every test uses; fixture mtimes are set relative to it. */
export const TEST_CLOCK_ISO = '2026-12-31T12:00:00.000Z';
export const testClock = fixedClock(TEST_CLOCK_ISO);
const TEST_NOW = new Date(TEST_CLOCK_ISO);
const MS_PER_DAY = 86_400_000;

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
}

export function tmpDir(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dxlint-${sanitize(name)}-`));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return dir;
}

function walkFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, visit);
    else visit(abs);
  }
}

function setMtimes(dir, ageDays) {
  const when = new Date(TEST_NOW.getTime() - ageDays * MS_PER_DAY);
  walkFiles(dir, (abs) => fs.utimesSync(abs, when, when));
}

/**
 * Copy a fixture repo into a temp dir. By default every file gets an mtime of
 * `clock − mtimeAgeDays` so freshness rules are deterministic; pass
 * `mtimeAgeDays` explicitly for stale scenarios.
 */
export function stageFixture(t, rel, { name, mtimeAgeDays = 5 } = {}) {
  const src = path.join(FIXTURES_DIR, rel);
  assert.ok(fs.existsSync(src), `fixture missing: ${rel}`);
  const dest = tmpDir(t, name ?? rel);
  fs.cpSync(src, dest, { recursive: true });
  setMtimes(dest, mtimeAgeDays);
  return dest;
}

/** Build a synthetic repo in a temp dir from a {relPath: contents} map. */
export function makeRepo(t, files, { name = 'repo', mtimeAgeDays } = {}) {
  const root = tmpDir(t, name);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, 'utf8');
  }
  if (mtimeAgeDays !== undefined) setMtimes(root, mtimeAgeDays);
  return root;
}

export function makeContext(root, { clock = testClock, git } = {}) {
  return createContext({ root, clock, git });
}

/** Run a single rule against a root and return its scan result. */
export async function scanRule(rule, root, opts = {}) {
  return runScan({ rules: [rule], ctx: makeContext(root, opts), ...opts });
}

/** Run the full (default) catalog against a root. */
export async function scanAll(root, opts = {}) {
  const { tier = 'cheap', ruleFilter, clock = testClock, git } = opts;
  const ctx = createContext({ root, clock, git });
  return runScan({ rules: ALL_RULES, ctx, tier, ruleFilter });
}

export function gradeOf(scan) {
  return computeGrade(scan.results);
}

export function reportOf(scan, { target = 'fixture', tier = 'cheap', version = '0.1.0' } = {}) {
  return buildReport({ target, tier, toolVersion: version, scan, grade: gradeOf(scan) });
}

/**
 * Assert EXACT findings: no more, no fewer. Each expectation is
 * { severity, message (substring), fixable?, ruleId? }.
 */
export function assertFindings(findings, expectations) {
  assert.equal(
    findings.length,
    expectations.length,
    `expected ${expectations.length} finding(s), got ${findings.length}: ` +
      findings.map((f) => `${f.ruleId}/${f.severity}: ${f.message}`).join(' | '),
  );
  expectations.forEach((exp, i) => {
    const f = findings[i];
    if (exp.ruleId !== undefined) assert.equal(f.ruleId, exp.ruleId, `finding[${i}] ruleId`);
    if (exp.severity !== undefined) assert.equal(f.severity, exp.severity, `finding[${i}] severity`);
    if (exp.message !== undefined) {
      assert.ok(
        f.message.includes(exp.message),
        `finding[${i}] message "${f.message}" should contain "${exp.message}"`,
      );
    }
    if (exp.evidence !== undefined) {
      assert.ok(
        f.evidence && f.evidence.includes(exp.evidence),
        `finding[${i}] evidence "${f.evidence}" should contain "${exp.evidence}"`,
      );
    }
    if (exp.fixable !== undefined) assert.equal(f.fixable, exp.fixable, `finding[${i}] fixable`);
    assert.ok(f.remediation, `finding[${i}] must carry remediation`);
  });
}

export function statusesByRule(scan) {
  return Object.fromEntries(scan.results.map((r) => [r.id, r.status]));
}

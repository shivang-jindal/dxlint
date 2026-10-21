// Rule engine: selection, per-rule isolation (SPEC §12), finding
// normalization, and status derivation. Everything is injectable — the engine
// reads no globals itself.
import { ALL_RULES, groupOfRule } from './rules/index.js';
import { globToRegExp, toPosix } from './fs-accessor.js';

export const TIER_RANK = Object.freeze({ cheap: 0, api: 1, container: 2 });

/** Parse `--rules` value: comma/space separated ids or globs, `!` excludes. */
export function parseRuleFilter(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { include: [], exclude: [] };
  }
  const include = [];
  const exclude = [];
  for (const raw of String(value).split(/[,\s]+/)) {
    if (!raw) continue;
    if (raw.startsWith('!')) exclude.push(raw.slice(1));
    else include.push(raw);
  }
  return { include, exclude };
}

function matches(patterns, id) {
  return patterns.some((p) => globToRegExp(p).test(id));
}

/** Rules part of this run (tier-filtered rules stay, as skipped — coverage). */
export function selectRules(rules, { ruleFilter } = {}) {
  const { include, exclude } = ruleFilter ?? { include: [], exclude: [] };
  return rules.filter((r) => {
    if (exclude.length > 0 && matches(exclude, r.id)) return false;
    if (include.length > 0 && matches(include, r.id)) return true;
    return include.length === 0;
  });
}

function normalizeFinding(rule, raw) {
  const f = raw ?? {};
  const out = {
    ruleId: rule.id,
    severity: f.severity ?? rule.severity,
    message: typeof f.message === 'string' ? f.message : rule.title,
    remediation: typeof f.remediation === 'string' ? f.remediation : '',
    fixable: !!f.fixable,
  };
  if (f.evidence !== undefined && f.evidence !== null) out.evidence = String(f.evidence);
  if (f.location && typeof f.location === 'object' && f.location.path) {
    out.location = { path: toPosix(f.location.path) };
    if (Number.isFinite(f.location.line)) out.location.line = f.location.line;
  }
  if (!['error', 'warning', 'info'].includes(out.severity)) {
    throw new Error(`invalid finding severity "${out.severity}"`);
  }
  return out;
}

function statusFromFindings(findings) {
  if (findings.length === 0) return 'pass';
  return findings.some((f) => f.severity === 'error') ? 'fail' : 'warning';
}

function skipped(rule, group, reason) {
  return {
    rule,
    id: rule.id,
    group,
    severity: rule.severity,
    tier: rule.tier,
    status: 'skipped',
    reason,
    findings: [],
  };
}

/**
 * Run the selected rules against a context. Never throws because of a rule:
 * a crashing rule becomes `{status:'error'}` and the scan continues.
 *
 * @returns {Promise<{results: object[], findings: object[], ruleErrors: object[]}>}
 */
export async function runScan({ rules = ALL_RULES, ctx, tier = 'cheap', ruleFilter } = {}) {
  if (!ctx) throw new TypeError('runScan: ctx is required');
  if (!(tier in TIER_RANK)) throw new TypeError(`runScan: unknown tier "${tier}"`);
  const selected = selectRules(rules, { ruleFilter });
  const selectedTierRank = TIER_RANK[tier];

  const results = [];
  for (const rule of selected) {
    let group;
    try {
      group = groupOfRule(rule);
    } catch (err) {
      // Malformed rule id (bad group prefix) — isolate it like a crash.
      results.push({
        rule,
        id: rule.id,
        group: null,
        severity: rule.severity,
        tier: rule.tier,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        findings: [],
      });
      continue;
    }
    if (TIER_RANK[rule.tier] > selectedTierRank) {
      results.push(skipped(rule, group, `tier ${rule.tier} not selected (re-run with --tier ${rule.tier})`));
      continue;
    }
    try {
      const out = await rule.evaluate(ctx);
      if (out && typeof out.skip === 'string') {
        results.push(skipped(rule, group, out.skip));
        continue;
      }
      if (out === undefined || out === null) {
        results.push(skipped(rule, group, 'rule returned no result; not evaluated'));
        continue;
      }
      if (!Array.isArray(out)) {
        throw new Error(`rule returned ${typeof out}, expected Finding[] or {skip}`);
      }
      const findings = out.map((f) => normalizeFinding(rule, f));
      results.push({
        rule,
        id: rule.id,
        group,
        severity: rule.severity,
        tier: rule.tier,
        status: statusFromFindings(findings),
        findings,
      });
    } catch (err) {
      results.push({
        rule,
        id: rule.id,
        group,
        severity: rule.severity,
        tier: rule.tier,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        findings: [],
      });
    }
  }

  const findings = [];
  const ruleErrors = [];
  for (const r of results) {
    findings.push(...r.findings);
    if (r.status === 'error') ruleErrors.push({ ruleId: r.id, error: r.error });
  }
  return { results, findings, ruleErrors };
}

// Grading math — SPEC §5, exactly:
//   per-rule score: pass=1.0, warning=0.5, fail=0.0 (skip/error = n/a)
//   group score    = Σ(severity_weight × score) / Σ(severity_weight)
//                    severity_weight: error=3, warning=2, info=1
//   final 0–100    = Σ(group_weight × group_score) / Σ(present group weights)
//                    docs .20 build .25 ci .20 triage .20 community .15
//   letter         A+ ≥97 A ≥93 A- ≥90 B+ ≥86 B ≥82 B- ≥78
//                  C+ ≥74 C ≥70 C- ≥66 D ≥55 F <55
// Rules that didn't run (skip, rule error, tier not selected) are excluded
// from every denominator and surfaced via coverage.

export const SEVERITY_WEIGHT = Object.freeze({ error: 3, warning: 2, info: 1 });
export const GROUP_WEIGHT = Object.freeze({
  docs: 0.2,
  build: 0.25,
  ci: 0.2,
  triage: 0.2,
  community: 0.15,
});
export const GROUP_ORDER = Object.freeze(['docs', 'build', 'ci', 'triage', 'community']);

const LETTER_THRESHOLDS = [
  ['A+', 97],
  ['A', 93],
  ['A-', 90],
  ['B+', 86],
  ['B', 82],
  ['B-', 78],
  ['C+', 74],
  ['C', 70],
  ['C-', 66],
  ['D', 55],
  ['F', -Infinity],
];

export function severityWeight(severity) {
  const w = SEVERITY_WEIGHT[severity];
  if (w === undefined) throw new Error(`unknown severity: ${severity}`);
  return w;
}

export function letterFor(score) {
  for (const [letter, min] of LETTER_THRESHOLDS) {
    if (score >= min) return letter;
  }
  return 'F';
}

/** Map an engine rule status to its SPEC §5 per-rule score (null = n/a). */
export function scoreForStatus(status) {
  if (status === 'pass') return 1;
  if (status === 'warning') return 0.5;
  if (status === 'fail') return 0;
  return null; // 'skipped' | 'error' → excluded from the denominator
}

function round(n, places = 4) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * @param {Array<{rule: {id: string, severity: string}, status: string, group: string}>} results
 *   engine results; each carries `group` (or a `rule` with an id to derive it).
 */
export function computeGrade(results) {
  const byGroup = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const r of results) {
    const group = r.group ?? r.rule?.group;
    // Results with no known group (malformed rule id) are reported by the
    // engine as rule errors — they stay in coverage but score nowhere.
    if (!group || !byGroup.has(group)) continue;
    byGroup.get(group).push(r);
  }

  const groups = [];
  let weightedSum = 0;
  let weightSum = 0;

  for (const id of GROUP_ORDER) {
    const members = byGroup.get(id);
    const evaluated = members.filter((r) => scoreForStatus(r.status) !== null);
    const weight = GROUP_WEIGHT[id];
    if (evaluated.length === 0) {
      groups.push({
        id,
        weight,
        score: null,
        evaluated: 0,
        total: members.length,
        included: false,
      });
      continue;
    }
    let num = 0;
    let den = 0;
    for (const r of evaluated) {
      const sev = r.rule.severity ?? r.severity;
      const w = severityWeight(sev);
      num += w * scoreForStatus(r.status);
      den += w;
    }
    const score = den === 0 ? 1 : num / den;
    groups.push({
      id,
      weight,
      score: round(score),
      evaluated: evaluated.length,
      total: members.length,
      included: true,
    });
    weightedSum += weight * score;
    weightSum += weight;
  }

  // Groups where nothing ran are excluded from the denominator (same honesty
  // rule as skipped rules): a grade must never move because checks vanished.
  const finalScore = weightSum === 0 ? 0 : (weightedSum / weightSum) * 100;
  const evaluated = results.filter((r) => scoreForStatus(r.status) !== null).length;
  const total = results.length;

  return {
    score: round(finalScore, 2),
    letter: letterFor(finalScore),
    groups,
    coverage: {
      evaluated,
      total,
      percent: total === 0 ? 0 : round((evaluated / total) * 100, 1),
    },
  };
}

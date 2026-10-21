// Rule registry (SPEC §3). Order is fixed and stable — reporters and JSON
// output depend on it for deterministic results.
import { GROUP_WEIGHT, severityWeight } from '../grade.js';
import { licenseRule } from './license.js';
import { contributingRule } from './contributing.js';
import { codeOfConductRule } from './code-of-conduct.js';
import { securityRule } from './security.js';
import { templatesRule } from './templates.js';
import { codeownersRule } from './codeowners.js';
import { readmeQuickstartRule } from './readme-quickstart.js';
import { changelogRule } from './changelog.js';
import { testCommandRule } from './test-command.js';
import { lockfileRule } from './lockfile.js';
import { gfiFreshnessRule, freshCloneRule } from './deferred.js';

export const ALL_RULES = Object.freeze([
  licenseRule,
  contributingRule,
  codeOfConductRule,
  securityRule,
  templatesRule,
  codeownersRule,
  readmeQuickstartRule,
  changelogRule,
  testCommandRule,
  lockfileRule,
  gfiFreshnessRule,
  freshCloneRule,
]);

/** Group id derived from a rule id prefix ("community/license" → community). */
export function groupOfRule(rule) {
  const prefix = String(rule.id).split('/')[0];
  if (!(prefix in GROUP_WEIGHT)) {
    throw new Error(`rule ${rule.id} has unknown group "${prefix}"`);
  }
  return prefix;
}

// Fail fast on a malformed built-in rule.
for (const rule of ALL_RULES) {
  for (const field of ['id', 'title', 'severity', 'tier', 'docs']) {
    if (!rule[field]) throw new Error(`rule ${rule.id ?? '<unknown>'} is missing "${field}"`);
  }
  if (!['error', 'warning', 'info'].includes(rule.severity)) {
    throw new Error(`rule ${rule.id} has invalid severity "${rule.severity}"`);
  }
  if (!['cheap', 'api', 'container'].includes(rule.tier)) {
    throw new Error(`rule ${rule.id} has invalid tier "${rule.tier}"`);
  }
  groupOfRule(rule);
  severityWeight(rule.severity); // validates the weight table
}

export function getRule(id) {
  return ALL_RULES.find((r) => r.id === id) ?? null;
}

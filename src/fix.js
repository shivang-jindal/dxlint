// `dxlint fix` — mechanical, create-only fixes (SPEC §1.3, §7.3).
// Default is dry-run: plan and preview, write nothing. `--apply` writes only
// files that are missing — never edits existing prose, never deletes — so a
// second run is a no-op by construction.
import fs from 'node:fs';
import path from 'node:path';

function defaultWriter(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

/**
 * Collect create-only patches for every fixable finding.
 * Files that already exist are dropped from the plan (belt and braces on top
 * of rules only flagging missing files).
 *
 * @returns {Promise<{plan: Array<{ruleId: string, path: string, content: string}>, errors: Array<{ruleId: string, error: string}>}>}
 */
export async function planFixes({ scan, ctx }) {
  const plan = [];
  const errors = [];
  const seen = new Set();
  for (const result of scan.results) {
    const rule = result.rule;
    if (typeof rule.fix !== 'function') continue;
    for (const finding of result.findings) {
      if (!finding.fixable) continue;
      try {
        const patch = await rule.fix(ctx, finding);
        if (!patch || typeof patch.path !== 'string' || typeof patch.content !== 'string') {
          throw new Error('fix() must return {path, content}');
        }
        const rel = patch.path.split(/[\\/]+/).join('/');
        if (seen.has(rel) || ctx.fs.exists(rel)) continue;
        seen.add(rel);
        plan.push({ ruleId: rule.id, path: rel, content: patch.content });
      } catch (err) {
        errors.push({
          ruleId: rule.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { plan, errors };
}

/** Write a plan to disk. Only called with `--apply`; dry-run never lands here. */
export function applyFixes(root, plan, { writer = defaultWriter } = {}) {
  const created = [];
  for (const item of plan) {
    writer(root, item.path, item.content);
    created.push(item.path);
  }
  return created;
}

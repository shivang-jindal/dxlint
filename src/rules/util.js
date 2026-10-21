// Shared helpers for rule implementations.
import { daysBetween } from '../clock.js';

/** First existing candidate path (repo-relative), or null. */
export function firstExisting(ctx, candidates) {
  for (const p of candidates) {
    if (ctx.fs.exists(p)) return p;
  }
  return null;
}

/** Parse JSON text; returns {value} or {error}. Never throws. */
export function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Last time a path was touched: git history first, file mtime fallback
 * (community/contributing freshness uses "git log or file mtime").
 */
export function lastTouchedMs(ctx, relPath) {
  const fromGit = ctx.git?.lastCommitTime?.(relPath);
  if (Number.isFinite(fromGit)) return fromGit;
  const st = ctx.fs.stat(relPath);
  return st ? st.mtimeMs : null;
}

/** Age of a path in whole days at the injected clock; null when unknown. */
export function ageInDays(ctx, relPath) {
  const ms = lastTouchedMs(ctx, relPath);
  if (ms === null) return null;
  return daysBetween(ms, ctx.clock.now());
}

/** Extract fenced code blocks (``` or ~~~) from markdown-ish text. */
export function codeFences(text) {
  const fences = [];
  const re = /(^|\n)[ \t]*(```|~~~)[^\n]*\n([\s\S]*?)(\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    fences.push({ body: m[3], index: m.index });
  }
  return fences;
}

/** Shell-ish contact heuristic: email address, mailto:, or a URL. */
export function hasContactChannel(text) {
  if (/mailto:/i.test(text)) return true;
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return true;
  if (/https?:\/\/\S+/i.test(text)) return true;
  return false;
}

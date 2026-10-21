// Real-filesystem accessor. The engine only ever talks to this interface, so
// tests can inject fakes. Paths crossing the boundary are repo-relative and
// always '/'-separated (Windows-safe output).
import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const GLOB_MAX_DEPTH = 12;
const GLOB_MAX_ENTRIES = 50_000;

export function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/** Translate a limited glob (`*`, `?`, `**`) into an anchored RegExp. */
export function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // '**/' also matches zero dirs
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(out + '$');
}

export function createNodeFs(root) {
  const abs = (...parts) => path.resolve(root, ...parts);

  function walk(dirRel, depth, acc) {
    if (depth > GLOB_MAX_DEPTH || acc.length >= GLOB_MAX_ENTRIES) return;
    let entries;
    try {
      entries = fs.readdirSync(abs(dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        acc.push(rel + '/');
        walk(rel, depth + 1, acc);
      } else {
        acc.push(rel);
      }
    }
  }

  return {
    root,
    /** @returns {string|null} utf8 contents, or null when missing/unreadable. */
    readFile(relPath) {
      try {
        return fs.readFileSync(abs(relPath), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'EACCES') return null;
        throw err;
      }
    },
    exists(relPath) {
      try {
        fs.statSync(abs(relPath));
        return true;
      } catch {
        return false;
      }
    },
    isDirectory(relPath) {
      try {
        return fs.statSync(abs(relPath)).isDirectory();
      } catch {
        return false;
      }
    },
    stat(relPath) {
      try {
        const s = fs.statSync(abs(relPath));
        return { mtimeMs: s.mtimeMs, isFile: s.isFile(), isDirectory: s.isDirectory() };
      } catch {
        return null;
      }
    },
    /** Sorted entry names of a directory ([] when missing). */
    list(relPath = '.') {
      try {
        return fs.readdirSync(abs(relPath)).sort();
      } catch {
        return [];
      }
    },
    /** Repo-relative paths (dirs suffixed '/') matching a simple glob. */
    glob(pattern) {
      const re = globToRegExp(pattern);
      const acc = [];
      walk('', 0, acc);
      return acc.filter((p) => (p.endsWith('/') ? re.test(p.slice(0, -1)) : re.test(p)));
    },
  };
}

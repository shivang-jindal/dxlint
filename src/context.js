// Builds the rule execution context (SPEC §3). Everything is injectable:
// fs accessors, git exec, clock — the engine itself touches no globals.
import { systemClock } from './clock.js';
import { createNodeFs } from './fs-accessor.js';
import { createNodeGit } from './git.js';

export function createContext({ root, clock = systemClock, fs, git, config = {} } = {}) {
  if (!root) throw new TypeError('createContext: root is required');
  return {
    root,
    fs: fs ?? createNodeFs(root),
    git: git ?? createNodeGit(root),
    clock,
    config,
  };
}

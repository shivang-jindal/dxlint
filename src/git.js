// Git accessor. The exec function is injectable so tests can fake history
// without a real repository. Every failure degrades to null (SPEC §12:
// "not a git repo → run FS rules; git rules marked unavailable").
import { execFileSync } from 'node:child_process';

function defaultExec(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function createNodeGit(root, { exec = defaultExec } = {}) {
  function run(args) {
    try {
      const out = exec(root, args);
      return typeof out === 'string' ? out.trim() : out;
    } catch {
      return null;
    }
  }

  return {
    /** Is this directory inside a usable git work tree? */
    isRepo() {
      return run(['rev-parse', '--is-inside-work-tree']) === 'true';
    },
    /** Epoch ms of the last commit touching `relPath`, or null. */
    lastCommitTime(relPath) {
      const out = run(['log', '-1', '--format=%ct', '--', relPath]);
      if (!out) return null;
      const secs = Number.parseInt(out, 10);
      return Number.isFinite(secs) ? secs * 1000 : null;
    },
  };
}

/** A fake git accessor with a scripted per-path last-commit time. */
export function fakeGit(lastCommitTimes = {}) {
  return {
    isRepo: () => true,
    lastCommitTime(relPath) {
      const v = lastCommitTimes[relPath];
      return v === undefined ? null : v;
    },
  };
}

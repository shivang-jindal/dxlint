// build/lockfile — a lockfile for the detected ecosystem is committed.
const ECOSYSTEMS = [
  { manifest: 'package.json', locks: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'], label: 'npm/yarn/pnpm/bun' },
  { manifest: 'Cargo.toml', locks: ['Cargo.lock'], label: 'cargo' },
  { manifest: 'pyproject.toml', locks: ['poetry.lock', 'uv.lock', 'Pipfile.lock'], label: 'python' },
  { manifest: 'Pipfile', locks: ['Pipfile.lock'], label: 'python' },
  { manifest: 'Gemfile', locks: ['Gemfile.lock'], label: 'bundler' },
  { manifest: 'composer.json', locks: ['composer.lock'], label: 'composer' },
  { manifest: 'go.mod', locks: ['go.sum'], label: 'go' },
];

export const lockfileRule = {
  id: 'build/lockfile',
  title: 'Lockfile committed for the detected ecosystem',
  severity: 'warning',
  tier: 'cheap',
  fixable: false,
  docs: `Why: without a committed lockfile, "it works on my machine" becomes the
norm. A newcomer installs slightly different dependency versions than CI, tests
fail for reasons that aren't their fault, and they blame themselves — or the
project — and leave.

What dxlint checks: for each package manifest present (package.json,
Cargo.toml, pyproject.toml, Gemfile, go.mod, …) a matching lockfile exists:
package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lock, Cargo.lock,
poetry.lock / uv.lock / Pipfile.lock, Gemfile.lock, composer.lock, go.sum.

Pass example:
  package.json + package-lock.json

Fail example:
  package.json, no lockfile anywhere →
  "Installs are not reproducible" (evidence lists the accepted lockfiles)

Skipped (and excluded from the grade denominator) when no package manifest
exists — there would be nothing to lock.

Not auto-fixable: a lockfile must come from a real install, so dxlint will
never fabricate one.`,
  evaluate(ctx) {
    const findings = [];
    let ecosystemsChecked = 0;
    for (const eco of ECOSYSTEMS) {
      if (!ctx.fs.exists(eco.manifest)) continue;
      ecosystemsChecked++;
      if (eco.locks.some((l) => ctx.fs.exists(l))) continue;
      findings.push({
        severity: 'warning',
        message: `${eco.manifest} is present but no ${eco.label} lockfile is committed`,
        evidence: `${eco.manifest} found; expected one of: ${eco.locks.join(', ')}`,
        remediation: `Run your package manager's install once and commit the generated lockfile (e.g. ${eco.locks[0]}).`,
        location: { path: eco.manifest },
        fixable: false,
      });
    }
    if (ecosystemsChecked === 0) {
      return { skip: 'no package manifest detected, nothing to lock' };
    }
    return findings;
  },
};

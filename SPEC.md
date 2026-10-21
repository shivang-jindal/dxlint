# dxlint — technical specification

> Companion to [`README.md`](./README.md). Build document: rule engine, the v0/v1
> rule catalog with exact semantics, grading math, reporters, the fix bot, and
> test strategy.

---

## 1. Design invariants

1. **Every rule is deterministic.** Same repo + same cache state ⇒ same
   findings. No network in the core engine (API-backed rules are a separate,
   opt-in class and are cached).
2. **Every finding is actionable.** A rule that only complains without a
   recommended fix (automated or documented) doesn't ship.
3. **Fixes are mechanical only.** `dxlint fix` never rewrites prose or makes
   judgment calls. It generates missing files and ratchets baselines. Anything
   else is a suggestion in the report.
4. **Grades measure the newcomer, not the maintainer.** Rules are framed as
   "what a first-time contributor experiences," which is the north star for
   severity and grouping.
5. **Cheap by default.** Core scan < 2 s. Container probes and API rules are
   explicit tiers, never surprises.

## 2. CLI surface

```
dxlint [path]                    lint a repo (default: cwd)
  --rules <glob/id list>         include/exclude rules
  --tier cheap|api|container     max tier to run (default cheap)
  --format terminal|json|md|sarif
  --output <file>
  --baseline <file>              compare against baseline (ratchet mode)
  --update-baseline
  --fail-on <severity>           default: error
  --strict                       warnings fail too

dxlint fix [path]                apply mechanical fixes; opens a PR with --pr
  --dry-run
  --pr                           create branch + PR (requires gh)
dxlint explain <rule-id>         rule docs, rationale, examples
dxlint rules [--format json]     rule catalog (for editors/marketplace)
dxlint badge <path> [--out f]    write badge JSON
dxlint init                      add Action workflow + baseline
```

Exit codes: `0` pass · `1` findings at/above `--fail-on` · `2` usage/config ·
3 internal.

## 3. Engine

```ts
interface Rule {
  id: string;                    // "community/security"
  title: string;
  severity: "error" | "warning" | "info";
  tier: "cheap" | "api" | "container";
  fixable: boolean | "generate"; // generate = can create missing files
  docs: string;                  // explain text w/ rationale + examples
  evaluate(ctx: Ctx): Finding[] | Promise<Finding[]>;
  fix?(ctx: Ctx, f: Finding): Patch | Promise<Patch>;
}

type Ctx = {
  fs: FsAccessor;        // virtual FS w/ glob, ignore rules, content cache
  git: GitAccessor;      // log, blame, branches (shallow-ok)
  gh?: GitHubAccessor;   // REST/GraphQL, cached 24h, optional
  probe?: ProbeRunner;   // container tier
  clock: Clock;          // injected, for determinism in tests
  config: Config;
};

type Finding = {
  ruleId: string; severity: Severity;
  message: string;              // one sentence, newcomer-framed
  evidence?: string;            // e.g. "p50 = 34 min over 212 PRs"
  remediation: string;          // what to do
  location?: { path: string; line?: number };
  fixable: boolean;
};
```

Rule discovery: built-ins + `dxlint-rule-*` packages from node_modules
(configurable), each exporting `Rule[]`. This is the marketplace seam.

## 4. Rule catalog (v0 = 10, v1 = 30)

### v0 — cheap tier only, zero network

| ID | Check | Pass condition |
|----|-------|----------------|
| `community/license` | LICENSE at root + SPDX `license` field in manifest | both present, consistent |
| `community/contributing` | CONTRIBUTING.md exists, < 12 months stale, contains a "where to start"/development section | heuristic section detection |
| `community/code-of-conduct` | CODE_OF_CONDUCT.md present | exists |
| `community/templates` | `.github/ISSUE_TEMPLATE/` ≥ 1 form + `PULL_REQUEST_TEMPLATE` | exists and parses |
| `community/security` | SECURITY.md or `.github/SECURITY.md`, with private-reporting channel | exists + contains contact |
| `community/codeowners` | CODEOWNERS covers ≥ 80% of top-level paths | coverage computed |
| `docs/readme-quickstart` | README contains an install + usage snippet | fence with `npm i`/`pip install`/`cargo add`/etc. |
| `docs/changelog` | CHANGELOG.md (or releases dir) updated in last 90 days | exists + recent |
| `build/fresh-clone` *(container)* | clean checkout installs + tests green | container probe |
| `triage/gfi-freshness` *(api)* | ≥ 3 `good first issue`, median age < 90 days | via cached API |

`docs/readme-quickstart` in v1 delegates execution to `snipci` if installed
(soft dependency — degrade to presence-only check).

### v1 additions (selected)

| ID | Check |
|----|-------|
| `ci/feedback-latency` | p50 first CI conclusion < 10 min (from API check-runs) |
| `ci/workflow-hygiene` | pinned action versions (no `@main`), no unbounded concurrency |
| `ci/matrix-visibility` | required checks have unique, stable names |
| `triage/pr-response` | median first maintainer response on PRs < 7 days |
| `triage/issue-hygiene` | unlabeled-issue ratio < 20%, no issues > 180d without response |
| `triage/stale-config` | stale bot configured but not closing `good first issue` |
| `docs/api-docs-fresh` | public exported symbols have docstrings (via ctxc, if present) |
| `docs/examples-runnable` | snippets execute (via snipci) |
| `build/lockfile` | lockfile committed; install is reproducible |
| `build/devcontainer` | devcontainer or nix flake or mise config present |
| `build/test-command` | single documented command runs tests |
| `community/first-merge-time` | median time-to-first-merge for new contributors < 14 days |
| `community/issue-size-labels` | size labels exist and are applied ≥ 50% of issues |
| `accessibility/docs` | docs site has alt text/lint (axe on built site; opt-in) |
| `license-year` | license year current (info severity; the pedantic example) |

## 5. Grading

```
per-rule score: pass=1.0, warning=0.5, fail=0.0, skip=n/a
group score     = Σ(severity_weight × score) / Σ(severity_weight)
                 severity_weight: error=3, warning=2, info=1
final 0–100     = Σ(group weight × group score)
                 groups: docs .20, build .25, ci .20, triage .20, community .15
letter          A+ ≥ 97 · A ≥ 93 · A- ≥ 90 · B+ ≥ 86 · B ≥ 82 · B- ≥ 78
                C+ ≥ 74 · C ≥ 70 · C- ≥ 66 · D ≥ 55 · F < 55
```

Rules that don't run (tier not selected, API unavailable) are **excluded from
the denominator** and the report shows coverage: `Grade: A (24/30 rules
evaluated)`. A grade must never silently improve because checks were skipped.

**Baseline/ratchet:** `dxlint fix --update-baseline` records current findings;
subsequent runs compare to baseline and only *new* findings fail CI. This is
the adoption unlock — you don't have to be perfect on day one.

## 6. Reporters

- **terminal:** grouped by severity with the newcomer narrative ("a first-time
  contributor hits 3 blockers"), then the grade, then `dxlint fix` hint.
- **json:** stable schema `{version, grade, coverage, groups[], findings[]}`.
  Versioned; breaking changes require a major bump.
- **md:** for PR bodies / discussion posts.
- **sarif:** for code-scanning integration.
- **badge:** `dxlint-badge.json` → Shields dynamic card:
  `{"schemaVersion":1,"label":"dxlint","message":"A+","color":"brightgreen"}`.

## 7. The fix bot

`dxlint fix --pr` behavior:

1. Create branch `dxlint/fixes-<shortsha>`.
2. Apply only `fixable` findings: generate templates, SECURITY.md, CODEOWNERS
   scaffolds, license SPDX alignment, workflow additions, baseline file.
3. Never touch prose in existing files; never delete anything.
4. Open a PR whose body contains: the grade before/after, each change with
   rationale, and a `<!-- dxlint -->` marker (so the bot can update its own PR
   idempotently and close itself if superseded).
5. Label `dxlint:fix`; configured to skip if the repo has `dxlint:nomerge`.

## 8. Container probes

Only for `tier=container` rules:

- Build a probe image from the repo's detected toolchain (cached by lockfile
  hash + Dockerfile hash).
- Run: clean checkout → install → configured test command → capture exit +
  durations.
- Hard timeout (default 15 min), no network unless the rule opts in (some
  installs legitimately need registry access — allowlist `registry.npmjs.org`,
  `pypi.org`, etc.).
- Never run on fork PRs with secrets; the probe never gets secrets at all.

## 9. Action & CI integration

```yaml
- uses: dxlint/action@v1
  with:
    tier: cheap          # PRs
    fail-on: error
    badge: dxlint-badge.json
- schedule: nightly runs with tier: container
```

Ratchet semantics mean the first adoption PR is small and the trend line goes
up — which is exactly the story maintainers want to tell.

## 10. Performance budgets

| Tier | Budget | Notes |
|------|--------|-------|
| cheap (10 rules) | < 2 s | pure FS + git, no network |
| api (10 more) | + ≤ 3 s | cached 24h, parallel GraphQL |
| container | minutes | nightly only, cached images |

## 11. Test strategy

1. **Fixture repos per rule.** `fixtures/<rule>/pass` and `/fail` (and
   `/fixable` where applicable). CI asserts exactly the expected findings —
   no more, no fewer.
2. **Golden grades.** Grade computation snapshot-tested with fixed clocks and
   fixture data; weight changes must consciously update snapshots.
3. **Fix idempotence.** `dxlint fix` twice ⇒ second run is a no-op (property
   test).
4. **Determinism gate.** Two runs on the same fixture produce identical JSON.
5. **Coverage honesty test.** With API unavailable, grade denominator shrinks
   and coverage reports < 100%.
6. **Real-repo smoke (manual, pre-release).** Scan 20 popular repos; human
   reviews the grades for plausibility before each minor release.

## 12. Failure modes

| Failure | Behavior |
|---------|----------|
| Not a git repo | run FS rules; git/API rules marked unavailable |
| No API token | skip API rules; warn once |
| Container unavailable | skip container rules; never silently pass |
| Repo is a monorepo | detect workspaces; grade the root + optionally each workspace |
| Huge repo | respect ignore files; cap file reads; warn on > 200k files |
| Rule crashes | isolate per-rule try/catch; report as rule error, don't abort scan |

## 13. v1 → v2 cut line

v1: 30 rules, grade + baseline, Action, badge, fix bot for file generation, JSON
schema frozen.

v2: rule marketplace with registry + signing, org dashboard with trend lines,
scheduled rotted-issue alerts, `State of Contributor Experience` report tooling.

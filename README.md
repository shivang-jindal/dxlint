# dxlint — the contributor experience linter

> **Lint your repository's onboarding. Get a grade. Get a fix PR.**
> ESLint for the thing that decides whether strangers ever contribute.

**Archetype:** CLI + GitHub Action + badge · **Buzz:** 🔥🔥🔥🔥 · **Build speed:** Fast

---

## The problem

Open source has a leaking-bucket problem and nobody measures it. A well-meaning
newcomer:

1. lands on the README → quickstart is 3 years stale
2. clones → `npm test` fails on a fresh machine
3. reads CONTRIBUTING → it's a wall of text with no "where do I start?"
4. opens a PR → CI takes 47 minutes, then nobody reviews for 3 weeks
5. leaves. Silently. You never get the data point.

Maintainers can't see any of this. Coverage has a percentage, security has
audits, dependencies have bots — **contributor experience has nothing.**

## The idea

```bash
$ dxlint ./myrepo
  CONTRIBUTING.md exists                      ✅
  README quickstart runs (fresh clone)        ✅  42s
  npm test passes from clean checkout         ❌  missing devDependency
  CI feedback < 10 min                        ⚠️  p50 = 34 min
  good first issue exists & is < 90d stale    ❌  oldest is 411 days
  Issue + PR templates                        ✅
  Median first response on PRs                ⚠️  11 days
  SECURITY.md                                 ❌

  Grade: C+    → dxlint fix  (opens a PR with 4 mechanical fixes)
  → JSON + badge + full report at dxlint.report
```

~30 rules, grouped: **docs**, **build**, **ci**, **triage**, **community**.
Each rule is deterministic, documented, and has an auto-fix where one exists.
`dxlint fix` opens a PR with only mechanical changes (templates, labels, badges,
broken quickstart) — never opinionated rewrites.

## Why it wins

- **Grade culture works.** Lighthouse, security scorecards, Core Web Vitals —
  people optimize public numbers. A grade *is* the distribution.
- **Every rule is a shareable insight.** "Your good-first-issues are 411 days
  stale" gets retweeted. That's free marketing per scan.
- **Two audiences, one artifact.** Contributors read the grade before choosing
  where to spend an evening; maintainers fix it.
- **Composable:** `snipci` powers the quickstart rule; `issue-radar` powers the
  triage rules; `firstday` consumes the grade to decide if a repo is
  newcomer-ready.

## Who wants it

Maintainers of any repo >500 stars, foundations (CNCF, Apache, Mozilla) that
want portfolio-wide DX metrics, and companies that measure OSS program health.

## Features

**v0 (weekend):** 10 rules, terminal + JSON + markdown report.
**v1:** GitHub Action, badge endpoint, `dxlint fix` PR bot, 30 rules, monorepo
support, baseline file (`dxlint-baseline.json`) so you can ratchet.
**v2:** org dashboard (grade every repo you own), trend lines, rule marketplace
(community-contributed rules — *this* is how it becomes a platform), scheduled
scans with rotted-issue alerts.

### Rule starters
| Rule | Fix |
|------|-----|
| `build/fresh-clone` | `npm test`/`make test` in clean container | report only |
| `docs/quickstart-runs` | snippet executes | via `snipci` |
| `ci/feedback-latency` | p50 < 10 min | report + sharding hints |
| `triage/gfi-freshness` | `good first issue` < 90d | label suggestions |
| `triage/pr-response` | median < 7d | report |
| `community/templates` | issue + PR templates | auto-generate |
| `community/security` | SECURITY.md + private reporting | auto-generate |
| `community/codeowners` | CODEOWNERS coverage | suggest |
| `docs/license` | LICENSE at root + SPDX in package manifest | auto-generate |

## Architecture

```
repo checkout (shallow, cached)
   ├─ filesystem rules      (templates, files, licenses, CODEOWNERS)
   ├─ git-history rules     (response times, rotted issues, PR latency)
   ├─ GitHub API rules      (labels, discussions, security policy)
   └─ container probes      (fresh-clone build/test — cached by lockfile hash)
        │
        ▼
  engine: rule registry (WASM or TS plugins) → findings[]
        │
        ▼
  reporters: terminal · JSON · markdown · badge · PR
```

Container probes are the expensive part — run them on `main` only and cache by
lockfile hash. Everything else is <2s.

## Growth loop

1. **Badge in README:** `dxlint: A+`. Instant culture, same as coverage.
2. `dxlint scan top-1000` weekly report: "the median popular repo grades B."
   Annual "State of Contributor Experience" report — huge link magnet.
3. Rule marketplace: community writes rules for Go/Rust/Ruby specifics; each
   rule author promotes their own rule.
4. Foundations adopt it as a program health metric → institutional distribution.

## Competitors & wedge

| Existing | Gap you exploit |
|----------|-----------------|
| OpenSSF Scorecard | Security/governance focused, not contributor UX |
| All Contributors bot | Recognition, not measurement |
| Lighthouse / Core Web Vitals | Web pages, not repos |
| Community Health Analytics (CHAOSS) | Academic, heavy, no grade, no fixes |

**Wedge:** one grade + auto-fix PRs + rules that actually hurt
(`fresh-clone`, `gfi-freshness`).

## 48-hour MVP

1. Day 1: 10 filesystem + git-history rules, zero GitHub API. Terminal table.
2. Day 2 AM: JSON + markdown reporters + badge file + Action wrapper.
3. Day 2 PM: scan 30 well-known repos, publish the grade table. The table *is*
   the launch.

## Monetization (open core)

- Free: CLI, Action, badge, all rules for public repos.
- **Team:** private repos, trend history, org dashboard, custom rules, rotted-
  issue alerts, SSO.

## Risks

- **Grades feel like public shaming.** Frame as *progress* (baseline + ratchet),
  never rank-and-shame individuals by default.
- **Rule bikeshedding.** Ship opinions, accept RFCs, keep the core list small.
- **Container probes are heavy.** Cache aggressively; make them optional.

---

## Build & test

dxlint v0 is plain Node.js: **Node ≥ 20, ESM, zero runtime dependencies** —
no `npm install`, no lockfile, node builtins only.

```bash
node --test test/          # the whole suite (this is also `npm test`)
node src/cli.js --help     # CLI help (exits 0)
node src/cli.js lint ./myrepo
node src/cli.js explain community/license
node src/cli.js rules --format json
node src/cli.js fix ./myrepo            # dry run: previews files it would create
node src/cli.js fix ./myrepo --apply    # creates only missing files, idempotent
node src/cli.js badge ./myrepo --out badge.json
```

Notes for contributors:

- **Injectable everything.** Rules never touch globals: the fs accessor, the
  git exec, and the clock are injected through the context
  (`src/context.js`), so tests run against a frozen clock and fake git
  history. Findings never embed absolute paths or timestamps, which makes
  `--format json` byte-identical across runs.
- **Fixture hygiene.** Every test stages `test/fixtures/**` copies into a
  temp directory first and pins mtimes relative to the injected clock;
  nothing under `test/fixtures/` is ever modified (temp-dir writes only).
- **`test/index.js`** discovers the `*.test.js` files so the mandated
  `node --test test/` invocation runs the full suite on every supported Node
  version (modern Node treats a directory argument to `--test` as a literal
  path, so the directory provides its own runnable entry).

## v0 status

Implemented (the README's "v0 (weekend)" scope, SPEC §3–§6 for the cheap
tier):

- **Rule engine** — `Rule { id, title, severity, tier, fixable, docs,
  evaluate(ctx), fix?(ctx, finding) }`. Findings carry a newcomer-framed
  message, evidence, remediation, location, and a `fixable` flag. Every rule
  runs inside its own try/catch: a crashing rule is reported as a rule error
  (and excluded from the grade denominator) — it never aborts the scan.
- **Exactly 10 cheap-tier rules**, zero network, zero containers:

  | Rule | Check |
  |------|-------|
  | `community/license` | LICENSE at root + SPDX field in package.json/pyproject/Cargo.toml, consistent |
  | `community/contributing` | exists, ≤ 12 months stale (git log → file mtime fallback), has a getting-started section |
  | `community/code-of-conduct` | CODE_OF_CONDUCT.md present |
  | `community/security` | SECURITY.md / .github/SECURITY.md with a private contact channel |
  | `community/templates` | ≥ 1 issue template + a PR template |
  | `community/codeowners` | CODEOWNERS covers ≥ 80% of top-level paths |
  | `docs/readme-quickstart` | README has install + usage snippets in fences |
  | `docs/changelog` | exists + touched in the last 90 days |
  | `build/test-command` | one documented command runs tests (scripts.test / Makefile / README) |
  | `build/lockfile` | lockfile committed for each detected ecosystem |

- **Grading exactly per SPEC §5** — per-rule pass=1 / warning=.5 / fail=0;
  severity weights error 3 / warning 2 / info 1; group weights docs .20,
  build .25, ci .20, triage .20, community .15; the letter thresholds from
  the spec. Rules that didn't run (skipped, tier not selected, rule error)
  are **excluded from the denominator** and every report shows coverage:
  `Grade: A- (91.42) — 10/12 rules evaluated (83.3%)`. Because v0 has no
  ci/triage rules, present-group weights renormalize over the groups that
  actually ran — a grade never silently improves because checks vanished.
- **Reporters** — terminal (findings grouped by severity + newcomer
  narrative + grade + `dxlint fix` hint), `--format json` (stable schema,
  deterministic), `--format md`, and `dxlint badge` writing Shields JSON.
- **`--format github`** — GitHub Actions workflow commands: one
  `::error file=<path>,line=<line>,col=<col>,title=<ruleId>::<message>`
  annotation per finding (with GH `%%/%0D/%0A` escaping) plus a final
  `::notice::dxlint: <grade> grade, <N> findings` summary line
- **`dxlint fix`** — dry-run by default (lists the files it *would* create
  with content previews); `--apply` creates only missing files (LICENSE stub
  with an SPDX note, SECURITY.md, CODE_OF_CONDUCT.md, issue/PR templates),
  never edits existing prose, never deletes, and is idempotent — a second
  run is a no-op.
- **`dxlint explain <rule-id>`** and **`dxlint rules [--format json]`** over
  the full catalog.
- Exit codes: `0` pass · `1` findings at/above `--fail-on` · `2` usage.

**Deferred to v1 (documented, not silently dropped):** the api-tier
`triage/gfi-freshness` (needs the cached GitHub API) and the container-tier
`build/fresh-clone` (needs container probes) are declared in the catalog but
evaluate to *skipped* with a reason, are reported under "NOT EVALUATED", and
stay out of the grade denominator — so the default run honestly reports
`10/12 rules evaluated` at every `--tier`. Also not in v0: `sarif` format,
baseline/ratchet (`--baseline`, `--update-baseline`), `fix --pr`, `init`,
the Action wrapper, and `dxlint-rule-*` plugin discovery.

Tests: **87 passing** (`node --test test/`) — per-rule pass/fail fixture
pairs asserting exact findings, golden grade tests (A+ / A- / coverage
denominator cases), fix idempotence + dry-run-writes-nothing, rule-crash
isolation, and the determinism gate (two runs → identical JSON).

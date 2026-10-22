#!/usr/bin/env node
// dxlint CLI — subcommands: lint (default), fix, explain, rules, badge.
// Exit codes: 0 pass · 1 findings at/above --fail-on · 2 usage/config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { systemClock } from './clock.js';
import { createContext } from './context.js';
import { runScan, parseRuleFilter } from './engine.js';
import { computeGrade } from './grade.js';
import { ALL_RULES, getRule, groupOfRule } from './rules/index.js';
import { buildReport, renderJson } from './reporters/json.js';
import { renderTerminal } from './reporters/terminal.js';
import { renderMarkdown } from './reporters/md.js';
import { renderGithub } from './reporters/github.js';
import { renderBadge } from './reporters/badge.js';
import { planFixes, applyFixes } from './fix.js';

const COMMANDS = ['lint', 'fix', 'explain', 'rules', 'badge'];
const KNOWN_NOT_IMPLEMENTED = ['init', 'scan'];
const FORMATS = ['terminal', 'json', 'md', 'github'];
const TIERS = ['cheap', 'api', 'container'];
const FAIL_ON = ['error', 'warning', 'info', 'none'];
const SEVERITY_RANK = { info: 1, warning: 2, error: 3 };

class UsageError extends Error {}

export const TOOL_VERSION = readVersion();
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const SHORT_USAGE = `Try 'dxlint --help' for usage.`;

const HELP = `dxlint — the contributor experience linter

Usage:
  dxlint [path] [options]         lint a repository (default command)
  dxlint fix [path] [options]     create missing community files (dry-run by default)
  dxlint explain <rule-id>        show a rule's docs, rationale, and examples
  dxlint rules [--format json]    list the rule catalog
  dxlint badge [path] [--out f]   write a Shields.io badge JSON file

Options:
  --format terminal|json|md|github
                              report format (default: terminal; github emits
                              Actions workflow-command annotations)
  --output <file>             write the report to a file instead of stdout
  --fail-on <severity>        error|warning|info|none (default: error)
  --strict                    shorthand for --fail-on warning
  --rules <list>              comma-separated rule ids/globs; prefix ! to exclude
                              (e.g. --rules 'community/*,!community/license')
  --tier <tier>               cheap|api|container (default: cheap)
  --apply                     (fix) write the files; without it, fix is a dry run
  --dry-run                   (fix) force a dry run (the default)
  --out <file>                (badge) output path (default: <path>/dxlint-badge.json)
  -h, --help                  show help
  -V, --version               show version

Exit codes:
  0  pass (no findings at/above --fail-on)
  1  findings at/above --fail-on
  2  usage or configuration error

Examples:
  dxlint ./myrepo
  dxlint ./myrepo --format json --output dxlint.report.json
  dxlint fix ./myrepo --apply
  dxlint explain community/license
  dxlint badge ./myrepo --out badge.json
`;

function parseArgs(argv) {
  const out = {
    positionals: [],
    help: false,
    version: false,
    strict: false,
    apply: false,
    dryRun: false,
    format: null,
    output: null,
    failOn: null,
    rules: null,
    tier: null,
    out: null,
  };
  const valueFlags = {
    '--format': 'format',
    '--output': 'output',
    '--fail-on': 'failOn',
    '--rules': 'rules',
    '--tier': 'tier',
    '--out': 'out',
  };
  const boolFlags = {
    '--help': 'help',
    '-h': 'help',
    '--version': 'version',
    '-V': 'version',
    '--strict': 'strict',
    '--apply': 'apply',
    '--dry-run': 'dryRun',
  };

  let i = 0;
  while (i < argv.length) {
    let arg = argv[i];
    if (arg === '--') {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (arg in boolFlags) {
      if (inline !== undefined) throw new UsageError(`${arg} does not take a value`);
      out[boolFlags[arg]] = true;
      i += 1;
      continue;
    }
    if (arg in valueFlags) {
      let value;
      if (inline !== undefined) {
        value = inline;
      } else {
        value = argv[i + 1];
        if (value === undefined) throw new UsageError(`${arg} requires a value`);
        i += 1;
      }
      out[valueFlags[arg]] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option: ${arg}`);
    }
    out.positionals.push(arg);
    i += 1;
  }
  return out;
}

function resolveTarget(p) {
  const abs = path.resolve(p ?? process.cwd());
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new UsageError(`path does not exist: ${p}`);
  }
  if (!st.isDirectory()) throw new UsageError(`not a directory: ${p}`);
  return abs;
}

function pick(value, allowed, flag) {
  if (value === null || value === undefined) return null;
  if (!allowed.includes(value)) {
    throw new UsageError(`invalid value for ${flag}: ${value} (expected ${allowed.join('|')})`);
  }
  return value;
}

function exitCodeFor(findings, failOn) {
  if (failOn === 'none') return 0;
  const threshold = SEVERITY_RANK[failOn];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= threshold) ? 1 : 0;
}

async function runLint(args, io) {
  const format = pick(args.format, FORMATS, '--format') ?? 'terminal';
  const failOn = args.failOn ?? (args.strict ? 'warning' : 'error');
  pick(failOn, FAIL_ON, '--fail-on');
  const tier = pick(args.tier, TIERS, '--tier') ?? 'cheap';

  const targetArg = args.positionals[0] ?? null;
  const abs = resolveTarget(targetArg);
  const ctx = io.makeContext(abs);
  const scan = await runScan({
    rules: ALL_RULES,
    ctx,
    tier,
    ruleFilter: parseRuleFilter(args.rules),
  });
  const grade = computeGrade(scan.results);
  const report = buildReport({
    target: targetArg ?? '.',
    tier,
    toolVersion: TOOL_VERSION,
    scan,
    grade,
  });

  const text =
    format === 'json'
      ? renderJson(report)
      : format === 'md'
        ? renderMarkdown(report)
        : format === 'github'
          ? renderGithub(report)
          : renderTerminal(report);

  if (args.output) {
    fs.writeFileSync(args.output, text, 'utf8');
    io.stdout.write(`dxlint: report written to ${args.output}\n`);
  } else {
    io.stdout.write(text);
  }
  return exitCodeFor(scan.findings, failOn);
}

async function runFix(args, io) {
  const dryRun = !args.apply;
  const targetArg = args.positionals[0] ?? null;
  const abs = resolveTarget(targetArg);
  const ctx = io.makeContext(abs);
  const scan = await runScan({ rules: ALL_RULES, ctx, tier: 'cheap' });
  const { plan, errors } = await planFixes({ scan, ctx });

  for (const e of errors) {
    io.stderr.write(`dxlint: fix failed for ${e.ruleId}: ${e.error}\n`);
  }

  if (dryRun) {
    if (plan.length === 0) {
      io.stdout.write('dxlint fix: nothing to do — every mechanical fix is already applied.\n');
      return errors.length ? 2 : 0;
    }
    io.stdout.write(
      `dxlint fix: dry run — would create ${plan.length} file${plan.length === 1 ? '' : 's'}:\n\n`,
    );
    for (const item of plan) {
      io.stdout.write(`  + ${item.path}   (rule: ${item.ruleId})\n`);
      const lines = item.content.split('\n');
      const shown = lines.slice(0, 12);
      for (const line of shown) io.stdout.write(`      | ${line}\n`);
      if (lines.length > 12) io.stdout.write(`      | … (+${lines.length - 12} more lines)\n`);
      io.stdout.write('\n');
    }
    io.stdout.write('No files were written. Re-run with --apply to create them.\n');
    return errors.length ? 2 : 0;
  }

  const created = applyFixes(abs, plan);
  if (created.length === 0) {
    io.stdout.write('dxlint fix: nothing to do — every mechanical fix is already applied.\n');
  } else {
    io.stdout.write(`dxlint fix: created ${created.length} file${created.length === 1 ? '' : 's'}:\n`);
    for (const p of created) io.stdout.write(`  + ${p}\n`);
  }
  return errors.length ? 2 : 0;
}

async function runExplain(args, io) {
  const id = args.positionals[0];
  if (!id) throw new UsageError('explain requires a rule id (e.g. dxlint explain community/license)');
  const rule = getRule(id);
  if (!rule) {
    const hint = ALL_RULES.filter((r) => r.id.includes(id)).map((r) => r.id);
    throw new UsageError(
      `unknown rule: ${id}${hint.length ? `\ndid you mean: ${hint.join(', ')}` : ''}`,
    );
  }
  const fixable =
    rule.fixable === 'generate' ? 'generate (dxlint fix creates missing files)' : rule.fixable ? 'yes' : 'no';
  io.stdout.write(
    `${rule.id} — ${rule.title}\n` +
      `severity: ${rule.severity} · tier: ${rule.tier} · group: ${groupOfRule(rule)} · fixable: ${fixable}` +
      `${rule.deferred ? ' · status: deferred to v1' : ''}\n\n` +
      `${rule.docs}\n`,
  );
  return 0;
}

async function runRules(args, io) {
  const format = pick(args.format, ['terminal', 'json'], '--format') ?? 'terminal';
  const catalog = ALL_RULES.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    tier: r.tier,
    group: groupOfRule(r),
    fixable: r.fixable || false,
    deferred: !!r.deferred,
    summary: r.docs.split('\n')[0],
    docs: r.docs,
  }));
  if (format === 'json') {
    io.stdout.write(JSON.stringify(catalog, null, 2) + '\n');
    return 0;
  }  const idw = Math.max(...catalog.map((c) => c.id.length));
  for (const c of catalog) {
    const fix = c.fixable === 'generate' ? 'generate' : c.fixable ? 'fixable' : 'report';
    io.stdout.write(
      `${c.id.padEnd(idw)}  ${c.severity.padEnd(7)} ${c.tier.padEnd(9)} ${fix.padEnd(8)} ${c.title}\n`,
    );
  }
  const cheap = catalog.filter((c) => c.tier === 'cheap').length;
  const deferred = catalog.filter((c) => c.deferred).length;
  io.stdout.write(
    `\n${catalog.length} rules · ${cheap} cheap (v0) · ${deferred} deferred to v1 (api/container tiers)\n`,
  );
  return 0;
}

async function runBadge(args, io) {
  const targetArg = args.positionals[0] ?? null;
  const abs = resolveTarget(targetArg);
  const ctx = io.makeContext(abs);
  const scan = await runScan({ rules: ALL_RULES, ctx, tier: 'cheap' });
  const grade = computeGrade(scan.results);
  const outPath = path.resolve(args.out ?? path.join(abs, 'dxlint-badge.json'));
  fs.writeFileSync(outPath, renderBadge(grade.letter), 'utf8');
  io.stdout.write(`dxlint: wrote ${outPath} (grade ${grade.letter})\n`);
  return 0;
}

export async function main(argv, deps = {}) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    clock: deps.clock ?? systemClock,
    makeContext:
      deps.makeContext ??
      ((root) => createContext({ root, clock: deps.clock ?? systemClock })),
  };

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.stderr.write(`dxlint: ${err.message}\n${SHORT_USAGE}\n`);
    return 2;
  }

  if (args.version) {
    io.stdout.write(`dxlint ${TOOL_VERSION}\n`);
    return 0;
  }
  if (args.help) {
    io.stdout.write(HELP);
    return 0;
  }

  const first = args.positionals[0];
  let command = 'lint';
  let rest = args.positionals;
  if (COMMANDS.includes(first)) {
    command = first;
    rest = args.positionals.slice(1);
  } else if (KNOWN_NOT_IMPLEMENTED.includes(first)) {
    io.stderr.write(`dxlint: '${first}' is not implemented in v0 (see README "v0 status")\n${SHORT_USAGE}\n`);
    return 2;
  }
  args.positionals = rest;

  try {
    switch (command) {
      case 'lint':
        return await runLint(args, io);
      case 'fix':
        return await runFix(args, io);
      case 'explain':
        return await runExplain(args, io);
      case 'rules':
        return await runRules(args, io);
      case 'badge':
        return await runBadge(args, io);
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`dxlint: ${err.message}\n${SHORT_USAGE}\n`);
      return 2;
    }
    io.stderr.write(`dxlint: internal error: ${err instanceof Error ? err.stack : String(err)}\n`);
    return 2;
  }
}

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

const isDirectRun =
  process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url));
if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

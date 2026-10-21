// community/license — LICENSE at root + SPDX license field in manifests.
import { firstExisting, parseJson } from './util.js';

export const LICENSE_FILE_CANDIDATES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
];

const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml'];

/** Best-effort SPDX identifier detected from license text, or null. */
export function detectSpdx(text) {
  if (!text) return null;
  const t = text.slice(0, 200_000);
  // Explicit SPDX tag (dxlint stubs and modern manifests) wins.
  const header =
    /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+(?:\s+(?:OR|AND)\s+[A-Za-z0-9.+-]+)*)/i.exec(t);
  if (header) return header[1];
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return 'LGPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) {
    if (/Version 3/i.test(t)) return 'GPL-3.0';
    if (/Version 2/i.test(t)) return 'GPL-2.0';
    return 'GPL-3.0';
  }
  if (/Apache License/i.test(t) && /Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/Mozilla Public License/i.test(t)) return 'MPL-2.0';
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/"?MIT License"?/i.test(t)) return 'MIT';
  if (/Redistribution and use in source and binary forms/i.test(t)) {
    return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (/ISC License/i.test(t)) return 'ISC';
  return null;
}

/** Split an SPDX expression like "(MIT OR Apache-2.0)" into identifier tokens. */
export function spdxTokens(expression) {
  if (typeof expression !== 'string') return [];
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9.+-]+$/.test(s));
}

function looksLikeSpdx(expression) {
  const toks = spdxTokens(expression);
  return toks.length > 0 && toks.join(' ') === String(expression).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function readManifestLicense(ctx, manifestPath) {
  const text = ctx.fs.readFile(manifestPath);
  if (text === null) return { present: false };
  if (manifestPath.endsWith('.json')) {
    const { value, error } = parseJson(text);
    if (error || !value || typeof value !== 'object') return { present: true, invalid: true };
    const lic = value.license;
    return { present: true, value: typeof lic === 'string' && lic.trim() ? lic.trim() : null };
  }
  // TOML: license = "MIT"  |  license = { text = "MIT" }
  const simple = /^\s*license\s*=\s*"([^"]*)"\s*$/m.exec(text);
  if (simple) return { present: true, value: simple[1].trim() || null };
  const tabled = /^\s*license\s*=\s*\{[^}]*\btext\s*=\s*"([^"]*)"/m.exec(text);
  if (tabled) return { present: true, value: tabled[1].trim() || null };
  return { present: true, value: null };
}

export const licenseRule = {
  id: 'community/license',
  title: 'License file + SPDX manifest declaration',
  severity: 'error',
  tier: 'cheap',
  fixable: 'generate',
  docs: `Why: a newcomer who finds no LICENSE has to assume the worst — they
cannot legally use, fork, or contribute to your code, so they leave before
reading a single line.

What dxlint checks:
  1. A LICENSE file (LICENSE / LICENCE / COPYING, .md/.txt ok) exists at the
     repository root.
  2. Each package manifest present (package.json, pyproject.toml, Cargo.toml)
     declares a license field — only when that manifest exists.
  3. When both exist, the license text and the manifest's SPDX expression
     agree (best-effort text detection: MIT, Apache-2.0, BSD, GPL, MPL, ISC).

Pass example:
  LICENSE            (full MIT text)
  package.json       { "license": "MIT" }

Fail example:
  package.json       { "license": "MIT" }
  (no LICENSE file)  → "MIT is declared but no LICENSE file exists"

Fixable: \`dxlint fix --apply\` generates a LICENSE stub carrying the
SPDX identifier found in your manifest. It never rewrites an existing
license file.`,
  evaluate(ctx) {
    const findings = [];
    const licensePath = firstExisting(ctx, LICENSE_FILE_CANDIDATES);
    const licenseText = licensePath ? ctx.fs.readFile(licensePath) : null;
    const detected = licensePath ? detectSpdx(licenseText ?? '') : null;

    const declared = [];
    for (const m of MANIFESTS) {
      if (!ctx.fs.exists(m)) continue;
      declared.push({ path: m, ...readManifestLicense(ctx, m) });
    }

    if (!licensePath) {
      const withValue = declared.find((d) => d.value);
      findings.push({
        severity: 'error',
        message: 'This repository has no LICENSE file at its root',
        evidence: withValue
          ? `${withValue.path} declares "${withValue.value}" but no LICENSE file exists`
          : 'no LICENSE file and no manifest declares a license either',
        remediation:
          'Add a LICENSE file at the repository root with the full license text.',
        location: { path: 'LICENSE' },
        fixable: true,
      });
    }

    for (const d of declared) {
      if (!d.value && !d.invalid) {
        findings.push({
          severity: 'warning',
          message: `${d.path} exists but does not declare a license field`,
          evidence: `${d.path} has no SPDX license field`,
          remediation: `Add a "license" field with an SPDX identifier (e.g. "MIT") to ${d.path}.`,
          location: { path: d.path },
          fixable: false,
        });
        continue;
      }
      if (d.invalid) {
        findings.push({
          severity: 'warning',
          message: `${d.path} could not be parsed, so its license field was not checked`,
          evidence: `${d.path} is not valid JSON`,
          remediation: `Fix the syntax error in ${d.path} so dxlint can read its license field.`,
          location: { path: d.path },
          fixable: false,
        });
        continue;
      }
      if (!looksLikeSpdx(d.value)) {
        findings.push({
          severity: 'warning',
          message: `The license field in ${d.path} is not an SPDX identifier`,
          evidence: `${d.path} declares "${d.value}"`,
          remediation:
            'Use a standard SPDX expression (e.g. "MIT" or "Apache-2.0") so tooling can read it.',
          location: { path: d.path },
          fixable: false,
        });
        continue;
      }
      if (licensePath && detected) {
        const tokens = spdxTokens(d.value).map((t) => t.toUpperCase());
        if (!tokens.includes(detected.toUpperCase())) {
          findings.push({
            severity: 'error',
            message: `The LICENSE file and ${d.path} disagree about the license`,
            evidence: `${d.path} declares "${d.value}" but ${licensePath} looks like ${detected}`,
            remediation:
              'Make the LICENSE text and the manifest SPDX field match, then re-run dxlint.',
            location: { path: d.path },
            fixable: false,
          });
        }
      }
    }
    return findings;
  },

  /** Generates a LICENSE stub with an SPDX note. Creates only, never edits. */
  fix(ctx) {
    let spdx = 'NOASSERTION';
    let source = null;
    for (const m of MANIFESTS) {
      const r = readManifestLicense(ctx, m);
      if (r.value && looksLikeSpdx(r.value)) {
        spdx = spdxTokens(r.value).join(' OR ');
        source = m;
        break;
      }
    }
    const declaredNote = source
      ? `per the "license" field in \`${source}\``
      : 'no SPDX identifier was found in your package manifests';
    const content = `<!-- SPDX-License-Identifier: ${spdx} -->
# License

SPDX-License-Identifier: \`${spdx}\` (${declaredNote}).

> **dxlint-generated stub.** This file exists so tooling and contributors can
> see the declared license. Before publishing, replace this note with the full
> canonical license text (including the year and copyright holder) for
> \`${spdx}\`.
`;
    return { path: 'LICENSE', content };
  },
};

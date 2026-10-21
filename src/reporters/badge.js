// Badge reporter — Shields.io dynamic-card JSON (SPEC §6).
export const BADGE_COLORS = Object.freeze({
  'A+': 'brightgreen',
  A: 'brightgreen',
  'A-': 'green',
  'B+': 'green',
  B: 'green',
  'B-': 'yellowgreen',
  'C+': 'yellow',
  C: 'yellow',
  'C-': 'orange',
  D: 'red',
  F: 'red',
});

export function makeBadge(letter) {
  return {
    schemaVersion: 1,
    label: 'dxlint',
    message: letter,
    color: BADGE_COLORS[letter] ?? 'lightgrey',
  };
}

export function renderBadge(letter) {
  return JSON.stringify(makeBadge(letter), null, 2) + '\n';
}

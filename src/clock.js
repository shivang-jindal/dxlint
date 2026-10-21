// Injected clocks keep every rule deterministic under test.
export const systemClock = Object.freeze({
  now: () => new Date(),
});

/** A clock frozen at a fixed instant (ISO string or Date). */
export function fixedClock(isoOrDate) {
  const fixed = new Date(isoOrDate);
  if (Number.isNaN(fixed.getTime())) {
    throw new TypeError(`fixedClock: invalid date: ${isoOrDate}`);
  }
  return Object.freeze({
    now: () => new Date(fixed.getTime()),
  });
}

export const MS_PER_DAY = 86_400_000;

/** Whole days elapsed between `fromMs` and `to` (can be negative). */
export function daysBetween(fromMs, to) {
  return Math.floor((to.getTime() - fromMs) / MS_PER_DAY);
}

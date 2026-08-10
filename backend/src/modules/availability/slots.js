const dayjs = require("../../utils/dayjs");

/**
 * Converts free date ranges into a flat list of bookable start times.
 *
 * All arithmetic here is done in UTC explicitly (`.utc()` on every dayjs
 * object) rather than relying on dayjs's default "system local time"
 * interpretation. This matters because `range.start`/`range.end` are
 * plain JS Dates (absolute instants, no timezone attached) — without
 * `.utc()`, reading `.minute()`/`.second()` on them would be interpreted
 * in whatever timezone the NODE PROCESS happens to be configured for,
 * meaning `snapForward`'s "round to a clean :00/:15/:30/:45 boundary"
 * logic could silently produce different results depending on the
 * server's system timezone — the exact same booking data giving
 * different slot times in dev (often UTC) vs. production (wherever it's
 * deployed). Being explicit removes that class of bug entirely.
 *
 * @param {Array<{start: Date, end: Date}>} freeRanges - already has busy
 *   time subtracted out
 * @param {{ durationMinutes: number, intervalMinutes: number, minimumNoticeMinutes: number }} options
 * @returns {Date[]} sorted, deduplicated slot start times
 */
function buildSlots(freeRanges, { durationMinutes, intervalMinutes, minimumNoticeMinutes }) {
  const step = intervalMinutes || durationMinutes;
  const earliestAllowed = dayjs.utc().add(minimumNoticeMinutes, "minute");

  const slots = [];
  const seen = new Set();

  for (const range of freeRanges) {
    let candidate = dayjs.utc(range.start);
    const rangeEnd = dayjs.utc(range.end);

    // Snap the first candidate forward to the next clean `step` boundary
    // (in UTC) so slots line up on tidy times rather than whatever odd
    // minute the working-hours block happens to start on.
    candidate = snapForward(candidate, step);

    while (candidate.add(durationMinutes, "minute").isBefore(rangeEnd) ||
           candidate.add(durationMinutes, "minute").isSame(rangeEnd)) {
      if (candidate.isAfter(earliestAllowed) || candidate.isSame(earliestAllowed)) {
        const iso = candidate.toISOString();
        if (!seen.has(iso)) {
          seen.add(iso);
          slots.push(candidate.toDate());
        }
      }
      candidate = candidate.add(step, "minute");
    }
  }

  return slots.sort((a, b) => a - b);
}

/** Rounds a moment forward to the next multiple of `stepMinutes`, measured from the top of the hour. */
function snapForward(moment, stepMinutes) {
  const minutes = moment.minute();
  const remainder = minutes % stepMinutes;
  if (remainder === 0 && moment.second() === 0) return moment.startOf("minute");
  const toAdd = stepMinutes - remainder;
  return moment.add(toAdd, "minute").startOf("minute");
}

module.exports = { buildSlots };

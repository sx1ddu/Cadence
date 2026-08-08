const dayjs = require("dayjs");

/**
 * Converts free date ranges into a flat list of bookable start times.
 *
 * @param {Array<{start: Date, end: Date}>} freeRanges - already has busy
 *   time subtracted out
 * @param {{ durationMinutes: number, intervalMinutes: number, minimumNoticeMinutes: number }} options
 * @returns {Date[]} sorted, deduplicated slot start times
 */
function buildSlots(freeRanges, { durationMinutes, intervalMinutes, minimumNoticeMinutes }) {
  const step = intervalMinutes || durationMinutes;
  const earliestAllowed = dayjs().add(minimumNoticeMinutes, "minute");

  const slots = [];
  const seen = new Set();

  for (const range of freeRanges) {
    let candidate = dayjs(range.start);
    const rangeEnd = dayjs(range.end);

    // Snap the first candidate forward to the next clean `step` boundary
    // so slots line up on nice times (e.g. :00/:15/:30/:45) rather than
    // whatever odd minute the working-hours block happens to start on.
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

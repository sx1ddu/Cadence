const dayjs = require("../../utils/dayjs");

/**
 * Pure interval-arithmetic helpers for computing free time.
 *
 * Every range in this file is `{ start: Date, end: Date }` in UTC. Working
 * in UTC internally (and only converting to/from a human timezone at the
 * edges — when reading the schedule's weekly rules and when presenting
 * slots to the client) avoids a whole class of DST bugs that show up if
 * you do arithmetic directly in a local timezone.
 */

/**
 * Expands a schedule's weekly rules + date overrides into concrete
 * UTC date ranges covering every day between `fromDate` and `toDate`
 * (inclusive), in the schedule's timezone.
 *
 * @param {{rules: Array<{days:number[], startTime:string, endTime:string}>,
 *          overrides: Array<{date:string, isUnavailable:boolean, startTime?:string, endTime?:string}>,
 *          timezone: string}} schedule
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {Array<{start: Date, end: Date}>}
 */
function buildDateRanges(schedule, fromDate, toDate) {
  const { rules, overrides, timezone: tz } = schedule;
  const overridesByDate = new Map(overrides.map((o) => [o.date, o]));

  const ranges = [];
  let cursor = dayjs(fromDate).tz(tz).startOf("day");
  // `toDate` is an EXCLUSIVE upper bound throughout this codebase — every
  // caller constructs it as "midnight of the day AFTER the last day
  // wanted" (e.g. availability.controller.js does
  // `toDate.setUTCDate(toDate.getUTCDate() + 1)`). Using `.endOf("day")`
  // on toDate here would process one extra, unrequested day beyond that
  // boundary — exactly the kind of off-by-one that's easy to miss by
  // reading the code and only caught by actually running a test against
  // it. Comparing directly against toDate (no endOf) respects the
  // exclusive contract precisely.
  const end = dayjs(toDate).tz(tz);

  while (cursor.isBefore(end)) {
    const dateKey = cursor.format("YYYY-MM-DD");
    const override = overridesByDate.get(dateKey);

    if (override) {
      if (!override.isUnavailable) {
        ranges.push(buildRangeForDay(cursor, override.startTime, override.endTime, tz));
      }
      // if isUnavailable, this day contributes no range at all (day off)
    } else {
      const weekday = cursor.day(); // 0=Sunday..6=Saturday, matches our `days` convention
      for (const rule of rules) {
        if (rule.days.includes(weekday)) {
          ranges.push(buildRangeForDay(cursor, rule.startTime, rule.endTime, tz));
        }
      }
    }

    cursor = cursor.add(1, "day");
  }

  return mergeOverlapping(ranges.sort((a, b) => a.start - b.start));
}

function buildRangeForDay(dayCursor, startTime, endTime, tz) {
  const dateKey = dayCursor.format("YYYY-MM-DD");
  const start = dayjs.tz(`${dateKey} ${startTime}`, tz).toDate();
  const end = dayjs.tz(`${dateKey} ${endTime}`, tz).toDate();
  return { start, end };
}

/** Merges overlapping/adjacent ranges. Input must already be sorted by start. */
function mergeOverlapping(ranges) {
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Subtracts `busyRanges` from `freeRanges`, returning what's left.
 * Both inputs must be sorted by start time.
 */
function subtractRanges(freeRanges, busyRanges) {
  if (busyRanges.length === 0) return freeRanges.map((r) => ({ ...r }));

  let result = freeRanges.map((r) => ({ ...r }));

  for (const busy of busyRanges) {
    const next = [];
    for (const free of result) {
      // No overlap at all
      if (busy.end <= free.start || busy.start >= free.end) {
        next.push(free);
        continue;
      }
      // Busy fully covers free -> free range disappears
      if (busy.start <= free.start && busy.end >= free.end) {
        continue;
      }
      // Busy overlaps the start of free -> keep the tail
      if (busy.start <= free.start && busy.end < free.end) {
        next.push({ start: busy.end, end: free.end });
        continue;
      }
      // Busy overlaps the end of free -> keep the head
      if (busy.start > free.start && busy.end >= free.end) {
        next.push({ start: free.start, end: busy.start });
        continue;
      }
      // Busy is strictly inside free -> split into two ranges
      next.push({ start: free.start, end: busy.start });
      next.push({ start: busy.end, end: free.end });
    }
    result = next;
  }

  return result;
}

/**
 * Intersects two sorted lists of ranges — returns only the overlapping
 * portions. Used for COLLECTIVE team events, where a slot is only
 * bookable if EVERY assigned host is free at that time.
 */
function intersectRanges(rangesA, rangesB) {
  const result = [];
  let i = 0;
  let j = 0;

  while (i < rangesA.length && j < rangesB.length) {
    const a = rangesA[i];
    const b = rangesB[j];

    const start = a.start > b.start ? a.start : b.start;
    const end = a.end < b.end ? a.end : b.end;

    if (start < end) {
      result.push({ start, end });
    }

    // Advance whichever range ends first — it can't overlap anything further.
    if (a.end < b.end) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return result;
}

/** Intersects free ranges across ANY number of hosts (all must be free at once). */
function intersectAll(rangeLists) {
  if (rangeLists.length === 0) return [];
  return rangeLists.reduce((acc, ranges) => intersectRanges(acc, ranges));
}

/** Unions free ranges across ANY number of hosts (any single host being free is enough) — used for ROUND_ROBIN. */
function unionAll(rangeLists) {
  const all = rangeLists.flat().sort((a, b) => a.start - b.start);
  return mergeOverlapping(all);
}

/**
 * Pulls each free range's edges inward by `beforeMinutes`/`afterMinutes`.
 *
 * This is how a booking's OWN buffer preference gets enforced: if event
 * type X wants a 15-minute buffer before every meeting, then a candidate
 * meeting start time needs 15 free minutes immediately before it too, not
 * just an empty calendar at the meeting's own start/end. Shrinking the
 * free range first means the existing buildSlots() duration-fitting logic
 * automatically respects this without needing to know about buffers at all.
 */
function shrinkRanges(ranges, beforeMinutes, afterMinutes) {
  const beforeMs = (beforeMinutes || 0) * 60 * 1000;
  const afterMs = (afterMinutes || 0) * 60 * 1000;
  if (beforeMs === 0 && afterMs === 0) return ranges.map((r) => ({ ...r }));

  const shrunk = [];
  for (const range of ranges) {
    const start = new Date(range.start.getTime() + beforeMs);
    const end = new Date(range.end.getTime() - afterMs);
    if (start < end) shrunk.push({ start, end });
  }
  return shrunk;
}

module.exports = {
  buildDateRanges,
  subtractRanges,
  mergeOverlapping,
  intersectRanges,
  intersectAll,
  unionAll,
  shrinkRanges,
};

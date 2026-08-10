const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDateRanges,
  subtractRanges,
  intersectRanges,
  intersectAll,
  unionAll,
  shrinkRanges,
  mergeOverlapping,
} = require("../../src/modules/availability/dateRanges");

describe("buildDateRanges", () => {
  test("expands a simple Mon-Fri 9-5 rule into daily UTC ranges", () => {
    const schedule = {
      timezone: "UTC",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [],
    };
    // 2026-01-05 is a Monday
    const ranges = buildDateRanges(schedule, new Date("2026-01-05T00:00:00Z"), new Date("2026-01-06T00:00:00Z"));
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].start.toISOString(), "2026-01-05T09:00:00.000Z");
    assert.equal(ranges[0].end.toISOString(), "2026-01-05T17:00:00.000Z");
  });

  test("excludes weekends when only weekdays are configured", () => {
    const schedule = {
      timezone: "UTC",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [],
    };
    // 2026-01-10 is a Saturday, 2026-01-11 is a Sunday
    const ranges = buildDateRanges(schedule, new Date("2026-01-10T00:00:00Z"), new Date("2026-01-12T00:00:00Z"));
    assert.equal(ranges.length, 0);
  });

  test("a date override marked unavailable removes that day entirely, even if it's a normal working day", () => {
    const schedule = {
      timezone: "UTC",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [{ date: "2026-01-05", isUnavailable: true }],
    };
    const ranges = buildDateRanges(schedule, new Date("2026-01-05T00:00:00Z"), new Date("2026-01-06T00:00:00Z"));
    assert.equal(ranges.length, 0);
  });

  test("a date override with custom hours REPLACES the normal rule for that day", () => {
    const schedule = {
      timezone: "UTC",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [{ date: "2026-01-05", isUnavailable: false, startTime: "12:00", endTime: "14:00" }],
    };
    const ranges = buildDateRanges(schedule, new Date("2026-01-05T00:00:00Z"), new Date("2026-01-06T00:00:00Z"));
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].start.toISOString(), "2026-01-05T12:00:00.000Z");
    assert.equal(ranges[0].end.toISOString(), "2026-01-05T14:00:00.000Z");
  });

  test("timezone conversion: a 9-5 in America/New_York becomes the correct UTC offset (EST, UTC-5)", () => {
    const schedule = {
      timezone: "America/New_York",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [],
    };
    // 2026-01-05 (January -> EST, UTC-5, no DST)
    const ranges = buildDateRanges(schedule, new Date("2026-01-05T00:00:00Z"), new Date("2026-01-06T00:00:00Z"));
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].start.toISOString(), "2026-01-05T14:00:00.000Z"); // 09:00 EST = 14:00 UTC
    assert.equal(ranges[0].end.toISOString(), "2026-01-05T22:00:00.000Z"); // 17:00 EST = 22:00 UTC
  });

  test("DST correctness: the same 9-5 America/New_York schedule shifts to EDT (UTC-4) after the spring-forward transition", () => {
    const schedule = {
      timezone: "America/New_York",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
      overrides: [],
    };
    // US DST starts 2026-03-08 (second Sunday of March). 2026-03-09 is the Monday after.
    const ranges = buildDateRanges(schedule, new Date("2026-03-09T00:00:00Z"), new Date("2026-03-10T00:00:00Z"));
    assert.equal(ranges.length, 1);
    // 09:00 EDT = 13:00 UTC (not 14:00, which would be the pre-DST offset — this is
    // exactly the bug class that arises from doing naive UTC+fixed-offset arithmetic
    // instead of proper per-day timezone localization).
    assert.equal(ranges[0].start.toISOString(), "2026-03-09T13:00:00.000Z");
    assert.equal(ranges[0].end.toISOString(), "2026-03-09T21:00:00.000Z");
  });

  test("DST correctness: a schedule spanning the spring-forward day itself still produces a valid, non-negative-length range", () => {
    const schedule = {
      timezone: "America/New_York",
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "17:00" }],
      overrides: [],
    };
    // 2026-03-08 is the DST transition day itself (2am -> 3am skip).
    // Bounds are precise local-midnight UTC instants (05:00 UTC = EST
    // midnight before the transition, 04:00 UTC the next day = EDT
    // midnight after it) so this test isolates the DST-transition
    // concern specifically, rather than also depending on how a plain
    // UTC calendar-day boundary maps onto this timezone's local days
    // (a separate concern, handled by the caller — see
    // availability.service.js's widen-then-filter comment).
    const ranges = buildDateRanges(
      schedule,
      new Date("2026-03-08T05:00:00Z"),
      new Date("2026-03-09T04:00:00Z")
    );
    assert.equal(ranges.length, 1);
    assert.ok(ranges[0].end > ranges[0].start, "range end must be after range start even on the transition day");
    // 9am-5pm doesn't touch the 2am-3am skip, so duration should still be exactly 8 hours
    const durationHours = (ranges[0].end - ranges[0].start) / (1000 * 60 * 60);
    assert.equal(durationHours, 8);
  });
});

describe("subtractRanges", () => {
  test("removes a busy range that's fully inside a free range, splitting it in two", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T17:00:00Z") }];
    const busy = [{ start: new Date("2026-01-05T12:00:00Z"), end: new Date("2026-01-05T13:00:00Z") }];
    const result = subtractRanges(free, busy);
    assert.equal(result.length, 2);
    assert.equal(result[0].end.toISOString(), "2026-01-05T12:00:00.000Z");
    assert.equal(result[1].start.toISOString(), "2026-01-05T13:00:00.000Z");
  });

  test("a busy range fully covering a free range removes it completely", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T10:00:00Z") }];
    const busy = [{ start: new Date("2026-01-05T08:00:00Z"), end: new Date("2026-01-05T11:00:00Z") }];
    const result = subtractRanges(free, busy);
    assert.equal(result.length, 0);
  });

  test("a busy range with no overlap leaves the free range untouched", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T10:00:00Z") }];
    const busy = [{ start: new Date("2026-01-05T14:00:00Z"), end: new Date("2026-01-05T15:00:00Z") }];
    const result = subtractRanges(free, busy);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], free[0]);
  });
});

describe("intersectRanges / intersectAll (collective events)", () => {
  test("two overlapping ranges intersect to their common window", () => {
    const a = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T13:00:00Z") }];
    const b = [{ start: new Date("2026-01-05T11:00:00Z"), end: new Date("2026-01-05T17:00:00Z") }];
    const result = intersectRanges(a, b);
    assert.equal(result.length, 1);
    assert.equal(result[0].start.toISOString(), "2026-01-05T11:00:00.000Z");
    assert.equal(result[0].end.toISOString(), "2026-01-05T13:00:00.000Z");
  });

  test("no overlap between two hosts' free time means zero collective slots", () => {
    const a = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T11:00:00Z") }];
    const b = [{ start: new Date("2026-01-05T13:00:00Z"), end: new Date("2026-01-05T15:00:00Z") }];
    assert.equal(intersectRanges(a, b).length, 0);
  });

  test("intersectAll across three hosts only keeps time free for ALL of them", () => {
    const host1 = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T17:00:00Z") }];
    const host2 = [{ start: new Date("2026-01-05T10:00:00Z"), end: new Date("2026-01-05T16:00:00Z") }];
    const host3 = [{ start: new Date("2026-01-05T11:00:00Z"), end: new Date("2026-01-05T14:00:00Z") }];
    const result = intersectAll([host1, host2, host3]);
    assert.equal(result.length, 1);
    assert.equal(result[0].start.toISOString(), "2026-01-05T11:00:00.000Z");
    assert.equal(result[0].end.toISOString(), "2026-01-05T14:00:00.000Z");
  });
});

describe("unionAll (round-robin events)", () => {
  test("any one host being free is enough — union covers both hosts' time", () => {
    const host1 = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T11:00:00Z") }];
    const host2 = [{ start: new Date("2026-01-05T13:00:00Z"), end: new Date("2026-01-05T15:00:00Z") }];
    const result = unionAll([host1, host2]);
    assert.equal(result.length, 2);
  });

  test("overlapping host free ranges merge into one continuous range", () => {
    const host1 = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T12:00:00Z") }];
    const host2 = [{ start: new Date("2026-01-05T11:00:00Z"), end: new Date("2026-01-05T15:00:00Z") }];
    const result = unionAll([host1, host2]);
    assert.equal(result.length, 1);
    assert.equal(result[0].start.toISOString(), "2026-01-05T09:00:00.000Z");
    assert.equal(result[0].end.toISOString(), "2026-01-05T15:00:00.000Z");
  });
});

describe("shrinkRanges (buffers)", () => {
  test("shrinks a free range inward by bufferBefore and bufferAfter minutes", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T17:00:00Z") }];
    const result = shrinkRanges(free, 15, 30);
    assert.equal(result.length, 1);
    assert.equal(result[0].start.toISOString(), "2026-01-05T09:15:00.000Z");
    assert.equal(result[0].end.toISOString(), "2026-01-05T16:30:00.000Z");
  });

  test("a range too short to survive its own buffers is dropped entirely", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T09:20:00Z") }];
    const result = shrinkRanges(free, 15, 15); // needs 30 min of buffer but the range is only 20 min long
    assert.equal(result.length, 0);
  });

  test("zero buffers leave the range unchanged", () => {
    const free = [{ start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T17:00:00Z") }];
    const result = shrinkRanges(free, 0, 0);
    assert.deepEqual(result, free);
  });
});

describe("mergeOverlapping", () => {
  test("adjacent ranges (end === next start) merge into one", () => {
    const ranges = [
      { start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T10:00:00Z") },
      { start: new Date("2026-01-05T10:00:00Z"), end: new Date("2026-01-05T11:00:00Z") },
    ];
    const result = mergeOverlapping(ranges);
    assert.equal(result.length, 1);
    assert.equal(result[0].start.toISOString(), "2026-01-05T09:00:00.000Z");
    assert.equal(result[0].end.toISOString(), "2026-01-05T11:00:00.000Z");
  });

  test("non-adjacent ranges stay separate", () => {
    const ranges = [
      { start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T10:00:00Z") },
      { start: new Date("2026-01-05T10:30:00Z"), end: new Date("2026-01-05T11:00:00Z") },
    ];
    const result = mergeOverlapping(ranges);
    assert.equal(result.length, 2);
  });
});

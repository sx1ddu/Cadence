const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildSlots } = require("../../src/modules/availability/slots");
const { shrinkRanges } = require("../../src/modules/availability/dateRanges");

// Fixed, clearly-future, clean-30-minute-boundary timestamps — deliberately
// NOT relative to Date.now(), so these tests are deterministic no matter
// what second/minute they happen to run at, and don't depend on "now"
// drifting relative to a hardcoded date over time.
const FAR_FUTURE_START = new Date("2099-06-15T09:00:00.000Z");

describe("buildSlots", () => {
  test("produces slots at the requested interval across a free range", () => {
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 2 * 60 * 60 * 1000) }];
    const slots = buildSlots(free, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    // A clean 2-hour window with 30-min slots (start already on a 30-min
    // boundary, so no snapping loss): 09:00, 09:30, 10:00, 10:30 = 4 slots.
    assert.equal(slots.length, 4);
    assert.equal(slots[0].toISOString(), "2099-06-15T09:00:00.000Z");
    assert.equal(slots[3].toISOString(), "2099-06-15T10:30:00.000Z");
  });

  test("minimum notice excludes slots that are too soon", () => {
    // minimumNoticeMinutes is measured from the ACTUAL current time, so
    // with a far-future range and a 120-minute notice requirement, every
    // slot in the range clears the notice bar easily — this test instead
    // checks the boundary logic directly: a huge notice requirement (bigger
    // than the whole range) should produce zero slots.
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 60 * 60 * 1000) }];
    const hugeNoticeMinutes = 100 * 365 * 24 * 60; // 100 years — guaranteed to exceed "now" to 2099
    const slots = buildSlots(free, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: hugeNoticeMinutes });
    assert.equal(slots.length, 0);
  });

  test("a free range shorter than the event duration produces no slots", () => {
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 10 * 60 * 1000) }]; // only 10 minutes free
    const slots = buildSlots(free, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    assert.equal(slots.length, 0);
  });

  test("interval defaults to duration when not explicitly set", () => {
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 90 * 60 * 1000) }]; // 90 minutes free
    const slots = buildSlots(free, { durationMinutes: 45, intervalMinutes: null, minimumNoticeMinutes: 0 });
    // 90 minutes / 45-minute steps, starting exactly on a clean boundary = exactly 2 slots
    assert.equal(slots.length, 2);
  });

  test("buffers (via shrinkRanges) reduce the usable window before slots are cut", () => {
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 60 * 60 * 1000) }]; // exactly 60 minutes free
    const withoutBuffers = buildSlots(free, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    assert.equal(withoutBuffers.length, 2);

    // A 20-minute buffer on each side leaves only 20 minutes of USABLE
    // space (60 - 20 - 20) — not enough for even one 30-minute meeting.
    const shrunk = shrinkRanges(free, 20, 20);
    const withBuffers = buildSlots(shrunk, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    assert.equal(withBuffers.length, 0);
  });

  test("a modest buffer still allows fewer, correctly-spaced slots", () => {
    const free = [{ start: FAR_FUTURE_START, end: new Date(FAR_FUTURE_START.getTime() + 90 * 60 * 1000) }]; // 90 minutes free
    // 10-minute buffer on each side leaves a USABLE window of [09:10, 10:20).
    // snapForward then rounds the first candidate to the next clean
    // clock boundary (:00/:30) — NOT to the buffered window's own start —
    // so the first candidate becomes 09:30, not 09:10. That means the
    // buffer's real-world cost here is 20 minutes lost at the front (10
    // minutes of buffer + 20 more to reach the next clean boundary), and
    // only one 30-minute slot fits: [09:30, 10:00). This is expected,
    // intentional behavior (round start times are worth more than
    // squeezing in the exact last minute of usable buffer), but it's
    // worth a reader noticing that "buffer minutes" and "minutes actually
    // lost" aren't always identical.
    const shrunk = shrinkRanges(free, 10, 10);
    const slots = buildSlots(shrunk, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    assert.equal(slots.length, 1);
    assert.equal(slots[0].toISOString(), "2099-06-15T09:30:00.000Z");
  });

  test("slot times are deterministic regardless of process timezone (uses UTC internally)", () => {
    // This directly guards against the bug where dayjs() without .utc()
    // reads .minute()/.second() in the SERVER's local timezone, which
    // would make snap-to-boundary behavior depend on system config.
    const start = new Date("2099-06-15T09:07:00.000Z"); // deliberately NOT on a clean boundary
    const free = [{ start, end: new Date("2099-06-15T11:00:00.000Z") }];
    const slots = buildSlots(free, { durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0 });
    // Should snap forward to the next clean 30-minute UTC boundary: 09:30, not 09:07 or some
    // server-timezone-shifted equivalent.
    assert.ok(slots.length > 0, "expected at least one slot");
    assert.equal(slots[0].toISOString(), "2099-06-15T09:30:00.000Z");
  });
});

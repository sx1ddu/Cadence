const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createLoggedInUser, createEventType, daysFromNowStr } = require("./helpers/testUtils");

describe("Redis cache invalidation", () => {
  test("a booked slot disappears from the slots list immediately, not after the cache TTL", async () => {
    const { client, user } = await createLoggedInUser("cacheinvalidate");
    await client.post("/api/schedules", {
      name: "Open",
      timezone: "UTC",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:45" }],
    });
    const eventType = await createEventType(client, { requiresConfirmation: false, slotIntervalMinutes: 30 });
    const date = daysFromNowStr(9);

    // First request populates the 30-second Redis cache.
    const before = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const slotsBefore = Object.values(before.body.data.slots).flat();
    assert.ok(slotsBefore.length > 0, "expected at least one slot before booking");
    const targetSlot = slotsBefore[0];

    const bookRes = await client.post("/api/bookings", {
      username: user.username,
      eventTypeSlug: eventType.slug,
      startTime: targetSlot,
      attendeeName: "Cache Tester",
      attendeeEmail: `cachetest-${Date.now()}@example.com`,
      attendeeTimezone: "UTC",
      locationType: "phone",
      answers: {},
    });
    assert.equal(bookRes.status, 201);

    // Re-request IMMEDIATELY (well within the 30s TTL). If invalidation
    // weren't working, this would still show the now-booked slot as free
    // for up to 30 seconds.
    const after = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const slotsAfter = Object.values(after.body.data.slots).flat();
    assert.ok(
      !slotsAfter.includes(targetSlot),
      "the just-booked slot should not appear as available immediately after booking"
    );
  });

  test("a cancelled booking's slot becomes available again immediately", async () => {
    const { client, user } = await createLoggedInUser("cacheinvalidatecancel");
    await client.post("/api/schedules", {
      name: "Open",
      timezone: "UTC",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:45" }],
    });
    const eventType = await createEventType(client, { requiresConfirmation: false, slotIntervalMinutes: 30 });
    const date = daysFromNowStr(9);

    const before = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const targetSlot = Object.values(before.body.data.slots).flat()[0];

    const bookRes = await client.post("/api/bookings", {
      username: user.username,
      eventTypeSlug: eventType.slug,
      startTime: targetSlot,
      attendeeName: "Cache Tester 2",
      attendeeEmail: `cachetest2-${Date.now()}@example.com`,
      attendeeTimezone: "UTC",
      locationType: "phone",
      answers: {},
    });
    assert.equal(bookRes.status, 201);

    await client.post(`/api/bookings/${bookRes.body.data.booking.id}/cancel`, { reason: "test cleanup" });

    const after = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const slotsAfter = Object.values(after.body.data.slots).flat();
    assert.ok(
      slotsAfter.includes(targetSlot),
      "the slot should become available again immediately after cancellation"
    );
  });
});

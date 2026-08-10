const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("./helpers/client");
const { createLoggedInUser, createEventType, daysFromNowStr } = require("./helpers/testUtils");

/** Sets up a host with a wide-open 24/7 UTC schedule, so tests don't need to reason about working hours. */
async function createHostWithOpenSchedule(prefix) {
  const { client, user } = await createLoggedInUser(prefix);
  await client.post("/api/schedules", {
    name: "Always Open",
    timezone: "UTC",
    isDefault: true,
    rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:45" }],
  });
  return { client, user };
}

async function getFirstAvailableSlot(client, username, slug, dateStr) {
  const res = await client.get(
    `/api/users/${username}/event-types/${slug}/slots?from=${dateStr}&to=${dateStr}&timezone=UTC`
  );
  assert.equal(res.status, 200);
  const allSlots = Object.values(res.body.data.slots).flat();
  assert.ok(allSlots.length > 0, `expected at least one slot on ${dateStr}`);
  return allSlots[0];
}

function bookingPayload(username, slug, startTime, overrides = {}) {
  return {
    username,
    eventTypeSlug: slug,
    startTime,
    attendeeName: "Jane Booker",
    attendeeEmail: `booker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    attendeeTimezone: "UTC",
    locationType: "phone",
    answers: {},
    ...overrides,
  };
}

describe("Booking Engine", () => {
  test("creates a confirmed booking when the event type doesn't require confirmation", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookok");
    const eventType = await createEventType(client, { requiresConfirmation: false });
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    assert.equal(bookRes.status, 201);
    assert.equal(bookRes.body.data.booking.status, "confirmed");
  });

  test("creates a pending booking when the event type requires confirmation, then the host can confirm it", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookconfirm");
    const eventType = await createEventType(client, { requiresConfirmation: true });
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    assert.equal(bookRes.status, 201);
    assert.equal(bookRes.body.data.booking.status, "pending");

    const confirmRes = await client.post(`/api/bookings/${bookRes.body.data.booking.id}/confirm`);
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.booking.status, "confirmed");
  });

  test("the host can reject a pending booking", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookreject");
    const eventType = await createEventType(client, { requiresConfirmation: true });
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const rejectRes = await client.post(`/api/bookings/${bookRes.body.data.booking.id}/reject`, {
      reason: "Not available after all",
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.data.booking.status, "rejected");
  });

  test("a booking can be cancelled by the attendee via the public endpoint (no auth needed)", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookcancelpublic");
    const eventType = await createEventType(client);
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const bookingId = bookRes.body.data.booking.id;

    const anonymousClient = createClient(); // no login at all
    const cancelRes = await anonymousClient.post(`/api/bookings/public/${bookingId}/cancel`, {
      reason: "Can't make it",
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.booking.status, "cancelled");
  });

  test("the host can cancel a booking they own", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookcancelhost");
    const eventType = await createEventType(client);
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const cancelRes = await client.post(`/api/bookings/${bookRes.body.data.booking.id}/cancel`, {
      reason: "Reschedule needed",
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.booking.status, "cancelled");
  });

  test("a different host cannot cancel someone else's booking (authorization check)", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookownercheck");
    const other = await createLoggedInUser("otherhost");
    const eventType = await createEventType(client);
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const bookRes = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const cancelAttempt = await other.client.post(`/api/bookings/${bookRes.body.data.booking.id}/cancel`, {});
    assert.equal(cancelAttempt.status, 403);
  });

  test("double-booking the exact same slot is rejected once the first booking succeeds", async () => {
    const { client, user } = await createHostWithOpenSchedule("doublebook");
    const eventType = await createEventType(client);
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const first = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    assert.equal(first.status, 201);

    const second = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    assert.equal(second.status, 409, "the second booking of the same slot must be rejected as a conflict");
  });

  test("concurrent booking attempts for the same slot: exactly one succeeds", async () => {
    const { client, user } = await createHostWithOpenSchedule("concurrentbook");
    const eventType = await createEventType(client);
    const date = daysFromNowStr(6);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    // Fire off several requests for the SAME slot at the same time — this
    // is the actual test of the FOR UPDATE transactional lock, not just
    // the "second request after the first completes" case above.
    const attempts = 5;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot))
      )
    );

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(successes.length, 1, `expected exactly 1 success out of ${attempts} concurrent attempts, got ${successes.length}`);
    assert.equal(conflicts.length, attempts - 1);
  });

  test("group event (seats): multiple attendees can book the identical slot up to capacity, then it's rejected", async () => {
    const { client, user } = await createHostWithOpenSchedule("seatsevent");
    const eventType = await createEventType(client, {
      requiresConfirmation: false,
      seatsPerSlot: 2,
    });
    const date = daysFromNowStr(7);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const first = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const second = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));
    const third = await client.post("/api/bookings", bookingPayload(user.username, eventType.slug, slot));

    assert.equal(first.status, 201);
    assert.equal(second.status, 201, "second attendee should fit within the 2-seat capacity");
    assert.equal(third.status, 409, "third attendee should be rejected once capacity is full");
  });

  test("booking limits: a per-day cap is enforced", async () => {
    const { client, user } = await createHostWithOpenSchedule("bookinglimit");
    const eventType = await createEventType(client, {
      requiresConfirmation: false,
      bookingLimitCount: 1,
      bookingLimitWindow: "day",
    });
    const date = daysFromNowStr(8);

    const res = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const allSlots = Object.values(res.body.data.slots).flat();
    assert.ok(allSlots.length >= 2, "need at least 2 distinct slots on this day to test the limit meaningfully");

    const first = await client.post(
      "/api/bookings",
      bookingPayload(user.username, eventType.slug, allSlots[0])
    );
    assert.equal(first.status, 201);

    const second = await client.post(
      "/api/bookings",
      bookingPayload(user.username, eventType.slug, allSlots[1])
    );
    assert.equal(second.status, 400, "a second booking on the same day should be rejected by the daily limit");
  });

  test("a booking rejects an invalid location type not offered by the event type", async () => {
    const { client, user } = await createHostWithOpenSchedule("badlocation");
    const eventType = await createEventType(client, { locations: [{ type: "phone" }] });
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const res = await client.post(
      "/api/bookings",
      bookingPayload(user.username, eventType.slug, slot, { locationType: "google_meet" })
    );
    assert.equal(res.status, 400);
  });

  test("a required booking question must be answered", async () => {
    const { client, user } = await createHostWithOpenSchedule("requiredquestion");
    const eventType = await createEventType(client, {
      bookingQuestions: [{ id: "notes", label: "Anything to share?", type: "text", required: true }],
    });
    const date = daysFromNowStr(5);
    const slot = await getFirstAvailableSlot(client, user.username, eventType.slug, date);

    const res = await client.post(
      "/api/bookings",
      bookingPayload(user.username, eventType.slug, slot, { answers: {} })
    );
    assert.equal(res.status, 400);
  });
});

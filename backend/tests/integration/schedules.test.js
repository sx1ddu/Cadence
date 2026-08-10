const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createLoggedInUser, createEventType, daysFromNowStr } = require("./helpers/testUtils");

describe("Schedules & Availability", () => {
  test("creating the first schedule automatically makes it the default", async () => {
    const { client } = await createLoggedInUser("sched1");
    const res = await client.post("/api/schedules", {
      name: "Working Hours",
      timezone: "UTC",
      rules: [{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.schedule.isDefault, true);
  });

  test("a second schedule is NOT default unless explicitly requested", async () => {
    const { client } = await createLoggedInUser("sched2");
    await client.post("/api/schedules", { name: "First", timezone: "UTC", rules: [] });
    const second = await client.post("/api/schedules", { name: "Second", timezone: "UTC", rules: [] });
    assert.equal(second.body.data.schedule.isDefault, false);
  });

  test("deleting the default schedule is blocked", async () => {
    const { client } = await createLoggedInUser("sched3");
    const created = await client.post("/api/schedules", { name: "Only One", timezone: "UTC", rules: [] });
    const scheduleId = created.body.data.schedule.id;
    const del = await client.delete(`/api/schedules/${scheduleId}`);
    assert.equal(del.status, 400);
  });

  test("a schedule can't be read or edited by a different user (ownership check)", async () => {
    const owner = await createLoggedInUser("schedowner");
    const intruder = await createLoggedInUser("schedintruder");
    const created = await owner.client.post("/api/schedules", { name: "Private", timezone: "UTC", rules: [] });
    const scheduleId = created.body.data.schedule.id;

    const readAttempt = await intruder.client.get(`/api/schedules/${scheduleId}`);
    assert.equal(readAttempt.status, 403);

    const editAttempt = await intruder.client.patch(`/api/schedules/${scheduleId}`, { name: "Hijacked" });
    assert.equal(editAttempt.status, 403);
  });

  test("date override marked unavailable removes that day's slots entirely", async () => {
    const { client, user } = await createLoggedInUser("override1");
    await client.post("/api/schedules", {
      name: "Always Available",
      timezone: "UTC",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "17:00" }],
    });
    const eventType = await createEventType(client);

    const targetDate = daysFromNowStr(10);
    const beforeOverride = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=UTC`
    );
    assert.equal(beforeOverride.status, 200);
    assert.ok(
      Object.keys(beforeOverride.body.data.slots).length > 0,
      "expected slots to exist before the override is added"
    );

    const schedules = await client.get("/api/schedules");
    const scheduleId = schedules.body.data.schedules[0].id;

    const overrideRes = await client.post(`/api/schedules/${scheduleId}/overrides`, {
      date: targetDate,
      isUnavailable: true,
    });
    assert.equal(overrideRes.status, 201);

    const afterOverride = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=UTC`
    );
    assert.equal(afterOverride.status, 200);
    assert.equal(
      Object.keys(afterOverride.body.data.slots).length,
      0,
      "expected zero slots on the day marked unavailable"
    );
  });

  test("minimum notice excludes slots that are too soon", async () => {
    const { client, user } = await createLoggedInUser("minnotice");
    await client.post("/api/schedules", {
      name: "24/7",
      timezone: "UTC",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:45" }],
    });
    // A huge minimum notice (30 days) should exclude tomorrow's slots entirely.
    const eventType = await createEventType(client, { minimumNoticeMinutes: 60 * 24 * 30 });

    const tomorrow = daysFromNowStr(1);
    const res = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${tomorrow}&to=${tomorrow}&timezone=UTC`
    );
    assert.equal(res.status, 200);
    assert.equal(Object.keys(res.body.data.slots).length, 0);
  });

  test("timezone handling: a booker requesting slots in a different timezone gets the same set of absolute times", async () => {
    const { client, user } = await createLoggedInUser("tzhandling");
    await client.post("/api/schedules", {
      name: "NY Hours",
      timezone: "America/New_York",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "17:00" }],
    });
    const eventType = await createEventType(client);
    const targetDate = daysFromNowStr(10);

    const asUtc = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=UTC`
    );
    const asTokyo = await client.get(
      `/api/users/${user.username}/event-types/${eventType.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=Asia/Tokyo`
    );
    assert.equal(asUtc.status, 200);
    assert.equal(asTokyo.status, 200);

    // The underlying set of bookable ISO instants should be identical
    // regardless of which timezone the booker views them in — only the
    // day-grouping (and eventual display formatting) changes.
    const flatten = (slotsByDay) => Object.values(slotsByDay).flat().sort();
    assert.deepEqual(flatten(asUtc.body.data.slots), flatten(asTokyo.body.data.slots));
  });

  test("buffers reduce the number of available slots", async () => {
    const { client, user } = await createLoggedInUser("bufferavail");
    await client.post("/api/schedules", {
      name: "Short Window",
      timezone: "UTC",
      isDefault: true,
      rules: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "10:00" }], // exactly 1 hour
    });
    const targetDate = daysFromNowStr(10);

    const noBuffer = await createEventType(client, { durationMinutes: 30, slotIntervalMinutes: 30 });
    const withBuffer = await createEventType(client, {
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 20,
      bufferAfterMinutes: 20,
    });

    const noBufferSlots = await client.get(
      `/api/users/${user.username}/event-types/${noBuffer.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=UTC`
    );
    const withBufferSlots = await client.get(
      `/api/users/${user.username}/event-types/${withBuffer.slug}/slots?from=${targetDate}&to=${targetDate}&timezone=UTC`
    );

    const countSlots = (res) => Object.values(res.body.data.slots).flat().length;
    assert.ok(
      countSlots(withBufferSlots) < countSlots(noBufferSlots),
      `expected fewer slots with a 20-min buffer on each side (no-buffer=${countSlots(noBufferSlots)}, with-buffer=${countSlots(withBufferSlots)})`
    );
  });
});

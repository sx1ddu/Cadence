const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createLoggedInUser, daysFromNowStr } = require("./helpers/testUtils");

async function setUpHostWithSchedule(prefix, rules) {
  const { client, user, publicUser } = await createLoggedInUser(prefix);
  await client.post("/api/schedules", {
    name: "Schedule",
    timezone: "UTC",
    isDefault: true,
    rules,
  });
  return { client, user, publicUser };
}

const OPEN_ALL_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:45" }];

async function createTeam(adminClient, name) {
  const slug = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  const res = await adminClient.post("/api/teams", { name, slug });
  if (res.status !== 201) throw new Error(`team creation failed: ${JSON.stringify(res.body)}`);
  return res.body.data.team;
}

describe("Teams", () => {
  test("creating a team makes the creator an admin member", async () => {
    const { client } = await createLoggedInUser("teamcreator");
    const team = await createTeam(client, "myteam");
    assert.equal(team.members.length, 1);
    assert.equal(team.members[0].role, "admin");
  });

  test("a non-member cannot read a team's details", async () => {
    const owner = await createLoggedInUser("teamowner1");
    const outsider = await createLoggedInUser("teamoutsider1");
    const team = await createTeam(owner.client, "privateteam");

    const res = await outsider.client.get(`/api/teams/${team.id}`);
    assert.equal(res.status, 403);
  });

  test("a member (non-admin) cannot add other members", async () => {
    const owner = await createLoggedInUser("teamowner2");
    const member = await createLoggedInUser("teammember2");
    const team = await createTeam(owner.client, "teamwithmember");

    const addRes = await owner.client.post(`/api/teams/${team.id}/members`, {
      email: member.user.email,
      role: "member",
    });
    assert.equal(addRes.status, 201);

    // the newly-added member tries to add someone else — should be forbidden
    const outsider = await createLoggedInUser("teamoutsider2");
    const memberAddAttempt = await member.client.post(`/api/teams/${team.id}/members`, {
      email: outsider.user.email,
      role: "member",
    });
    assert.equal(memberAddAttempt.status, 403);
  });

  test("removing the last admin is blocked", async () => {
    const owner = await createLoggedInUser("teamowner3");
    const team = await createTeam(owner.client, "soloadminteam");

    const ownerPublicId = team.members[0].userId;
    const res = await owner.client.patch(`/api/teams/${team.id}/members/${ownerPublicId}`, {
      role: "member",
    });
    assert.equal(res.status, 400, "demoting the only admin should be blocked");
  });

  test("only a team admin can create a team event type", async () => {
    const owner = await setUpHostWithSchedule("rrowner1", OPEN_ALL_DAY);
    const member = await setUpHostWithSchedule("rrmember1", OPEN_ALL_DAY);
    const team = await createTeam(owner.client, "rrteam1");
    await owner.client.post(`/api/teams/${team.id}/members`, { email: member.user.email, role: "member" });

    const attempt = await member.client.post("/api/event-types", {
      title: "Team Meeting",
      slug: `team-meeting-${Date.now()}`,
      durationMinutes: 30,
      locations: [{ type: "phone" }],
      teamId: team.id,
      schedulingType: "ROUND_ROBIN",
      hostUserIds: [owner.publicUser.id, member.publicUser.id],
    });
    assert.equal(attempt.status, 403, "a non-admin member shouldn't be able to create a team event type");
  });

  test("round-robin: a booking is assigned to one of the team's hosts", async () => {
    const owner = await setUpHostWithSchedule("rrowner2", OPEN_ALL_DAY);
    const member = await setUpHostWithSchedule("rrmember2", OPEN_ALL_DAY);
    const team = await createTeam(owner.client, "rrteam2");
    await owner.client.post(`/api/teams/${team.id}/members`, { email: member.user.email, role: "member" });

    const eventTypeRes = await owner.client.post("/api/event-types", {
      title: "RR Meeting",
      slug: `rr-meeting-${Date.now()}`,
      durationMinutes: 30,
      locations: [{ type: "phone" }],
      minimumNoticeMinutes: 0,
      teamId: team.id,
      schedulingType: "ROUND_ROBIN",
      hostUserIds: [owner.publicUser.id, member.publicUser.id],
    });
    assert.equal(eventTypeRes.status, 201);
    const eventType = eventTypeRes.body.data.eventType;

    const date = daysFromNowStr(5);
    const slotsRes = await owner.client.get(
      `/api/team-pages/${team.slug}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    assert.equal(slotsRes.status, 200);
    const allSlots = Object.values(slotsRes.body.data.slots).flat();
    assert.ok(allSlots.length > 0, "expected at least one round-robin slot");

    const bookRes = await owner.client.post("/api/bookings", {
      teamSlug: team.slug,
      eventTypeSlug: eventType.slug,
      startTime: allSlots[0],
      attendeeName: "RR Attendee",
      attendeeEmail: `rr-${Date.now()}@example.com`,
      attendeeTimezone: "UTC",
      locationType: "phone",
      answers: {},
    });
    assert.equal(bookRes.status, 201);
    assert.equal(bookRes.body.data.booking.status, "confirmed");
  });

  test("collective: availability requires ALL hosts to be free at the same time", async () => {
    const owner = await setUpHostWithSchedule("collowner1", [
      { days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "12:00" },
    ]);
    const member = await setUpHostWithSchedule("collmember1", [
      { days: [0, 1, 2, 3, 4, 5, 6], startTime: "13:00", endTime: "17:00" },
    ]);
    const team = await createTeam(owner.client, "collteam1");
    await owner.client.post(`/api/teams/${team.id}/members`, { email: member.user.email, role: "member" });

    const eventTypeRes = await owner.client.post("/api/event-types", {
      title: "Collective Meeting",
      slug: `coll-meeting-${Date.now()}`,
      durationMinutes: 30,
      locations: [{ type: "phone" }],
      minimumNoticeMinutes: 0,
      teamId: team.id,
      schedulingType: "COLLECTIVE",
      hostUserIds: [owner.publicUser.id, member.publicUser.id],
    });
    assert.equal(eventTypeRes.status, 201);
    const eventType = eventTypeRes.body.data.eventType;

    const date = daysFromNowStr(5);
    const slotsRes = await owner.client.get(
      `/api/team-pages/${team.slug}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    assert.equal(slotsRes.status, 200);
    // The two hosts' working hours (09:00-12:00 and 13:00-17:00) don't
    // overlap at all, so a COLLECTIVE event (which needs BOTH free at
    // once) should have zero bookable slots.
    const allSlots = Object.values(slotsRes.body.data.slots).flat();
    assert.equal(allSlots.length, 0, "non-overlapping host schedules should produce zero collective slots");
  });

  test("collective: an overlapping window between hosts IS bookable", async () => {
    const owner = await setUpHostWithSchedule("collowner2", [
      { days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "13:00" },
    ]);
    const member = await setUpHostWithSchedule("collmember2", [
      { days: [0, 1, 2, 3, 4, 5, 6], startTime: "11:00", endTime: "17:00" },
    ]);
    const team = await createTeam(owner.client, "collteam2");
    await owner.client.post(`/api/teams/${team.id}/members`, { email: member.user.email, role: "member" });

    const eventTypeRes = await owner.client.post("/api/event-types", {
      title: "Collective Meeting Overlap",
      slug: `coll-overlap-${Date.now()}`,
      durationMinutes: 30,
      locations: [{ type: "phone" }],
      minimumNoticeMinutes: 0,
      teamId: team.id,
      schedulingType: "COLLECTIVE",
      hostUserIds: [owner.publicUser.id, member.publicUser.id],
    });
    const eventType = eventTypeRes.body.data.eventType;

    const date = daysFromNowStr(5);
    const slotsRes = await owner.client.get(
      `/api/team-pages/${team.slug}/event-types/${eventType.slug}/slots?from=${date}&to=${date}&timezone=UTC`
    );
    const allSlots = Object.values(slotsRes.body.data.slots).flat();
    // Overlap window is 11:00-13:00 (2 hours) -> should have bookable slots.
    assert.ok(allSlots.length > 0, "the overlapping 11:00-13:00 window should be bookable");

    // Every returned slot must fall within the 11:00-12:30 range (last
    // 30-min slot that still fits before 13:00).
    for (const iso of allSlots) {
      const hour = new Date(iso).getUTCHours();
      assert.ok(hour >= 11 && hour < 13, `slot ${iso} falls outside the expected overlap window`);
    }
  });
});

const ApiError = require("../../utils/ApiError");
const eventTypeRepo = require("./eventType.repository");
const scheduleRepo = require("../schedules/schedule.repository");
const userRepo = require("../users/user.repository");
const bookingRepo = require("../bookings/booking.repository");
const teamRepo = require("../teams/team.repository");

/**
 * Loads an event type and verifies the requesting user is allowed to
 * edit it:
 *   - personal event type (team_id NULL) -> must be the owner
 *   - team event type                    -> must be a team admin
 */
async function getEditableEventTypeOr404(publicId, userId) {
  const eventType = await eventTypeRepo.findByPublicId(publicId);
  if (!eventType) throw ApiError.notFound("Event type not found.");

  if (!eventType.team_id) {
    if (eventType.user_id !== userId) throw ApiError.forbidden("You don't own this event type.");
    return eventType;
  }

  const membership = await teamRepo.findMembership(eventType.team_id, userId);
  if (!membership || membership.role !== "admin") {
    throw ApiError.forbidden("Only team admins can manage this event type.");
  }
  return eventType;
}

/** Resolves a public schedule UUID (or null) into the schedule's internal id, verifying ownership. */
async function resolveScheduleInternalId(scheduleId, userId) {
  if (scheduleId === undefined) return undefined; // not being changed
  if (scheduleId === null) return null; // explicitly cleared -> fall back to default schedule
  const schedule = await scheduleRepo.findByPublicId(scheduleId);
  if (!schedule || schedule.user_id !== userId) {
    throw ApiError.badRequest("scheduleId does not refer to one of your schedules.");
  }
  return schedule.id;
}

/**
 * Resolves an array of public user UUIDs into { userId (internal), priority }
 * rows, verifying every one of them is actually a member of the team.
 * `priority` isn't collected from the client on this endpoint (kept simple
 * for now — everyone starts at priority 0, adjustable via a future
 * "team member settings" endpoint).
 */
async function resolveTeamHosts(teamId, hostPublicIds) {
  const members = await teamRepo.getMembers(teamId);
  const memberByPublicId = new Map(members.map((m) => [m.public_id, m]));

  const hosts = [];
  for (const publicId of hostPublicIds) {
    if (!memberByPublicId.has(publicId)) {
      throw ApiError.badRequest(`User ${publicId} is not a member of this team.`);
    }
    const user = await userRepo.findByPublicId(publicId);
    hosts.push({ userId: user.id, priority: 0 });
  }
  return hosts;
}

async function attachHosts(rows) {
  const results = [];
  for (const row of rows) {
    const hosts = row.team_id ? await eventTypeRepo.getHosts(row.id) : [];
    results.push(eventTypeRepo.toOwnerView(row, hosts));
  }
  return results;
}

async function listMyEventTypes(userId) {
  const rows = await eventTypeRepo.listForUser(userId);
  return attachHosts(rows);
}

async function listTeamEventTypes(teamPublicId, userId) {
  const team = await teamRepo.findByPublicId(teamPublicId);
  if (!team) throw ApiError.notFound("Team not found.");
  const membership = await teamRepo.findMembership(team.id, userId);
  if (!membership) throw ApiError.forbidden("You're not a member of this team.");

  const rows = await eventTypeRepo.listForTeam(team.id);
  return attachHosts(rows);
}

async function getMyEventType(publicId, userId) {
  const row = await getEditableEventTypeOr404(publicId, userId);
  const hosts = row.team_id ? await eventTypeRepo.getHosts(row.id) : [];
  return eventTypeRepo.toOwnerView(row, hosts);
}

async function createEventType(userId, input) {
  if (input.teamId) {
    return createTeamEventType(userId, input);
  }
  return createPersonalEventType(userId, input);
}

async function createPersonalEventType(userId, input) {
  const existing = await eventTypeRepo.findBySlugForUser(userId, input.slug);
  if (existing) throw ApiError.conflict("You already have an event type with this slug.");

  const scheduleInternalId = await resolveScheduleInternalId(input.scheduleId, userId);
  const row = await eventTypeRepo.create(userId, { ...input, scheduleInternalId });
  return eventTypeRepo.toOwnerView(row, []);
}

async function createTeamEventType(userId, input) {
  const team = await teamRepo.findByPublicId(input.teamId);
  if (!team) throw ApiError.notFound("Team not found.");

  const membership = await teamRepo.findMembership(team.id, userId);
  if (!membership || membership.role !== "admin") {
    throw ApiError.forbidden("Only team admins can create team event types.");
  }

  const existing = await eventTypeRepo.findBySlugForTeam(team.id, input.slug);
  if (existing) throw ApiError.conflict("This team already has an event type with this slug.");

  const hosts = await resolveTeamHosts(team.id, input.hostUserIds);
  // A team event type has no personal schedule fallback (there's no single
  // "team schedule") — each host's OWN default schedule is what's checked
  // at availability time (see availability.service.js), so scheduleId
  // is intentionally ignored for team event types.
  const scheduleInternalId = null;

  const row = await eventTypeRepo.create(userId, {
    ...input,
    teamInternalId: team.id,
    scheduleInternalId,
  });

  await eventTypeRepo.setHosts(row.id, hosts);
  const savedHosts = await eventTypeRepo.getHosts(row.id);
  return eventTypeRepo.toOwnerView(row, savedHosts);
}

async function updateEventType(publicId, userId, input) {
  const eventType = await getEditableEventTypeOr404(publicId, userId);

  if (input.slug && input.slug !== eventType.slug) {
    const existing = eventType.team_id
      ? await eventTypeRepo.findBySlugForTeam(eventType.team_id, input.slug)
      : await eventTypeRepo.findBySlugForUser(userId, input.slug);
    if (existing) throw ApiError.conflict("An event type with this slug already exists.");
  }

  // teamId itself can't be changed after creation (moving an event type
  // between a personal account and a team is an edge case with enough
  // subtlety — e.g. what happens to its bookings — that it's out of
  // scope here; delete and recreate instead).
  const { teamId, ...rest } = input;

  const scheduleInternalId = eventType.team_id
    ? undefined // team event types don't use scheduleId at all
    : await resolveScheduleInternalId(input.scheduleId, userId);

  const row = await eventTypeRepo.update(eventType.id, { ...rest, scheduleInternalId });

  if (eventType.team_id && input.hostUserIds !== undefined) {
    const hosts = await resolveTeamHosts(eventType.team_id, input.hostUserIds);
    await eventTypeRepo.setHosts(eventType.id, hosts);
  }

  const hosts = row.team_id ? await eventTypeRepo.getHosts(row.id) : [];
  return eventTypeRepo.toOwnerView(row, hosts);
}

async function deleteEventType(publicId, userId) {
  const eventType = await getEditableEventTypeOr404(publicId, userId);
  const hasBookings = await bookingRepo.hasBookingsForEventType(eventType.id);
  if (hasBookings) {
    throw ApiError.conflict(
      "This event type has existing bookings and can't be deleted. Deactivate it instead by setting isActive to false."
    );
  }
  await eventTypeRepo.remove(eventType.id);
}

// ─── Public booking-page endpoints ──────────────────────────────

async function listPublicEventTypes(username) {
  const user = await userRepo.findByUsername(username);
  if (!user) throw ApiError.notFound("User not found.");
  const rows = await eventTypeRepo.listActiveForUsername(username);
  return { user: userRepo.toPublicUser(user), eventTypes: rows.map(eventTypeRepo.toPublicView) };
}

async function getPublicEventType(username, slug) {
  const user = await userRepo.findByUsername(username);
  if (!user) throw ApiError.notFound("User not found.");
  const row = await eventTypeRepo.findActiveBySlugForUsername(username, slug);
  if (!row) throw ApiError.notFound("Event type not found.");
  return { user: userRepo.toPublicUser(user), eventType: eventTypeRepo.toPublicView(row) };
}

async function listPublicTeamEventTypes(teamSlug) {
  const team = await teamRepo.findBySlug(teamSlug);
  if (!team) throw ApiError.notFound("Team not found.");
  const rows = await eventTypeRepo.listActiveForTeamSlug(teamSlug);
  return { team: teamRepo.toPublicProfile(team), eventTypes: rows.map(eventTypeRepo.toPublicView) };
}

async function getPublicTeamEventType(teamSlug, slug) {
  const team = await teamRepo.findBySlug(teamSlug);
  if (!team) throw ApiError.notFound("Team not found.");
  const row = await eventTypeRepo.findActiveBySlugForTeamSlug(teamSlug, slug);
  if (!row) throw ApiError.notFound("Event type not found.");
  return { team: teamRepo.toPublicProfile(team), eventType: eventTypeRepo.toPublicView(row) };
}

module.exports = {
  getEditableEventTypeOr404,
  listMyEventTypes,
  listTeamEventTypes,
  getMyEventType,
  createEventType,
  updateEventType,
  deleteEventType,
  listPublicEventTypes,
  getPublicEventType,
  listPublicTeamEventTypes,
  getPublicTeamEventType,
};

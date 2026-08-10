const ApiError = require("../../utils/ApiError");
const scheduleRepo = require("./schedule.repository");

/**
 * Cache staleness note: unlike event type updates (which invalidate the
 * slots cache immediately — see eventType.service.js), changes made here
 * do NOT proactively invalidate the Redis slots cache for event types
 * that use this schedule. A schedule can be a user's implicit default
 * (used by every event type that doesn't set its own scheduleId), so
 * finding every affected event type would mean scanning across the
 * user's whole event type list on every schedule edit — for a cache
 * whose entries already expire after 30 seconds (see
 * availability.service.js's SLOTS_CACHE_TTL_SECONDS), that cost isn't
 * worth paying. The practical effect is that a schedule change can take
 * up to 30 seconds to be reflected in publicly-displayed slots. This is
 * a deliberate tradeoff, not an oversight — schedule edits are
 * infrequent, and the FOR UPDATE transactional check at booking time
 * (not the cache) is what actually prevents a real conflict, so a stale
 * cache entry can cause a rejected booking attempt, never a double-booked
 * one.
 */

/** Loads a schedule and throws 404/403 unless it belongs to `userId`. */
async function getOwnedScheduleOr404(publicId, userId) {
  const schedule = await scheduleRepo.findByPublicId(publicId);
  if (!schedule) throw ApiError.notFound("Schedule not found.");
  if (schedule.user_id !== userId) throw ApiError.forbidden("You don't own this schedule.");
  return schedule;
}

async function listSchedules(userId) {
  const schedules = await scheduleRepo.listForUser(userId);
  const withDetails = await Promise.all(
    schedules.map(async (s) => {
      const rules = await scheduleRepo.getRules(s.id);
      return scheduleRepo.toPublicSchedule(s, rules, []);
    })
  );
  return withDetails;
}

async function getSchedule(publicId, userId) {
  const schedule = await getOwnedScheduleOr404(publicId, userId);
  const { rules, overrides } = await scheduleRepo.getScheduleWithDetails(schedule.id);
  return scheduleRepo.toPublicSchedule(schedule, rules, overrides);
}

async function createSchedule(userId, input) {
  const existing = await scheduleRepo.listForUser(userId);
  // The very first schedule a user creates automatically becomes their default.
  const isDefault = input.isDefault || existing.length === 0;

  const scheduleId = await scheduleRepo.createSchedule({
    userId,
    name: input.name,
    timezone: input.timezone,
    isDefault,
    rules: input.rules,
  });

  return getSchedule((await scheduleRepo.findById(scheduleId)).public_id, userId);
}

async function updateSchedule(publicId, userId, input) {
  const schedule = await getOwnedScheduleOr404(publicId, userId);
  await scheduleRepo.updateSchedule(schedule.id, userId, input);
  return getSchedule(publicId, userId);
}

async function deleteSchedule(publicId, userId) {
  const schedule = await getOwnedScheduleOr404(publicId, userId);
  if (schedule.is_default) {
    throw ApiError.badRequest(
      "You can't delete your default schedule. Set another schedule as default first."
    );
  }
  await scheduleRepo.deleteSchedule(schedule.id);
  // Any event types pointing at this schedule fall back to NULL
  // (enforced by ON DELETE SET NULL on event_types.schedule_id, added
  // in the event types migration) and will use the user's default schedule.
}

async function addOverride(publicId, userId, input) {
  const schedule = await getOwnedScheduleOr404(publicId, userId);
  await scheduleRepo.addOverride(schedule.id, input);
  return getSchedule(publicId, userId);
}

async function deleteOverride(publicId, overrideId, userId) {
  const schedule = await getOwnedScheduleOr404(publicId, userId);
  await scheduleRepo.deleteOverride(overrideId, schedule.id);
  return getSchedule(publicId, userId);
}

module.exports = {
  getOwnedScheduleOr404,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  addOverride,
  deleteOverride,
};

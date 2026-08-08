const { parseJsonColumn } = require("../../utils/json");
const dayjs = require("../../utils/dayjs");
const ApiError = require("../../utils/ApiError");
const { redis } = require("../../config/redis");
const scheduleRepo = require("../schedules/schedule.repository");
const bookingRepo = require("../bookings/booking.repository");
const eventTypeRepo = require("../event-types/eventType.repository");
const { buildDateRanges, subtractRanges, intersectAll, unionAll } = require("./dateRanges");
const { buildSlots } = require("./slots");

const SLOTS_CACHE_TTL_SECONDS = 30;

/**
 * Computes bookable slots for one event type over [fromDate, toDate).
 *
 * Mirrors Cal.com's getUserAvailability -> getSlots pipeline, extended to
 * handle team event types:
 *   1. Resolve which schedule(s) apply — the event type's own schedule for
 *      a personal event type, or each assigned host's own default
 *      schedule for a team event type (team events have no single shared
 *      schedule to fall back to).
 *   2. Expand into free UTC date ranges per host.
 *   3. Subtract busy time (existing pending/confirmed bookings for that host).
 *   4. Combine across hosts: COLLECTIVE intersects (every host must be
 *      free); ROUND_ROBIN unions (any one host free is enough).
 *   5. Chop the remaining free ranges into discrete slot start times.
 *
 * Short-TTL Redis caching: slot computation is read-heavy (every visit to
 * a booking page hits this) and cheap to get slightly stale for a few
 * seconds, but expensive to recompute on every request once schedules and
 * bookings pile up. A 30s TTL keeps results fresh enough that a slot
 * taken by someone else disappears almost immediately, while absorbing
 * bursts of traffic on a popular booking page.
 */
async function getAvailableSlots({ eventType, fromDate, toDate, timezone }) {
  const cacheKey = buildCacheKey(eventType.public_id, fromDate, toDate, timezone);

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const { freeRanges, hostTimezone } = await getFreeRangesForEventType(eventType, fromDate, toDate);

  const slotStarts = buildSlots(freeRanges, {
    durationMinutes: eventType.duration_minutes,
    intervalMinutes: eventType.slot_interval_minutes,
    minimumNoticeMinutes: eventType.minimum_notice_minutes,
  });

  const bookerTimezone = timezone || hostTimezone;
  const slots = groupSlotsByDay(slotStarts, bookerTimezone);

  await redis.set(cacheKey, JSON.stringify(slots), "EX", SLOTS_CACHE_TTL_SECONDS);
  return slots;
}

/**
 * The combine-across-hosts logic, factored out so booking creation can
 * reuse the exact same computation (for its "is this slot still free"
 * recheck) without duplicating the COLLECTIVE/ROUND_ROBIN branching.
 */
async function getFreeRangesForEventType(eventType, fromDate, toDate) {
  if (!eventType.team_id) {
    const { freeRanges, timezone } = await getFreeRangesForHost(
      eventType.user_id,
      eventType.schedule_id,
      fromDate,
      toDate
    );
    return { freeRanges, hostTimezone: timezone, hostsConsidered: [eventType.user_id] };
  }

  const hosts = await eventTypeRepo.getHosts(eventType.id);
  if (hosts.length === 0) {
    throw ApiError.badRequest("This team event type has no hosts assigned yet.");
  }

  const perHost = await Promise.all(
    hosts.map((h) => getFreeRangesForHost(h.internal_id, null, fromDate, toDate))
  );
  const rangeLists = perHost.map((r) => r.freeRanges);

  const freeRanges =
    eventType.scheduling_type === "COLLECTIVE" ? intersectAll(rangeLists) : unionAll(rangeLists);

  return {
    freeRanges,
    hostTimezone: perHost[0].timezone,
    hostsConsidered: hosts.map((h) => h.internal_id),
  };
}

/** Bypasses (and refreshes) the cache — called right after a booking is created so the taken slot disappears immediately. */
async function invalidateSlotsCache(eventTypePublicId) {
  const keys = await redis.keys(`slots:${eventTypePublicId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

function buildCacheKey(eventTypePublicId, fromDate, toDate, timezone) {
  return `slots:${eventTypePublicId}:${fromDate.toISOString()}:${toDate.toISOString()}:${timezone || "host"}`;
}

/** One host's free ranges: their schedule (own default, or a specific one) minus their busy time. */
async function getFreeRangesForHost(hostUserId, scheduleInternalId, fromDate, toDate) {
  const schedule = await resolveScheduleForHost(hostUserId, scheduleInternalId);
  const dateRanges = buildDateRanges(schedule, fromDate, toDate);
  const busyRanges = await bookingRepo.getBusyRangesForUser(hostUserId, fromDate, toDate);
  return { freeRanges: subtractRanges(dateRanges, busyRanges), timezone: schedule.timezone };
}

async function resolveScheduleForHost(hostUserId, scheduleInternalId) {
  const scheduleRow = scheduleInternalId
    ? await scheduleRepo.findById(scheduleInternalId)
    : await scheduleRepo.findDefaultForUser(hostUserId);

  if (!scheduleRow) {
    throw ApiError.badRequest(
      "One of the hosts for this event type hasn't set up their availability yet."
    );
  }

  const [rules, overrides] = await Promise.all([
    scheduleRepo.getRules(scheduleRow.id),
    scheduleRepo.getOverrides(scheduleRow.id),
  ]);

  return {
    timezone: scheduleRow.timezone,
    rules: rules.map((r) => ({
      days: parseJsonColumn(r.days),
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
    })),
    overrides: overrides.map((o) => ({
      date: o.date instanceof Date ? o.date.toISOString().slice(0, 10) : o.date,
      isUnavailable: Boolean(o.is_unavailable),
      startTime: o.start_time ? o.start_time.slice(0, 5) : undefined,
      endTime: o.end_time ? o.end_time.slice(0, 5) : undefined,
    })),
  };
}

/** Backward-compatible single-host helper — still used directly by booking.service for personal event types. */
async function resolveSchedule(eventType) {
  return resolveScheduleForHost(eventType.user_id, eventType.schedule_id);
}

/** Groups a flat list of UTC slot Dates into { "YYYY-MM-DD": ["HH:mm ISO", ...] } in the booker's timezone. */
function groupSlotsByDay(slotStarts, bookerTimezone) {
  const grouped = {};
  for (const slot of slotStarts) {
    const local = dayjs(slot).tz(bookerTimezone);
    const dayKey = local.format("YYYY-MM-DD");
    if (!grouped[dayKey]) grouped[dayKey] = [];
    grouped[dayKey].push(slot.toISOString());
  }
  return grouped;
}

module.exports = {
  getAvailableSlots,
  getFreeRangesForEventType,
  getFreeRangesForHost,
  invalidateSlotsCache,
  resolveSchedule,
  resolveScheduleForHost,
};

const dayjs = require("../../utils/dayjs");
const ApiError = require("../../utils/ApiError");
const { parseJsonColumn } = require("../../utils/json");
const { withTransaction } = require("../../config/db");
const emailQueue = require("../../jobs/queues/email.queue");
const eventTypeRepo = require("../event-types/eventType.repository");
const userRepo = require("../users/user.repository");
const teamRepo = require("../teams/team.repository");
const bookingRepo = require("./booking.repository");
const availabilityService = require("../availability/availability.service");
const { buildDateRanges, subtractRanges, intersectAll } = require("../availability/dateRanges");

/**
 * Creates a booking against a public event type — personal, round-robin,
 * or collective.
 *
 * This is deliberately re-derived from scratch rather than trusting a
 * slot the client picked earlier (the /slots endpoint is only a
 * suggestion — the client could send any timestamp). Two layers of
 * defense against double-booking:
 *
 *   1. Business-rule check: recompute the actual free slots for the
 *      requested day and confirm the requested startTime is one of them
 *      (this enforces the schedule, minimum notice, buffers, host
 *      availability, etc).
 *   2. Concurrency check: inside the DB transaction that inserts the
 *      row, re-verify no overlapping booking exists using
 *      SELECT ... FOR UPDATE, so two simultaneous requests for the same
 *      slot can't both succeed.
 */
async function createBooking(input) {
  const { eventType, team } = await resolveEventType(input);

  validateLocation(eventType, input.locationType);
  validateAnswers(eventType, input.answers);

  const startTime = new Date(input.startTime);
  const endTime = dayjs(startTime).add(eventType.duration_minutes, "minute").toDate();

  await assertWithinBookingWindow(eventType, startTime);
  await assertWithinBookingLimit(eventType, startTime);

  const isSeatsBooking = Boolean(eventType.seats_per_slot && eventType.seats_per_slot > 1);
  const hostSelection = await resolveHostsForBooking(eventType, startTime, endTime, isSeatsBooking);

  const status = eventType.requires_confirmation ? "pending" : "confirmed";
  const paymentStatus = eventType.price_amount ? "pending" : "not_required";

  const booking = await withTransaction(async (conn) => {
    const limitWindow = await getBookingLimitWindow(eventType, startTime);
    if (limitWindow) {
      const count = await bookingRepo.countActiveBookingsForEventTypeInWindowForUpdate(
        conn,
        eventType.id,
        limitWindow.windowStart,
        limitWindow.windowEnd
      );
      if (count >= eventType.booking_limit_count) {
        throw ApiError.badRequest(
          `This event type only allows ${eventType.booking_limit_count} booking(s) per ${eventType.booking_limit_window}, and that limit has just been reached.`
        );
      }
    }

    if (isSeatsBooking) {
      const currentSeats = await bookingRepo.countActiveBookingsAtExactSlotForUpdate(
        conn,
        eventType.id,
        startTime
      );
      if (currentSeats >= eventType.seats_per_slot) {
        throw ApiError.conflict("This slot is fully booked. Please choose another time.");
      }
      // Still confirm the single host isn't double-booked by something
      // OTHER than this same recurring group slot.
      const overlapExists = await bookingRepo.hasOverlapForUpdate(
        conn,
        hostSelection.hostUserId,
        startTime,
        endTime,
        eventType,
        { eventTypeId: eventType.id, startTime }
      );
      if (overlapExists) {
        throw ApiError.conflict("This time slot is no longer available. Please choose another.");
      }
    } else if (eventType.scheduling_type === "COLLECTIVE") {
      const overlapExists = await bookingRepo.hasAnyHostOverlapForUpdate(
        conn,
        hostSelection.allHostUserIds,
        startTime,
        endTime,
        eventType
      );
      if (overlapExists) {
        throw ApiError.conflict("This time slot was just booked by someone else. Please pick another.");
      }
    } else {
      const overlapExists = await bookingRepo.hasOverlapForUpdate(
        conn,
        hostSelection.hostUserId,
        startTime,
        endTime,
        eventType
      );
      if (overlapExists) {
        throw ApiError.conflict("This time slot was just booked by someone else. Please pick another.");
      }
    }

    return bookingRepo.createWithConnection(conn, {
      eventTypeId: eventType.id,
      hostUserId: hostSelection.hostUserId,
      allHostUserIds: hostSelection.allHostUserIds,
      title: eventType.title,
      durationMinutes: eventType.duration_minutes,
      startTime,
      endTime,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      attendeeTimezone: input.attendeeTimezone,
      answers: input.answers,
      location: { type: input.locationType },
      status,
      priceAmount: eventType.price_amount,
      currency: eventType.currency,
      paymentStatus,
    });
  });

  await availabilityService.invalidateSlotsCache(eventType.public_id);
  await sendBookingCreatedEmails({ booking, hostUserIds: hostSelection.allHostUserIds, eventType, status });

  return bookingRepo.toPublicBooking(booking);
}

/** Looks up the event type via either its personal booking page or its team booking page. */
async function resolveEventType(input) {
  if (input.username) {
    const host = await userRepo.findByUsername(input.username);
    if (!host) throw ApiError.notFound("User not found.");
    const eventType = await eventTypeRepo.findActiveBySlugForUsername(input.username, input.eventTypeSlug);
    if (!eventType) throw ApiError.notFound("Event type not found.");
    return { eventType, team: null };
  }

  const team = await teamRepo.findBySlug(input.teamSlug);
  if (!team) throw ApiError.notFound("Team not found.");
  const eventType = await eventTypeRepo.findActiveBySlugForTeamSlug(input.teamSlug, input.eventTypeSlug);
  if (!eventType) throw ApiError.notFound("Event type not found.");
  return { eventType, team };
}

/**
 * Determines who the booking's host(s) will be:
 *   - personal event type          -> the owner
 *   - COLLECTIVE team event type   -> every assigned host (all must be free)
 *   - ROUND_ROBIN team event type  -> exactly one host, picked from
 *     whichever assigned hosts are actually free at this exact slot,
 *     preferring higher `priority`, then whoever was booked longest ago
 *   - seats-based group event      -> the owner, but skips the
 *     "is this slot free" recheck below (handled separately, since the
 *     same slot legitimately hosts multiple bookings up to capacity)
 */
async function resolveHostsForBooking(eventType, startTime, endTime, isSeatsBooking) {
  if (!eventType.team_id) {
    if (!isSeatsBooking) {
      await assertSlotIsActuallyFree(eventType, startTime, endTime);
    } else {
      await assertSeatsSlotIsValid(eventType, startTime, endTime);
    }
    return { hostUserId: eventType.user_id, allHostUserIds: [eventType.user_id] };
  }

  const hosts = await eventTypeRepo.getHosts(eventType.id);
  if (hosts.length === 0) throw ApiError.badRequest("This team event type has no hosts assigned.");

  if (eventType.scheduling_type === "COLLECTIVE") {
    await assertCollectiveSlotIsFree(eventType, hosts, startTime, endTime);
    return {
      hostUserId: hosts[0].internal_id, // "primary" host for the simple dashboard query — see booking_hosts note in the repository
      allHostUserIds: hosts.map((h) => h.internal_id),
    };
  }

  // ROUND_ROBIN
  const chosenHost = await pickRoundRobinHost(eventType, hosts, startTime, endTime);
  if (!chosenHost) {
    throw ApiError.conflict("None of this event type's hosts are free at that time. Please choose another.");
  }
  return { hostUserId: chosenHost.internal_id, allHostUserIds: [chosenHost.internal_id] };
}

/**
 * Returns a UTC window guaranteed to fully contain "the calendar day
 * `startTime` falls on" in ANY timezone, without needing to know which
 * timezone that actually is up front (a round-robin/collective event
 * type's hosts can each be in different timezones, and even a personal
 * event type's relevant timezone isn't known until its schedule is
 * loaded). Widening by a full day on each side (UTC offsets never
 * exceed ±14 hours) is simpler and safer than trying to compute an
 * exact local-day boundary here — using `dayjs(startTime).startOf('day')`
 * without an explicit timezone would silently use the SERVER's system
 * timezone instead, which could clip the edges of the real business day
 * and reject valid slots near midnight in the host's actual timezone.
 * The extra fetched range costs a little more work, not correctness.
 */
function getSafeDayWindow(startTime) {
  return {
    dayStart: dayjs.utc(startTime).subtract(1, "day").startOf("day").toDate(),
    dayEnd: dayjs.utc(startTime).add(1, "day").endOf("day").toDate(),
  };
}

function validateLocation(eventType, locationType) {
  const locations = parseJsonColumn(eventType.locations);
  const allowed = locations.some((l) => l.type === locationType);
  if (!allowed) {
    throw ApiError.badRequest(`This event type doesn't offer the "${locationType}" location.`);
  }
}

function validateAnswers(eventType, answers) {
  const questions = parseJsonColumn(eventType.booking_questions);
  for (const question of questions) {
    if (question.required && !answers[question.id]) {
      throw ApiError.badRequest(`"${question.label}" is required.`, [
        { path: `answers.${question.id}`, message: "This field is required." },
      ]);
    }
  }
}

async function assertWithinBookingWindow(eventType, startTime) {
  const now = dayjs();
  const earliestAllowed = now.add(eventType.minimum_notice_minutes, "minute");
  if (dayjs(startTime).isBefore(earliestAllowed)) {
    throw ApiError.badRequest(
      `This event type requires at least ${eventType.minimum_notice_minutes} minutes notice.`
    );
  }

  const latestAllowed = now.add(eventType.future_booking_days, "day");
  if (dayjs(startTime).isAfter(latestAllowed)) {
    throw ApiError.badRequest(
      `This event type can only be booked up to ${eventType.future_booking_days} days in advance.`
    );
  }
}

/**
 * Enforces "no more than N bookings per day/week/month" for this event
 * type, if the host has configured one. The window boundaries are
 * computed in the event type's own schedule timezone (personal event
 * types) or the first host's timezone (team event types), so "per day"
 * means the relevant calendar day, not UTC's.
 *
 * This is a fast PRE-check only — it runs before the transaction opens,
 * using a plain (non-locking) COUNT, purely so an obviously-over-the-limit
 * request fails quickly without doing the work of resolving hosts. The
 * AUTHORITATIVE check that actually prevents a race from exceeding the
 * limit is the FOR UPDATE recount inside the transaction — see
 * getBookingLimitWindow + countActiveBookingsForEventTypeInWindowForUpdate
 * in createBooking.
 */
async function assertWithinBookingLimit(eventType, startTime) {
  const window = await getBookingLimitWindow(eventType, startTime);
  if (!window) return;

  const count = await bookingRepo.countActiveBookingsForEventTypeInWindow(
    eventType.id,
    window.windowStart,
    window.windowEnd
  );

  if (count >= eventType.booking_limit_count) {
    throw ApiError.badRequest(
      `This event type only allows ${eventType.booking_limit_count} booking(s) per ${eventType.booking_limit_window}, and that limit has been reached.`
    );
  }
}

/** Returns { windowStart, windowEnd } for this event type's booking limit, or null if none is configured. */
async function getBookingLimitWindow(eventType, startTime) {
  if (!eventType.booking_limit_count || !eventType.booking_limit_window) return null;

  const referenceUserId = eventType.team_id
    ? (await eventTypeRepo.getHosts(eventType.id))[0]?.internal_id
    : eventType.user_id;
  const schedule = await availabilityService.resolveScheduleForHost(
    referenceUserId,
    eventType.team_id ? null : eventType.schedule_id
  );
  const local = dayjs(startTime).tz(schedule.timezone);

  const unit = { day: "day", week: "week", month: "month" }[eventType.booking_limit_window];
  return { windowStart: local.startOf(unit).toDate(), windowEnd: local.endOf(unit).toDate() };
}

/** Personal event type: re-derives the free slots for just the requested day and confirms startTime is one of them. */
async function assertSlotIsActuallyFree(eventType, startTime, endTime) {
  const isValid = await isSlotWithinFreeRanges(eventType, startTime);
  if (!isValid) {
    throw ApiError.conflict("This time slot is no longer available. Please choose another.");
  }
}

/** Group (seats) event: the slot must still fall on a valid recurring offering, even though it may already have other attendees. */
async function assertSeatsSlotIsValid(eventType, startTime) {
  const isValid = await isSlotWithinFreeRanges(eventType, startTime, { excludeEventTypeId: eventType.id });
  if (!isValid) {
    throw ApiError.badRequest("This isn't a valid time slot for this event type.");
  }
}

/** Collective team event: every assigned host must have this exact slot free. */
async function assertCollectiveSlotIsFree(eventType, hosts, startTime, endTime) {
  const { dayStart, dayEnd } = getSafeDayWindow(startTime);

  const perHost = await Promise.all(
    hosts.map((h) => availabilityService.getFreeRangesForHost(h.internal_id, null, dayStart, dayEnd))
  );
  const combined = intersectAll(perHost.map((r) => r.freeRanges));

  const validSlots = availabilityService.computeValidSlots(combined, eventType);

  const isValid = validSlots.some((slot) => slot.getTime() === startTime.getTime());
  if (!isValid) {
    throw ApiError.conflict("This time slot is no longer available for every host. Please choose another.");
  }
}

/** Shared logic for personal + seats event types (single host, union of one). */
async function isSlotWithinFreeRanges(eventType, startTime, { excludeEventTypeId } = {}) {
  const { dayStart, dayEnd } = getSafeDayWindow(startTime);

  const schedule = await availabilityService.resolveSchedule(eventType);
  const dateRanges = buildDateRanges(schedule, dayStart, dayEnd);
  const busyRanges = await bookingRepo.getBusyRangesForHost(
    eventType.user_id,
    dayStart,
    dayEnd,
    excludeEventTypeId
  );
  const freeRanges = subtractRanges(dateRanges, busyRanges);

  const validSlots = availabilityService.computeValidSlots(freeRanges, eventType);

  return validSlots.some((slot) => slot.getTime() === startTime.getTime());
}

/**
 * Picks a round-robin host: among the hosts actually free at this exact
 * slot, prefer the highest `priority`; break ties by whoever was booked
 * longest ago (or never booked). This is a deliberately simplified
 * version of the weighted-fairness algorithm Cal.com uses — no
 * new-host ramp-up calibration or out-of-office-aware weighting — chosen
 * because those add real complexity for limited teaching value at this
 * project's scope.
 */
async function pickRoundRobinHost(eventType, hosts, startTime, endTime) {
  const { dayStart, dayEnd } = getSafeDayWindow(startTime);

  const freeHostIds = [];
  for (const host of hosts) {
    const { freeRanges } = await availabilityService.getFreeRangesForHost(
      host.internal_id,
      null,
      dayStart,
      dayEnd
    );
    const validSlots = availabilityService.computeValidSlots(freeRanges, eventType);
    if (validSlots.some((slot) => slot.getTime() === startTime.getTime())) {
      freeHostIds.push(host.internal_id);
    }
  }

  const candidates = hosts.filter((h) => freeHostIds.includes(h.internal_id));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const maxPriority = Math.max(...candidates.map((h) => h.priority));
  const topCandidates = candidates.filter((h) => h.priority === maxPriority);
  if (topCandidates.length === 1) return topCandidates[0];

  const lastBookedRows = await bookingRepo.getLastBookingTimePerHost(topCandidates.map((h) => h.internal_id));
  const lastBookedMap = new Map(lastBookedRows.map((r) => [r.user_id, r.last_booked_at]));

  topCandidates.sort((a, b) => {
    const aTime = lastBookedMap.get(a.internal_id) || new Date(0);
    const bTime = lastBookedMap.get(b.internal_id) || new Date(0);
    return new Date(aTime) - new Date(bTime); // longest-ago (or never booked) first
  });

  return topCandidates[0];
}

async function sendBookingCreatedEmails({ booking, hostUserIds, eventType, status }) {
  const jobName = status === "confirmed" ? "booking-confirmed" : "booking-pending";
  const hosts = await Promise.all(hostUserIds.map((id) => userRepo.findById(id)));

  // For a personal event type, "hostName" in the email is that one host.
  // For a team event type, there's no single "the host" to name in the
  // subject line (round-robin picks one, collective has several) — the
  // event title itself already communicates what's being booked, so we
  // fall back to that instead of picking an arbitrary host to feature.
  const primaryHostName = eventType.team_id ? eventType.title : hosts[0]?.name;

  const shared = {
    title: booking.title,
    startTime: booking.start_time,
    hostName: primaryHostName,
    attendeeName: booking.attendee_name,
  };

  await emailQueue.add(jobName, {
    to: booking.attendee_email,
    recipientName: booking.attendee_name,
    timezone: booking.attendee_timezone,
    ...shared,
  });

  for (const host of hosts) {
    if (!host) continue;
    await emailQueue.add(jobName, {
      to: host.email,
      recipientName: host.name,
      timezone: host.timezone,
      ...shared,
    });
  }
}

// ─── Listing / lifecycle ─────────────────────────────────────────

async function listMyBookings(hostUserId, filters) {
  const rows = await bookingRepo.listForHost(hostUserId, filters);
  return rows.map(bookingRepo.toPublicBooking);
}

async function getPublicBooking(publicId) {
  const booking = await bookingRepo.findByPublicId(publicId);
  if (!booking) throw ApiError.notFound("Booking not found.");
  return bookingRepo.toPublicBooking(booking);
}

async function cancelBooking(publicId, { reason }) {
  const booking = await bookingRepo.findByPublicId(publicId);
  if (!booking) throw ApiError.notFound("Booking not found.");
  return cancelBookingInternal(booking, { reason, cancelledBy: "attendee" });
}

async function cancelBookingAsHost(publicId, hostUserId, { reason }) {
  const booking = await getOwnedBookingOr404(publicId, hostUserId);
  return cancelBookingInternal(booking, { reason, cancelledBy: "host" });
}

async function cancelBookingInternal(booking, { reason, cancelledBy }) {
  if (booking.status === "cancelled") throw ApiError.badRequest("This booking is already cancelled.");

  const updated = await bookingRepo.updateStatus(booking.id, "cancelled", {
    cancellationReason: reason || null,
    cancelledBy,
  });

  const eventType = await eventTypeRepo.findById(booking.event_type_id);
  await availabilityService.invalidateSlotsCache(eventType.public_id);

  const host = await userRepo.findById(booking.host_user_id);
  const shared = { title: booking.title, startTime: booking.start_time, reason };

  await emailQueue.add("booking-cancelled", {
    to: booking.attendee_email,
    recipientName: booking.attendee_name,
    timezone: booking.attendee_timezone,
    ...shared,
  });
  if (host) {
    await emailQueue.add("booking-cancelled", {
      to: host.email,
      recipientName: host.name,
      timezone: host.timezone,
      ...shared,
    });
  }

  return bookingRepo.toPublicBooking(updated);
}

async function confirmBooking(publicId, hostUserId) {
  const booking = await getOwnedBookingOr404(publicId, hostUserId);
  if (booking.status !== "pending") {
    throw ApiError.badRequest("Only pending bookings can be confirmed.");
  }

  const updated = await bookingRepo.updateStatus(booking.id, "confirmed");
  const host = await userRepo.findById(hostUserId);

  await emailQueue.add("booking-confirmed", {
    to: booking.attendee_email,
    recipientName: booking.attendee_name,
    timezone: booking.attendee_timezone,
    title: booking.title,
    startTime: booking.start_time,
    hostName: host.name,
    attendeeName: booking.attendee_name,
  });

  return bookingRepo.toPublicBooking(updated);
}

async function rejectBooking(publicId, hostUserId, { reason }) {
  const booking = await getOwnedBookingOr404(publicId, hostUserId);
  if (booking.status !== "pending") {
    throw ApiError.badRequest("Only pending bookings can be rejected.");
  }

  const updated = await bookingRepo.updateStatus(booking.id, "rejected", {
    cancellationReason: reason || null,
    cancelledBy: "host",
  });

  const eventType = await eventTypeRepo.findById(booking.event_type_id);
  await availabilityService.invalidateSlotsCache(eventType.public_id);

  await emailQueue.add("booking-cancelled", {
    to: booking.attendee_email,
    recipientName: booking.attendee_name,
    timezone: booking.attendee_timezone,
    title: booking.title,
    startTime: booking.start_time,
    reason: reason || "The host was unable to confirm this booking.",
  });

  return bookingRepo.toPublicBooking(updated);
}

async function getOwnedBookingOr404(publicId, hostUserId) {
  const booking = await bookingRepo.findByPublicId(publicId);
  if (!booking) throw ApiError.notFound("Booking not found.");

  // For a personal or round-robin booking there's exactly one host, so
  // this is equivalent to the old `host_user_id === hostUserId` check —
  // but for a COLLECTIVE booking with several hosts, checking only the
  // "primary" host_user_id would incorrectly forbid the other assigned
  // hosts from managing a booking they're actually part of.
  const isHost = await bookingRepo.isUserHostOnBooking(booking.id, hostUserId);
  if (!isHost) throw ApiError.forbidden("This isn't your booking.");
  return booking;
}

module.exports = {
  createBooking,
  listMyBookings,
  getPublicBooking,
  cancelBooking,
  cancelBookingAsHost,
  confirmBooking,
  rejectBooking,
};

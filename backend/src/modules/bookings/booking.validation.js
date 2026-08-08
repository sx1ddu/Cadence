const { z } = require("zod");

const createBookingSchema = z
  .object({
    username: z.string().min(1).max(50).optional(),
    teamSlug: z.string().min(1).max(120).optional(),
    eventTypeSlug: z.string().min(1).max(150),
    startTime: z.string().datetime({ message: "startTime must be an ISO 8601 datetime" }),
    attendeeName: z.string().min(1).max(120),
    attendeeEmail: z.string().email(),
    attendeeTimezone: z.string().min(1).max(100),
    locationType: z.enum(["in_person", "phone", "google_meet", "custom_link"]),
    answers: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  })
  .refine((v) => Boolean(v.username) !== Boolean(v.teamSlug), {
    message: "Provide exactly one of username or teamSlug",
    path: ["username"],
  });

const cancelBookingSchema = z.object({
  reason: z.string().max(1000).optional(),
});

module.exports = { createBookingSchema, cancelBookingSchema };

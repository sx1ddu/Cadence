const { z } = require("zod");

const slugSchema = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens");

const locationSchema = z.object({
  type: z.enum(["in_person", "phone", "google_meet", "custom_link"]),
  value: z.string().max(500).optional(), // address for in_person, URL for custom_link
});

const bookingQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Question id must be snake_case"),
  label: z.string().min(1).max(255),
  type: z.enum(["text", "textarea", "radio", "checkbox"]),
  required: z.boolean().default(false),
  options: z.array(z.string().max(120)).optional(), // used by radio/checkbox
});

const baseFields = {
  title: z.string().min(1).max(150),
  slug: slugSchema,
  description: z.string().max(2000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(24 * 60),
  scheduleId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  schedulingType: z.enum(["ROUND_ROBIN", "COLLECTIVE"]).optional().nullable(),
  hostUserIds: z.array(z.string().uuid()).optional(),
  seatsPerSlot: z.number().int().min(2).max(1000).optional().nullable(),
  locations: z.array(locationSchema).min(1, "At least one location is required"),
  bookingQuestions: z.array(bookingQuestionSchema).default([]),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  minimumNoticeMinutes: z.number().int().min(0).max(60 * 24 * 30).default(120),
  slotIntervalMinutes: z.number().int().min(5).max(24 * 60).optional().nullable(),
  futureBookingDays: z.number().int().min(1).max(365).default(60),
  bookingLimitCount: z.number().int().min(1).max(1000).optional().nullable(),
  bookingLimitWindow: z.enum(["day", "week", "month"]).optional().nullable(),
  requiresConfirmation: z.boolean().default(false),
  isActive: z.boolean().default(true),
  priceAmount: z.number().int().min(0).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
};

const createEventTypeSchema = z
  .object(baseFields)
  .refine((v) => (v.bookingLimitCount ? !!v.bookingLimitWindow : true), {
    message: "bookingLimitWindow is required when bookingLimitCount is set",
    path: ["bookingLimitWindow"],
  })
  .refine((v) => (v.priceAmount ? !!v.currency : true), {
    message: "currency is required when priceAmount is set",
    path: ["currency"],
  })
  .refine((v) => (v.teamId ? !!v.schedulingType : true), {
    message: "schedulingType is required for team event types",
    path: ["schedulingType"],
  })
  .refine((v) => (v.schedulingType ? !!v.teamId : true), {
    message: "schedulingType only applies to team event types (teamId is required)",
    path: ["teamId"],
  })
  .refine((v) => (v.teamId ? (v.hostUserIds && v.hostUserIds.length > 0) : true), {
    message: "A team event type needs at least one host",
    path: ["hostUserIds"],
  })
  .refine((v) => (v.seatsPerSlot ? !v.requiresConfirmation : true), {
    message: "Group events (seatsPerSlot) can't require confirmation",
    path: ["seatsPerSlot"],
  })
  .refine((v) => (v.seatsPerSlot ? !v.teamId : true), {
    message:
      "Group events (seatsPerSlot) aren't supported on team event types yet — only personal event types",
    path: ["seatsPerSlot"],
  });

const updateEventTypeSchema = z.object(
  Object.fromEntries(Object.entries(baseFields).map(([key, schema]) => [key, schema.optional()]))
);

module.exports = { createEventTypeSchema, updateEventTypeSchema };

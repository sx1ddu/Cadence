const { z } = require("zod");

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:MM 24-hour format");

const ruleSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Each rule needs at least one day")
      .max(7),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((rule) => rule.startTime < rule.endTime, {
    message: "startTime must be before endTime",
    path: ["endTime"],
  });

const createScheduleSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(100),
  isDefault: z.boolean().optional().default(false),
  rules: z.array(ruleSchema).default([]),
});

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
  rules: z.array(ruleSchema).optional(),
});

const overrideSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    isUnavailable: z.boolean().default(false),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
  })
  .refine((o) => o.isUnavailable || (o.startTime && o.endTime), {
    message: "startTime and endTime are required unless isUnavailable is true",
  })
  .refine((o) => o.isUnavailable || o.startTime < o.endTime, {
    message: "startTime must be before endTime",
    path: ["endTime"],
  });

module.exports = { createScheduleSchema, updateScheduleSchema, overrideSchema };

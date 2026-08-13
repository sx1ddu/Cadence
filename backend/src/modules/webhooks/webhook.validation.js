const { z } = require("zod");

const WEBHOOK_EVENT_TYPES = [
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.rejected",
];

const createWebhookSchema = z.object({
  targetUrl: z.string().url().max(500),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, "Select at least one event type"),
});

const updateWebhookSchema = z.object({
  targetUrl: z.string().url().max(500).optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
  isActive: z.boolean().optional(),
});

module.exports = { createWebhookSchema, updateWebhookSchema, WEBHOOK_EVENT_TYPES };

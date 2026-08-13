const { z } = require("zod");

const slugSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens");

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
});

const createSubTeamSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
});

module.exports = { createOrganizationSchema, createSubTeamSchema };

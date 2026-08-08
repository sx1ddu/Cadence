const { z } = require("zod");

const slugSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens");

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: slugSchema.optional(),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

module.exports = { createTeamSchema, updateTeamSchema, addMemberSchema, updateMemberRoleSchema };

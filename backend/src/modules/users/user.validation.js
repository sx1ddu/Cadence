const { z } = require("zod");

const usernameSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Username can only contain lowercase letters, numbers, and hyphens");

const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  username: usernameSchema.optional(),
  bio: z.string().max(1000).optional().nullable(),
  timezone: z.string().min(1).max(100).optional(),
});

module.exports = { updateProfileSchema };

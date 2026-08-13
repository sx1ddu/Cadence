const { z } = require("zod");

const setUserActiveSchema = z.object({
  isActive: z.boolean(),
});

const setUserRoleSchema = z.object({
  role: z.enum(["user", "admin"]),
});

module.exports = { setUserActiveSchema, setUserRoleSchema };

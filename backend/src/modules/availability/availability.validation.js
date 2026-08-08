const { z } = require("zod");

const slotsQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
    timezone: z.string().max(100).optional(),
  })
  .refine((v) => v.from <= v.to, { message: "from must not be after to", path: ["to"] })
  .refine(
    (v) => {
      const days = (new Date(v.to) - new Date(v.from)) / (1000 * 60 * 60 * 24);
      return days <= 60;
    },
    { message: "Date range can't exceed 60 days per request", path: ["to"] }
  );

module.exports = { slotsQuerySchema };

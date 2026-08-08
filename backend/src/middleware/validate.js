const ApiError = require("../utils/ApiError");

/**
 * Creates an Express middleware that validates req.body (or req.query /
 * req.params) against a Zod schema. On failure, throws a 400 ApiError
 * with the field-level issues attached — on success, REPLACES the
 * relevant req property with the parsed (and type-coerced) data, so
 * controllers can trust it downstream.
 *
 * Usage:
 *   router.post('/signup', validate(signupSchema), controller.signup)
 *   router.get('/slots', validate(slotsQuerySchema, 'query'), controller.getSlots)
 */
function validate(schema, source = "body") {
  return function (req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return next(ApiError.badRequest("Validation failed", details));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = validate;

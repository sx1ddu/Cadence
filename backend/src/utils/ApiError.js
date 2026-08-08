/**
 * A predictable error shape for anything that should produce a specific
 * HTTP status + message (as opposed to an unexpected bug, which becomes
 * a generic 500 in the error handler).
 *
 * Usage: throw new ApiError(404, "Booking not found");
 */
class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details; // optional extra info, e.g. Zod field errors
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message);
  }
  static forbidden(message = "Forbidden") {
    return new ApiError(403, message);
  }
  static notFound(message = "Not found") {
    return new ApiError(404, message);
  }
  static conflict(message) {
    return new ApiError(409, message);
  }
  static tooMany(message = "Too many requests") {
    return new ApiError(429, message);
  }
  static internal(message = "Something went wrong") {
    return new ApiError(500, message);
  }
}

module.exports = ApiError;

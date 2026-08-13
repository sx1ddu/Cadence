const ApiError = require("../utils/ApiError");
const env = require("../config/env");

/**
 * Must be registered LAST in app.js (after all routes).
 * Any error passed to next(err) — or thrown inside an asyncHandler —
 * ends up here.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  // Duplicate-entry errors from MySQL (unique constraint violations)
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      message: "A record with these details already exists.",
    });
  }

  // Foreign-key restrict violations (e.g. deleting a row something else depends on)
  if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
    return res.status(409).json({
      success: false,
      message: "This record can't be deleted because other records depend on it.",
    });
  }

  // CHECK constraint violations (e.g. an inconsistent combination of columns)
  if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
    return res.status(400).json({
      success: false,
      message: "That combination of fields isn't valid.",
    });
  }

  // Multer errors (e.g. file too large, unexpected field name)
  if (err.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 5MB)." : err.message,
    });
  }

  console.error("[unhandled error]", err);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    // Only leak the stack trace in development
    stack: env.isProduction ? undefined : err.stack,
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFoundHandler };

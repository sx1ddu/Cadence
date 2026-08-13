const multer = require("multer");
const ApiError = require("../utils/ApiError");

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Holds the uploaded file in memory (as a Buffer) rather than writing it
 * to disk first — avatars are small (capped at 5MB below) and we
 * immediately stream the buffer straight to Cloudinary, so there's no
 * reason to touch the filesystem at all.
 */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(ApiError.badRequest("Only JPEG, PNG, WEBP, or GIF images are allowed."));
    }
    cb(null, true);
  },
});

module.exports = { upload, MAX_FILE_SIZE_BYTES };

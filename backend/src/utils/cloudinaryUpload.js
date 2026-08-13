const cloudinary = require("../config/cloudinary");

/**
 * Streams a Buffer (from multer's memory storage) up to Cloudinary.
 * Cloudinary's SDK only exposes a stream-based upload API for buffers
 * (there's no "just pass a Buffer" method), so this wraps that stream in
 * a Promise for normal async/await use everywhere else in the codebase.
 */
function uploadImageBuffer(buffer, { folder, publicIdPrefix }) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: `${publicIdPrefix}-${Date.now()}`,
        resource_type: "image",
        overwrite: true,
        transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

async function deleteImage(publicId) {
  if (!publicId) return;
  // Best-effort cleanup — if this fails (e.g. already deleted), it's not
  // worth blocking the user's actual request (a profile update) over.
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error(`[cloudinary] failed to delete ${publicId}:`, err.message);
  }
}

module.exports = { uploadImageBuffer, deleteImage };

const ApiError = require("../../utils/ApiError");
const userRepo = require("./user.repository");
const { uploadImageBuffer, deleteImage } = require("../../utils/cloudinaryUpload");

async function getPublicProfile(username) {
  const user = await userRepo.findByUsername(username);
  if (!user) throw ApiError.notFound("User not found.");
  return userRepo.toPublicProfile(user);
}

async function updateProfile(userId, input) {
  if (input.username) {
    const existing = await userRepo.findByUsername(input.username);
    if (existing && existing.id !== userId) {
      throw ApiError.conflict("This username is already taken.");
    }
  }
  const updated = await userRepo.updateProfile(userId, input);
  return userRepo.toPublicUser(updated);
}

async function uploadAvatar(userId, fileBuffer) {
  const currentUser = await userRepo.findById(userId);
  if (!currentUser) throw ApiError.notFound("User not found.");

  const result = await uploadImageBuffer(fileBuffer, {
    folder: "cadence/avatars",
    publicIdPrefix: `user-${userId}`,
  });

  const updated = await userRepo.updateProfile(userId, {
    avatarUrl: result.secure_url,
  });
  await userRepo.updateAvatarPublicId(userId, result.public_id);

  // Clean up the OLD avatar on Cloudinary now that the new one is saved
  // (best-effort — see deleteImage's own error handling).
  if (currentUser.avatar_public_id && currentUser.avatar_public_id !== result.public_id) {
    await deleteImage(currentUser.avatar_public_id);
  }

  return userRepo.toPublicUser(updated);
}

module.exports = { getPublicProfile, updateProfile, uploadAvatar };

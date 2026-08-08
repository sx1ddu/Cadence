const ApiError = require("../../utils/ApiError");
const userRepo = require("./user.repository");

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

module.exports = { getPublicProfile, updateProfile };

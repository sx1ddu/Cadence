const ApiError = require("../../utils/ApiError");
const userService = require("./user.service");
const asyncHandler = require("../../utils/asyncHandler");

const getPublicProfile = asyncHandler(async (req, res) => {
  const profile = await userService.getPublicProfile(req.params.username);
  res.json({ success: true, data: { profile } });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(req.dbUser.id, req.body);
  res.json({ success: true, data: { user } });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No image file was uploaded (expected field name 'avatar').");
  const user = await userService.uploadAvatar(req.dbUser.id, req.file.buffer);
  res.json({ success: true, data: { user } });
});

module.exports = { getPublicProfile, updateMe, uploadAvatar };

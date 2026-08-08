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

module.exports = { getPublicProfile, updateMe };

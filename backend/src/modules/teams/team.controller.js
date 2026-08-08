const teamService = require("./team.service");
const asyncHandler = require("../../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const teams = await teamService.listMyTeams(req.dbUser.id);
  res.json({ success: true, data: { teams } });
});

const getOne = asyncHandler(async (req, res) => {
  const team = await teamService.getTeam(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { team } });
});

const create = asyncHandler(async (req, res) => {
  const team = await teamService.createTeam(req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { team } });
});

const update = asyncHandler(async (req, res) => {
  const team = await teamService.updateTeam(req.params.id, req.dbUser.id, req.body);
  res.json({ success: true, data: { team } });
});

const remove = asyncHandler(async (req, res) => {
  await teamService.deleteTeam(req.params.id, req.dbUser.id);
  res.json({ success: true, message: "Team deleted." });
});

const addMember = asyncHandler(async (req, res) => {
  const team = await teamService.addMember(req.params.id, req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { team } });
});

const updateMemberRole = asyncHandler(async (req, res) => {
  const team = await teamService.updateMemberRole(
    req.params.id,
    req.params.userId,
    req.dbUser.id,
    req.body
  );
  res.json({ success: true, data: { team } });
});

const removeMember = asyncHandler(async (req, res) => {
  await teamService.removeMember(req.params.id, req.params.userId, req.dbUser.id);
  res.json({ success: true, message: "Member removed." });
});

// Public
const getPublicProfile = asyncHandler(async (req, res) => {
  const team = await teamService.getPublicTeamProfile(req.params.slug);
  res.json({ success: true, data: { team } });
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  addMember,
  updateMemberRole,
  removeMember,
  getPublicProfile,
};

const organizationService = require("./organization.service");
const asyncHandler = require("../../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const organizations = await organizationService.listMyOrganizations(req.dbUser.id);
  res.json({ success: true, data: { organizations } });
});

const create = asyncHandler(async (req, res) => {
  const organization = await organizationService.createOrganization(req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { organization } });
});

const listTeams = asyncHandler(async (req, res) => {
  const teams = await organizationService.listSubTeams(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { teams } });
});

const createTeam = asyncHandler(async (req, res) => {
  const team = await organizationService.createSubTeam(req.params.id, req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { team } });
});

module.exports = { list, create, listTeams, createTeam };

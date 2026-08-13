const ApiError = require("../../utils/ApiError");
const teamRepo = require("../teams/team.repository");

/**
 * Organizations reuse the SAME `teams` table as regular teams (a team
 * with is_organization=1), rather than a second parallel table — an
 * organization is really just a team that can OWN other teams (via their
 * parent_id). This avoids duplicating almost every column (name, slug,
 * membership, roles) across two near-identical tables. See the teams
 * migration for the original reasoning.
 */

async function listMyOrganizations(userId) {
  const teams = await teamRepo.listForUser(userId);
  return teams.filter((t) => t.is_organization).map((t) => teamRepo.toPublicTeam(t));
}

async function createOrganization(userId, input) {
  const existing = await teamRepo.findBySlug(input.slug);
  if (existing) throw ApiError.conflict("This slug is already taken.");

  const teamId = await teamRepo.createTeam({
    name: input.name,
    slug: input.slug,
    ownerId: userId,
    isOrganization: true,
  });

  const team = await teamRepo.findById(teamId);
  const members = await teamRepo.getMembers(teamId);
  return teamRepo.toPublicTeam(team, members);
}

async function getOrganizationOr404(publicId) {
  const org = await teamRepo.findByPublicId(publicId);
  if (!org || !org.is_organization) throw ApiError.notFound("Organization not found.");
  return org;
}

async function listSubTeams(orgPublicId, userId) {
  const org = await getOrganizationOr404(orgPublicId);
  const membership = await teamRepo.findMembership(org.id, userId);
  if (!membership) throw ApiError.forbidden("You're not a member of this organization.");

  const subTeams = await teamRepo.listByParent(org.id);
  return subTeams.map((t) => teamRepo.toPublicTeam(t));
}

async function createSubTeam(orgPublicId, userId, input) {
  const org = await getOrganizationOr404(orgPublicId);
  const membership = await teamRepo.findMembership(org.id, userId);
  if (!membership || membership.role !== "admin") {
    throw ApiError.forbidden("Only organization admins can create teams within it.");
  }

  const existing = await teamRepo.findBySlug(input.slug);
  if (existing) throw ApiError.conflict("This slug is already taken.");

  const teamId = await teamRepo.createTeam({
    name: input.name,
    slug: input.slug,
    ownerId: userId,
    isOrganization: false,
    parentId: org.id,
  });

  const team = await teamRepo.findById(teamId);
  const members = await teamRepo.getMembers(teamId);
  return teamRepo.toPublicTeam(team, members);
}

module.exports = {
  listMyOrganizations,
  createOrganization,
  getOrganizationOr404,
  listSubTeams,
  createSubTeam,
};

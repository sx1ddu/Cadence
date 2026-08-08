const ApiError = require("../../utils/ApiError");
const teamRepo = require("./team.repository");
const userRepo = require("../users/user.repository");

async function getTeamOr404(publicId) {
  const team = await teamRepo.findByPublicId(publicId);
  if (!team) throw ApiError.notFound("Team not found.");
  return team;
}

async function requireMembership(teamId, userId) {
  const membership = await teamRepo.findMembership(teamId, userId);
  if (!membership) throw ApiError.forbidden("You're not a member of this team.");
  return membership;
}

async function requireAdmin(teamId, userId) {
  const membership = await requireMembership(teamId, userId);
  if (membership.role !== "admin") throw ApiError.forbidden("Only team admins can do this.");
  return membership;
}

async function listMyTeams(userId) {
  const teams = await teamRepo.listForUser(userId);
  return teams.map((t) => teamRepo.toPublicTeam(t));
}

async function getTeam(publicId, userId) {
  const team = await getTeamOr404(publicId);
  await requireMembership(team.id, userId);
  const members = await teamRepo.getMembers(team.id);
  return teamRepo.toPublicTeam(team, members);
}

async function createTeam(userId, input) {
  const existing = await teamRepo.findBySlug(input.slug);
  if (existing) throw ApiError.conflict("This team slug is already taken.");

  const teamId = await teamRepo.createTeam({
    name: input.name,
    slug: input.slug,
    ownerId: userId,
    isOrganization: false,
  });

  const team = await teamRepo.findById(teamId);
  const members = await teamRepo.getMembers(teamId);
  return teamRepo.toPublicTeam(team, members);
}

async function updateTeam(publicId, userId, input) {
  const team = await getTeamOr404(publicId);
  await requireAdmin(team.id, userId);

  if (input.slug && input.slug !== team.slug) {
    const existing = await teamRepo.findBySlug(input.slug);
    if (existing) throw ApiError.conflict("This team slug is already taken.");
  }

  await teamRepo.updateTeam(team.id, input);
  return getTeam(publicId, userId);
}

async function deleteTeam(publicId, userId) {
  const team = await getTeamOr404(publicId);
  if (team.owner_id !== userId) {
    throw ApiError.forbidden("Only the team owner can delete the team.");
  }
  await teamRepo.deleteTeam(team.id);
}

async function addMember(publicId, userId, input) {
  const team = await getTeamOr404(publicId);
  await requireAdmin(team.id, userId);

  const userToAdd = await userRepo.findByEmail(input.email);
  if (!userToAdd) {
    throw ApiError.notFound(
      "No Cadence account exists with that email yet. They need to sign up first."
    );
  }

  const existingMembership = await teamRepo.findMembership(team.id, userToAdd.id);
  if (existingMembership) throw ApiError.conflict("This user is already a team member.");

  await teamRepo.addMember(team.id, userToAdd.id, input.role);
  return getTeam(publicId, userId);
}

async function updateMemberRole(publicId, targetUserPublicId, requestingUserId, input) {
  const team = await getTeamOr404(publicId);
  await requireAdmin(team.id, requestingUserId);

  const targetUser = await userRepo.findByPublicId(targetUserPublicId);
  if (!targetUser) throw ApiError.notFound("User not found.");

  const membership = await teamRepo.findMembership(team.id, targetUser.id);
  if (!membership) throw ApiError.notFound("This user isn't a member of this team.");

  if (membership.role === "admin" && input.role === "member") {
    const adminCount = await teamRepo.countAdmins(team.id);
    if (adminCount <= 1) {
      throw ApiError.badRequest("A team must have at least one admin.");
    }
  }

  await teamRepo.updateMemberRole(team.id, targetUser.id, input.role);
  return getTeam(publicId, requestingUserId);
}

async function removeMember(publicId, targetUserPublicId, requestingUserId) {
  const team = await getTeamOr404(publicId);
  const targetUser = await userRepo.findByPublicId(targetUserPublicId);
  if (!targetUser) throw ApiError.notFound("User not found.");

  const isSelfLeaving = targetUser.id === requestingUserId;
  if (!isSelfLeaving) {
    await requireAdmin(team.id, requestingUserId);
  } else {
    await requireMembership(team.id, requestingUserId);
  }

  if (targetUser.id === team.owner_id) {
    throw ApiError.badRequest("The team owner can't be removed. Delete the team instead.");
  }

  const membership = await teamRepo.findMembership(team.id, targetUser.id);
  if (membership?.role === "admin") {
    const adminCount = await teamRepo.countAdmins(team.id);
    if (adminCount <= 1) {
      throw ApiError.badRequest("A team must have at least one admin.");
    }
  }

  await teamRepo.removeMember(team.id, targetUser.id);
}

async function getPublicTeamProfile(slug) {
  const team = await teamRepo.findBySlug(slug);
  if (!team) throw ApiError.notFound("Team not found.");
  return teamRepo.toPublicProfile(team);
}

module.exports = {
  getTeamOr404,
  requireMembership,
  requireAdmin,
  listMyTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addMember,
  updateMemberRole,
  removeMember,
  getPublicTeamProfile,
};

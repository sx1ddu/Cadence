const { v4: uuidv4 } = require("uuid");
const { pool, withTransaction } = require("../../config/db");

function toPublicTeam(row, members = []) {
  return {
    id: row.public_id,
    name: row.name,
    slug: row.slug,
    isOrganization: Boolean(row.is_organization),
    parentId: row.parent_public_id || null,
    ownerId: row.owner_public_id,
    members: members.map(toPublicMember),
    createdAt: row.created_at,
  };
}

function toPublicMember(row) {
  return {
    userId: row.public_id,
    name: row.name,
    username: row.username,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at,
  };
}

/** Trimmed shape for a team's public booking page. */
function toPublicProfile(row) {
  return {
    name: row.name,
    slug: row.slug,
  };
}

const SELECT_WITH_JOINS = `
  SELECT t.*, owner.public_id AS owner_public_id, parent.public_id AS parent_public_id
  FROM teams t
  JOIN users owner ON owner.id = t.owner_id
  LEFT JOIN teams parent ON parent.id = t.parent_id
`;

async function findByPublicId(publicId) {
  const [rows] = await pool.query(`${SELECT_WITH_JOINS} WHERE t.public_id = ? LIMIT 1`, [publicId]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(`${SELECT_WITH_JOINS} WHERE t.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findBySlug(slug) {
  const [rows] = await pool.query(`${SELECT_WITH_JOINS} WHERE t.slug = ? LIMIT 1`, [slug]);
  return rows[0] || null;
}

async function listForUser(userId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_JOINS}
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ?
     ORDER BY t.created_at ASC`,
    [userId]
  );
  return rows;
}

async function getMembers(teamId) {
  const [rows] = await pool.query(
    `SELECT u.public_id, u.name, u.username, u.email, u.avatar_url, tm.role, tm.joined_at
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY FIELD(tm.role, 'admin', 'member'), tm.joined_at ASC`,
    [teamId]
  );
  return rows;
}

async function findMembership(teamId, userId) {
  const [rows] = await pool.query(
    "SELECT * FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, userId]
  );
  return rows[0] || null;
}

/** Creates a team and adds the creator as an admin member, atomically. */
async function createTeam({ name, slug, ownerId, isOrganization, parentId }) {
  return withTransaction(async (conn) => {
    const publicId = uuidv4();
    const [result] = await conn.query(
      `INSERT INTO teams (public_id, name, slug, owner_id, is_organization, parent_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [publicId, name, slug, ownerId, isOrganization ? 1 : 0, parentId || null]
    );
    const teamId = result.insertId;

    await conn.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'admin')`,
      [teamId, ownerId]
    );

    return teamId;
  });
}

/** Sub-teams belonging to an organization (teams with parent_id = this org's internal id). */
async function listByParent(parentId) {
  const [rows] = await pool.query(`${SELECT_WITH_JOINS} WHERE t.parent_id = ? ORDER BY t.created_at ASC`, [
    parentId,
  ]);
  return rows;
}

async function updateTeam(teamId, { name, slug }) {
  const fields = [];
  const values = [];
  if (name !== undefined) {
    fields.push("name = ?");
    values.push(name);
  }
  if (slug !== undefined) {
    fields.push("slug = ?");
    values.push(slug);
  }
  if (fields.length === 0) return;
  values.push(teamId);
  await pool.query(`UPDATE teams SET ${fields.join(", ")} WHERE id = ?`, values);
}

async function deleteTeam(teamId) {
  await pool.query("DELETE FROM teams WHERE id = ?", [teamId]);
}

async function addMember(teamId, userId, role) {
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)",
    [teamId, userId, role]
  );
}

async function updateMemberRole(teamId, userId, role) {
  await pool.query("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?", [
    role,
    teamId,
    userId,
  ]);
}

async function removeMember(teamId, userId) {
  await pool.query("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
}

async function countAdmins(teamId) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM team_members WHERE team_id = ? AND role = 'admin'",
    [teamId]
  );
  return rows[0].count;
}

module.exports = {
  toPublicTeam,
  toPublicProfile,
  findByPublicId,
  findById,
  findBySlug,
  listForUser,
  listByParent,
  getMembers,
  findMembership,
  createTeam,
  updateTeam,
  deleteTeam,
  addMember,
  updateMemberRole,
  removeMember,
  countAdmins,
};

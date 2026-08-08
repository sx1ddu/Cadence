-- A Team is a shared booking namespace: /team/:slug instead of /:username.
-- An Organization is modeled as a Team with is_organization = 1 and no
-- parent_id — sub-teams inside an org point back at it via parent_id. This
-- mirrors Cal.com's own simplification (Team + parentId self-relation)
-- rather than inventing a second, parallel "Organization" table that
-- would duplicate almost every column here.
CREATE TABLE teams (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id        CHAR(36) NOT NULL,
  parent_id        BIGINT UNSIGNED NULL, -- set on sub-teams that belong to an organization
  name             VARCHAR(120) NOT NULL,
  slug             VARCHAR(120) NOT NULL,
  is_organization  TINYINT(1) NOT NULL DEFAULT 0,
  owner_id         BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_teams_public_id (public_id),
  UNIQUE KEY uq_teams_slug (slug),
  KEY idx_teams_parent (parent_id),
  KEY idx_teams_owner (owner_id),
  CONSTRAINT fk_teams_parent
    FOREIGN KEY (parent_id) REFERENCES teams(id) ON DELETE SET NULL,
  CONSTRAINT fk_teams_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership: who belongs to a team and with what role.
-- 'admin' can manage team settings, event types, and members.
-- 'member' can be assigned as a host on team event types but can't manage the team.
CREATE TABLE team_members (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  role       ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_team_members_team_user (team_id, user_id),
  KEY idx_team_members_user (user_id),
  CONSTRAINT fk_team_members_team
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

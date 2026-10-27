-- Sidebar favorites are computed (open task assigned to the user, see
-- DrizzleProjectMemberRepository.listProjectsWhere). The user can override that from
-- the project menu: TRUE pins the project to favorites, FALSE hides it, NULL keeps
-- the computed value. The legacy manual flag is_favorite (db/040) stays unused.
ALTER TABLE project_members
  ADD COLUMN favorite_override BOOLEAN NULL DEFAULT NULL;

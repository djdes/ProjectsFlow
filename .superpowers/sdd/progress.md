# Единое пространство + мгновенное делегирование + TG-меню — Progress Ledger

Plan: docs/superpowers/plans/2026-07-13-unified-workspace-instant-delegation.md
Branch: feat/unified-ws-delegation
Base commit: 157a60e
Worktree: C:/www/ProjectsFlow/.claude/worktrees/unified-ws-delegation

## Tasks (26)
- Task 1: complete (commit 6ff20d9, review clean — 1 Minor: report miscount, not code)
- Task 2: complete (commit 19bf453, review clean — 0 issues)
- Task 3: complete (commit 70a2eb9, review clean — 2 Minor: comment wording)
- Task 4: complete (commits 1e4921b..9aa504c, re-review clean after fix — inbox listing LEFT JOIN + projectRowVisibility predicate)
- Task 5: complete (commits bb2521e..f2cdd57, review clean after fix — requireWorkspaceEditor helper)
- Task 6: complete (commits 895796f..a4f9b74, review clean — Important deferred to Task 7: POST accept dual-resolve ws-token + ws-invite creation routes)
- Task 7: complete (commit c4a58b7, review clean — 2 Minor: email schema comment, stray blank line; closed T6 dual-accept gap)
- Task 8: complete (commit 89c7ed4, review clean — 2 Minor: no ActivityRecorder on join-accept [pre-existing], class comment wording)
- Task 9: complete (commit af7e68b, review clean — 1 Minor: brief Step 5 default-role addMember test not added, prod default correct)
- Task 10: complete (commit f9de444, review clean — SECTION B DONE). Orphans for final cleanup: EmailTemplateCatalog «invite» entry; ProjectInviteRepository.create/listPendingByProject/delete dead; CannotInviteToInboxError unreachable
- Task 11: complete (commits 037d6c3..639f0a9, review clean — all 4 create paths accepted+respondedAt; email no buttons)
- Task 12: complete (commits a1a557a..ba2209b, review clean — 1 Minor: stale header comment TaskDelegation.ts:3; ACTIVE=[accepted]; revertToUserId out of write; InviteAndDelegate/REST accept-decline-pending/invite-delegate deleted; Accept/Decline classes kept for Task 15)
- Task 13: complete (commit 29c5887, review clean — 3 Minor: no guard regression test, setStatus race-fallback silent-notify, temp shared decline-email until T15)
- Task 14: complete (commit a31e09c, review clean — 1 Minor: stale client comment useActionableUnreadCount.ts:7 [for T24]). Actionable={workspace_invite,project_invite,join_request}
- Task 15: complete (commits de675fd..ae0b082, review clean + test-fix errata#6 button assert). SECTION C DONE. Minor for final: dead getByDelegationId port, non-bisectable commit de675fd
- Task 16: complete (commit b4a5547, review clean — pure builders buildAssigneeMenu/buildAssigneeTaskCards, 8 tests). Minor for T17/18: valid assigneeUserId with 0 tasks → assigneeName null (header handling); sequential listByProject
- Task 17: complete (commit c555169, review clean — /tasks→assignee menu, ba:/bt:root routing, card registration, membership gate verified no-IDOR, bt:p: plain title). Minor: 3 unified «12» constants, forward-ref comment to handleGroupAssigneeMenu (T18)
- Task 18: complete (commit cfe230e, review clean — SECTION D DONE: empty group mention→menu owner scope, with-text→composer, setMyCommands /tasks). Minor for final: /help text «мои проекты и задачи» not synced with new /tasks «по ответственным» (HandleTelegramWebhook.ts:724)
- Task 19: complete (commit 24c8bea, review clean — SECTION E start: client WorkspaceInvite domain/port/Http, DTO 1:1 with server, additive). typecheck/lint/build gate (no client tests)
- Task 20: complete (commit fa8f9f5, review clean — InviteDialog→workspace, all 4 call sites, ProjectRepository invite methods removed grep 0, anon /invite untouched). Minor for T22: stale TeamSection comment L45 about pending-invites
- Task 21: complete (commit b673ec3, review clean — preview kind/targetName errata#8, accept #14, relinquish text, task_delegation no buttons, workspace_invite+chat_mention branches). Gap for final: CloseProposalPayload missing from client union (pre-existing, server has close_proposal)
- Task 22: complete (commit a32b04f, review clean — TeamSection read-only ws-members, WorkspaceSettingsPage roles+InvitesCard(!isDefault #22), ChatRoom/Workspace role widened #16, normalizeRole member→editor; client Concern B closed grep 0). Minor: owner-role select no confirm (brief-prescribed)
- Task 23: complete (commits ac716ad..dc3f022, review clean + doc-fix) — instant delegation UI, PendingCard/accept/decline/invite-delegate removed, badge accepted-only, repo 4 methods, union wide, 50/50 client tests
- Task 24: complete (commit 7091078, review clean — SECTION E DONE) — SECTION E: sweep clean, 6 stale comments fixed, ProjectRepository updateMemberRole/removeMember/transferOwnership removed (client Concern B port closed), build green x2. CloseProposalPayload left (pre-existing, degrades to blank row, TG-only, for final review)
(marked complete only after clean task review)

## Minor findings roll-up (for final whole-branch review)
- T1: report miscount (11 vs 12 literals) — not code, negligible
- T3: db/112 comments ref «§7.3» (flat list) & redundant SET-order note — cosmetic
- T6: activityRecorder redundant getWorkspaceId round-trip; missing «already used» test coverage (ws+legacy) — low risk
- T7: createWorkspaceInviteSchema.email .transform comment misleading (empty string still rejected by .email); stray double blank line projects/routes.ts:185
- T8: join-request accept lacks ActivityRecorder member_added (asymmetry w AcceptProjectInvite, pre-existing not regression) — consider follow-up
- T9: addMember default-role branch (editor) has no test coverage — brief Step 5 test skipped, prod default correct/verified
- T21 carry-forward: client NotificationItem hardcodes «отклонил» for task_delegation_resolved/declined — now means «снял с себя» (decline deleted). Task 21 must update text.
- T13 Minor for final: RelinquishTaskDelegation stale-snapshot notify if setStatus races null (sibling Decline throws DelegationNotFoundError); no pending_invite-reject regression test

## Notes

## Deployment-ordering risks (for finishing-a-development-branch — MERGE WHOLE BRANCH, never deploy Task 4 standalone)
- Task 4 made ProjectMemberRepository.add() write only to project_members (settings), NOT grant access. Callers AcceptProjectInvite (Task 6 rewrites), ResolveProjectJoinRequest (Task 8 rewrites), AcceptTaskDelegation (Task 15 deletes) rely on it granting access. Safe ONLY if branch merges as a whole. Branch push does NOT autodeploy (autodeploy = push to main); we merge at the very end.
- Concern B (Task 4): TransferProjectOwnership/UpdateProjectMemberRole/RemoveProjectMember use-cases + /api/projects/:id/members/* routes now inert (touch project_members settings only, no access effect). Client TeamSection.tsx still calls them. NO tracked task removes them → decide at final review whether to redirect to workspace-level (spec §3.2 says team mgmt moves to workspace) or leave inert. FLAG for final whole-branch review.
- Task 25: complete (commit 5e43955, verified — 4 gates GREEN: server tests 333/333, typecheck 0, lint 0, build exit 0; sweeps clean; 3 migrations present; fixed dead WithdrawTaskDelegation pending_invite guard)
- Task 26: complete (no code commit — verification-only task) — prod-verify artifacts prepared in scratchpad (prod-verify.mjs, ui-check.mjs, demo-cleanup.sql) + owner checklist in task-26-report.md; errata #9 (delegation id/status live under task.delegation, not top-level) and #18 (TG delegation scenario via composer, web→TG delegate notify is follow-up) applied; all API fields cross-checked against live routes.ts/schemas.ts. NOT run against prod (needs deploy — owner's job). ALL 26 TASKS DONE — branch ready for finishing-a-development-branch (whole-branch review, then merge+deploy+run these scripts).

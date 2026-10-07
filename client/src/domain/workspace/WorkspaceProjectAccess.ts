export type WorkspaceAccessProject = { readonly id: string; readonly name: string; readonly icon: string | null };

export type WorkspaceProjectAccess = {
  readonly projects: WorkspaceAccessProject[];
  readonly members: Array<{ readonly userId: string; readonly hiddenProjectIds: string[] }>;
};

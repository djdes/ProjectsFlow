import type { DeploymentRun } from '../../domain/deployment/DeploymentStatus.js';

export interface DeploymentStatusRepository {
  latest(): Promise<DeploymentRun | null>;
}
export interface DeployedRevision {
  read(): Promise<string | null>;
}

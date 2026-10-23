import type { DeploymentStatus } from '@/domain/deployment/DeploymentStatus';

export interface DeploymentRepository {
  getStatus(): Promise<DeploymentStatus>;
}

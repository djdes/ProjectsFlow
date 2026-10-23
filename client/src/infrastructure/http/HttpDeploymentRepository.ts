import type { DeploymentRepository } from '@/application/deployment/DeploymentRepository';
import type { DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
import { httpClient } from './httpClient';

export class HttpDeploymentRepository implements DeploymentRepository {
  getStatus(): Promise<DeploymentStatus> {
    return httpClient.get<DeploymentStatus>('/platform/deployment');
  }
}

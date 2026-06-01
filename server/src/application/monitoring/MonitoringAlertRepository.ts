import type { ServerAlert } from '../../domain/monitoring/Alert.js';

export interface MonitoringAlertRepository {
  listActiveByServer(serverId: string): Promise<ServerAlert[]>;
  listActiveByProject(projectId: string): Promise<ServerAlert[]>;
  listByProject(projectId: string, limit: number): Promise<ServerAlert[]>;
  insert(alert: ServerAlert): Promise<void>;
  touchLastSeen(id: string, at: Date): Promise<void>;
  markNotified(id: string, at: Date): Promise<void>;
  resolve(id: string, at: Date): Promise<void>;
}

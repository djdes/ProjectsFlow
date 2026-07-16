import type { Database } from '../db/index.js';
import { productActionEvents } from '../db/schema.js';
import type { ProductTelemetryRepository } from '../../application/telemetry/ProductTelemetryRepository.js';

export class DrizzleProductTelemetryRepository implements ProductTelemetryRepository {
  constructor(private readonly db: Database) {}

  async record(input: Parameters<ProductTelemetryRepository['record']>[0]): Promise<void> {
    await this.db.insert(productActionEvents).values(input);
  }
}

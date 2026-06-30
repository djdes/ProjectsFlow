import type { UsageSummary } from '@/domain/usage/Usage';
import type { UsageRepository } from './UsageRepository';

export class GetUsage {
  constructor(private readonly repo: UsageRepository) {}

  execute(): Promise<UsageSummary> {
    return this.repo.getUsage();
  }
}

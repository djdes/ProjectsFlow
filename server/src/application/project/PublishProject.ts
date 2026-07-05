import { generatePublicSlug } from '../../domain/project/publicSlug.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type PublishProjectCommand = {
  readonly id: string;
  // Исторически ownerId в сигнатурах = userId текущего запроса (см. UpdateProject).
  readonly ownerId: string;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  // Инъекция генератора slug — для тестов (детерминизм) и для прод-настройки источника
  // случайности. По умолчанию — доменный generatePublicSlug (Math.random).
  readonly generateSlug?: () => string;
};

const MAX_SLUG_ATTEMPTS = 5;

// Опубликовать доску проекта (Publish to web). Owner-only. Если у проекта уже есть
// public_slug — повторно публикуем с тем же slug (тот же URL, как в Notion). Иначе
// генерируем новый и повторяем при коллизии UNIQUE-индекса.
export class PublishProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: PublishProjectCommand): Promise<{ slug: string }> {
    const { project } = await requireProjectAccess(
      this.deps,
      cmd.id,
      cmd.ownerId,
      'manage_public_link',
    );

    // Уже публиковали → тот же slug (повторная публикация не меняет URL).
    if (project.publicSlug) {
      await this.deps.projects.publish(cmd.id, project.publicSlug);
      return { slug: project.publicSlug };
    }

    const gen = this.deps.generateSlug ?? generatePublicSlug;
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = gen();
      const result = await this.deps.projects.publish(cmd.id, slug);
      if (result === 'ok') return { slug };
    }
    // Практически недостижимо (>50 бит энтропии на slug). Fallback — 500.
    throw new Error('Failed to generate a unique public slug after retries');
  }
}

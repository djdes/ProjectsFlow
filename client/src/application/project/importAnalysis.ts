import type {
  ProjectImportAnalysis,
  ProjectImportSupportStatus,
} from './ProjectRepository';

export const IMPORT_STATUS_COPY: Readonly<Record<ProjectImportSupportStatus, {
  title: string;
  description: string;
}>> = {
  supported: {
    title: 'Можно импортировать',
    description: 'Проект совместим с безопасной статической публикацией ProjectsFlow.',
  },
  needs_config: {
    title: 'Сначала нужна настройка',
    description: 'GitHub не будет изменён, пока отмеченные проблемы не исправлены.',
  },
  unsupported: {
    title: 'Пока не поддерживается',
    description: 'Проекту нужен runtime, которого ещё нет в ProjectsFlow.',
  },
};

export function canCommitProjectImport(analysis: ProjectImportAnalysis | null): boolean {
  return analysis?.status === 'supported';
}

export function projectImportTechnology(analysis: ProjectImportAnalysis): string {
  const framework = analysis.framework ?? analysis.kind;
  const packageManager = analysis.packageManager === 'none' ? null : analysis.packageManager;
  return [framework, packageManager, analysis.outputDir ? `→ ${analysis.outputDir}` : null]
    .filter(Boolean)
    .join(' · ');
}

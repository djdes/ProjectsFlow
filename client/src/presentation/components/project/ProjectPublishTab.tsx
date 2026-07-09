import { useState } from 'react';
import {
  ChevronRight,
  Code2,
  Copy,
  Loader2,
  Paintbrush,
  Search,
  Settings,
  Share2,
  Copy as CopyTemplate,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { publicBoardUrl, publicBoardDisplayUrl } from '@/lib/publicBoardUrl';
import { emitPublishChanged } from '@/presentation/lib/publishEvents';

type Props = {
  project: Project;
  isOwner: boolean;
};

// Серая строка-заглушка (функция появится позже) — как в Notion, но disabled.
function StubRow({
  icon,
  label,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground/60"
      aria-disabled
    >
      <span className="shrink-0 opacity-60">{icon}</span>
      <span className="flex-1">{label}</span>
      {right ?? <ChevronRight className="size-4 opacity-40" />}
    </div>
  );
}

// Вкладка Publish окна «Поделиться» (Publish to web, db/096). Пиксельно повторяет Notion:
// состояние «не опубликовано» (превью + большая синяя кнопка) и «опубликовано» (URL +
// настройки). Реально работают: Publish/Unpublish, Copy link, View site, Search indexing.
// Серым — Customize styling, Duplicate as template, Manage all sites, Embed, Share via social.
export function ProjectPublishTab({ project, isOwner }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [isPublic, setIsPublic] = useState(project.isPublic);
  const [slug, setSlug] = useState<string | null>(project.publicSlug);
  const [indexing, setIndexing] = useState(project.publicIndexing);
  const [busy, setBusy] = useState(false);

  const emit = (next: { isPublic: boolean; slug: string | null; indexing: boolean }): void => {
    emitPublishChanged({
      projectId: project.id,
      isPublic: next.isPublic,
      publicSlug: next.slug,
      publicIndexing: next.indexing,
    });
  };

  const doPublish = async (): Promise<void> => {
    setBusy(true);
    try {
      const { slug: newSlug } = await projectRepository.publish(project.id);
      setSlug(newSlug);
      setIsPublic(true);
      emit({ isPublic: true, slug: newSlug, indexing });
      toast.success('Проект опубликован');
    } catch {
      toast.error('Не удалось опубликовать');
    } finally {
      setBusy(false);
    }
  };

  const doUnpublish = async (): Promise<void> => {
    setBusy(true);
    try {
      await projectRepository.unpublish(project.id);
      setIsPublic(false);
      emit({ isPublic: false, slug, indexing });
      toast.success('Публикация снята');
    } catch {
      toast.error('Не удалось снять с публикации');
    } finally {
      setBusy(false);
    }
  };

  const toggleIndexing = async (v: boolean): Promise<void> => {
    setIndexing(v);
    try {
      await projectRepository.setPublicIndexing(project.id, v);
      emit({ isPublic, slug, indexing: v });
    } catch {
      setIndexing(!v);
      toast.error('Не удалось изменить настройку');
    }
  };

  const copyLink = (): void => {
    if (!slug) return;
    void navigator.clipboard.writeText(publicBoardUrl(slug));
    toast.success('Ссылка скопирована');
  };

  const viewSite = (): void => {
    if (slug) window.open(publicBoardUrl(slug), '_blank', 'noopener');
  };

  // === Состояние: НЕ опубликовано ===
  if (!isPublic) {
    return (
      <div className="px-4 py-3">
        <div className="text-center">
          <h3 className="text-base font-semibold text-foreground">Опубликовать доску</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Публичная страница с канбаном проекта</p>
        </div>

        {/* Мини-превью доски (обложка + иконка + имя) — как «окно» на скрине Notion. */}
        <div className="mt-3 overflow-hidden rounded-lg border border-black/[0.08] shadow-sm dark:border-white/10">
          <div className="flex h-7 items-center gap-1.5 border-b border-black/[0.06] bg-black/[0.02] px-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <span className="size-2 rounded-full bg-black/10 dark:bg-white/15" />
            <span className="size-2 rounded-full bg-black/10 dark:bg-white/15" />
            <span className="size-2 rounded-full bg-black/10 dark:bg-white/15" />
          </div>
          <div
            className="h-16 w-full"
            style={project.coverUrl ? coverStyle(project.coverUrl, project.coverPosition) : { background: '#2f9bd4' }}
            aria-hidden
          />
          <div className="flex items-center gap-2 px-3 py-3">
            {project.icon && (
              <span className="grid size-6 shrink-0 place-items-center text-xl leading-none">
                <ProjectIconView icon={project.icon} pixelSize={22} />
              </span>
            )}
            <span className="truncate text-lg font-bold text-[#37352f] dark:text-blue-50">
              {project.name}
            </span>
          </div>
        </div>

        <Button
          type="button"
          className="mt-3 h-10 w-full text-sm"
          disabled={!isOwner || busy}
          onClick={() => void doPublish()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Опубликовать
        </Button>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          {isOwner
            ? 'После публикации любой, у кого есть ссылка, увидит доску проекта.'
            : 'Публиковать проект может только владелец.'}
        </p>
      </div>
    );
  }

  // === Состояние: опубликовано ===
  return (
    <div className="px-3 py-3">
      {/* URL-строка: projectsflow.ru/p/<slug> + копирование. */}
      <div className="flex items-center gap-1.5 rounded-md border border-black/[0.08] bg-black/[0.02] px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
        <span className="min-w-0 flex-1 truncate text-[13px] text-blue-600 dark:text-blue-400">
          {slug ? publicBoardDisplayUrl(slug) : ''}
        </span>
        <button
          type="button"
          onClick={copyLink}
          aria-label="Скопировать ссылку"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/10"
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      <div className="mt-2 space-y-0.5">
        <StubRow icon={<Paintbrush className="size-4" />} label="Настроить оформление сайта" />

        {/* Реальный тоггл индексации. */}
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground">
          <Search className="size-4 shrink-0 opacity-70" />
          <span className="flex-1">Индексация поисковиками</span>
          <Switch
            checked={indexing}
            onCheckedChange={(v) => void toggleIndexing(v)}
            disabled={!isOwner}
            aria-label="Индексация поисковиками"
          />
        </div>

        <StubRow
          icon={<CopyTemplate className="size-4" />}
          label="Дублировать как шаблон"
          right={
            <Switch
              checked={false}
              onCheckedChange={() => {}}
              disabled
              aria-label="Дублировать как шаблон (недоступно)"
            />
          }
        />
        <StubRow icon={<Settings className="size-4" />} label="Управление сайтами и ссылками" />

        <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />

        <StubRow icon={<Code2 className="size-4" />} label="Встроить эту страницу" />
        <StubRow icon={<Share2 className="size-4" />} label="Поделиться в соцсетях" />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 flex-1"
          disabled={!isOwner || busy}
          onClick={() => void doUnpublish()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Снять с публикации
        </Button>
        <Button type="button" className="h-9 flex-1" onClick={viewSite}>
          Открыть сайт
        </Button>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';

type ThemePreset = {
  id: string;
  label: string;
  font: string;
  colors: [string, string, string, string, string];
};

const PRESETS: readonly ThemePreset[] = [
  { id: 'electric', label: 'Electric blue', font: 'Inter', colors: ['#1677ff', '#f8fafc', '#ffffff', '#3b82f6', '#0f172a'] },
  { id: 'forest', label: 'Forest', font: 'Manrope', colors: ['#27734d', '#effdf5', '#d1fae5', '#1f6b45', '#064e3b'] },
  { id: 'violet', label: 'Violet', font: 'Inter', colors: ['#635bff', '#1f2937', '#64748b', '#818cf8', '#f8fafc'] },
  { id: 'amber', label: 'Amber', font: 'DM Sans', colors: ['#e77800', '#fffbeb', '#fff7d6', '#b45309', '#431407'] },
  { id: 'ruby', label: 'Ruby', font: 'Manrope', colors: ['#e11d48', '#fff1f2', '#fecdd3', '#be123c', '#4c0519'] },
];

export function StudioThemePanel({
  conversationId,
  projectName,
  onClose,
}: {
  conversationId: string;
  projectName: string;
  onClose: () => void;
}): React.ReactElement {
  const { aiConversationRepository } = useContainer();
  const [selectedId, setSelectedId] = useState(PRESETS[0]!.id);
  const [primary, setPrimary] = useState(PRESETS[0]!.colors[0]);
  const [background, setBackground] = useState(PRESETS[0]!.colors[1]);
  const [font, setFont] = useState(PRESETS[0]!.font);
  const [sending, setSending] = useState(false);
  const selected = useMemo(() => PRESETS.find((preset) => preset.id === selectedId) ?? PRESETS[0]!, [selectedId]);

  const choosePreset = (preset: ThemePreset): void => {
    setSelectedId(preset.id);
    setPrimary(preset.colors[0]);
    setBackground(preset.colors[1]);
    setFont(preset.font);
  };

  const sendToChat = async (): Promise<void> => {
    if (sending) return;
    setSending(true);
    try {
      await aiConversationRepository.sendMessage(conversationId, {
        body: `Обнови тему проекта «${projectName}». Используй стиль «${selected.label}»: основной цвет ${primary}, фон ${background}, шрифт ${font}. Сохрани доступность, контраст и адаптивность. Сначала покажи краткий план изменений и не публикуй их без подтверждения.`,
        clientRequestId: crypto.randomUUID(),
        mode: 'studio_plan',
      });
      toast.success('Настройки темы отправлены в чат проекта');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить тему в чат');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="absolute inset-0 z-40 flex min-h-0 flex-col bg-background" aria-label="Тема проекта">
      <header className="flex h-[70px] shrink-0 items-start justify-between border-b px-5 py-3.5">
        <div>
          <h2 className="text-lg font-semibold">Тема</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Цвета и шрифт будут переданы ИИ как точное изменение проекта.</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Закрыть тему"><X className="size-4" /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <Button type="button" className="h-11 w-full gap-2 bg-foreground text-background hover:bg-foreground/90" onClick={() => document.getElementById('pf-custom-theme')?.scrollIntoView({ behavior: 'smooth' })}>
          <Sparkles className="size-4" /> Создать свою тему
        </Button>

        <div className="mt-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Готовые темы</h3>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Обновить темы" onClick={() => choosePreset(PRESETS[(PRESETS.findIndex((item) => item.id === selectedId) + 1) % PRESETS.length]!)}><RefreshCw className="size-4" /></Button>
        </div>
        <div className="mt-2 space-y-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => choosePreset(preset)}
              aria-pressed={selectedId === preset.id}
              className={cn('group relative flex w-full overflow-hidden rounded-xl border text-left transition hover:border-foreground/30', selectedId === preset.id && 'border-primary ring-2 ring-primary/15')}
            >
              <span className="grid w-24 shrink-0 place-items-center text-3xl font-medium text-white" style={{ background: preset.colors[0], fontFamily: preset.font }}>Aa</span>
              <span className="flex min-w-0 flex-1">
                {preset.colors.slice(1).map((color) => <span key={color} className="h-16 flex-1" style={{ background: color }} />)}
              </span>
              {selectedId === preset.id && <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span>}
              <span className="sr-only">{preset.label}</span>
            </button>
          ))}
        </div>

        <div id="pf-custom-theme" className="mt-6 rounded-xl border bg-muted/15 p-4">
          <h3 className="text-sm font-semibold">Своя тема</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Основной цвет<Input type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} className="mt-1 h-10 w-full p-1" /></label>
            <label className="text-xs text-muted-foreground">Фон<Input type="color" value={background} onChange={(event) => setBackground(event.target.value)} className="mt-1 h-10 w-full p-1" /></label>
          </div>
          <label className="mt-3 block text-xs text-muted-foreground">Шрифт<Input value={font} onChange={(event) => setFont(event.target.value)} className="mt-1" placeholder="Inter" /></label>
        </div>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t bg-background p-4">
        <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="button" disabled={sending} onClick={() => void sendToChat()}>{sending && <Loader2 className="mr-2 size-4 animate-spin" />}Передать в чат</Button>
      </footer>
    </section>
  );
}

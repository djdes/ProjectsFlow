import { Bot, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

// I6: оффер-замок на колонке «Воркер» (status=todo) для бесплатного тарифа. Колонка под ним
// приглушается, а поверх — привлекательный оффер (по методу Хормози: мечта+статус сверху,
// стек ценности, снятие риска пробным часом). Кнопка открывает витрину тарифов (onUpgrade).
// Абсолютно позиционируется в relative-контейнере тела колонки, перехватывает клики.
export function WorkerLockOffer({ onUpgrade }: { onUpgrade: () => void }): React.ReactElement {
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-center rounded-xl bg-gradient-to-b from-muted/70 via-background/85 to-background/95 p-4 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Bot className="size-6" />
        </span>

        {/* Мечта + статус (верх уравнения ценности). */}
        <div className="space-y-1.5">
          <p className="text-[15px] font-bold leading-tight text-foreground">
            Задачи делаются сами — пока&nbsp;ты&nbsp;спишь
          </p>
          <p className="mx-auto max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
            AI-воркер на&nbsp;Claude&nbsp;Opus сам берёт задачи из&nbsp;этой колонки и&nbsp;доводит
            их до&nbsp;готового результата. Без&nbsp;тебя.
          </p>
        </div>

        {/* Стек ценности: ↓усилия, ↓время, ↑вероятность. */}
        <ul className="mx-auto space-y-1.5 text-left text-xs text-foreground/80">
          <Benefit>Работает 24/7 — бросил задачу, вернулся к&nbsp;готовому</Benefit>
          <Benefit>Топ-модель Claude&nbsp;Opus — как нанять сеньора</Benefit>
          <Benefit>Ты только проверяешь и&nbsp;принимаешь результат</Benefit>
        </ul>

        {/* CTA + снятие риска (пробный час, без карты). */}
        <div className="w-full max-w-[17rem] space-y-1.5 pt-1">
          <Button onClick={onUpgrade} className="w-full gap-1.5">
            <Sparkles className="size-4" />
            Включить воркера
          </Button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Прайм — <span className="font-medium text-foreground/80">1&nbsp;час бесплатно</span>,
            без карты. Отключишь в&nbsp;любой момент.
          </p>
        </div>
      </div>
    </div>
  );
}

function Benefit({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex items-start gap-1.5">
      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="leading-snug">{children}</span>
    </li>
  );
}

import { Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

// I6: оверлей-замок на колонке «Воркер» (status=todo) для бесплатного тарифа. Сама колонка
// под ним приглушается, а поверх — короткий оффер с призывом к апгрейду. Кнопка открывает
// витрину тарифов (useUpgradeDialog().open() прокинут через onUpgrade). Абсолютно позициони-
// руется внутри relative-контейнера тела колонки и перехватывает клики (колонка «заперта»).
export function WorkerLockOffer({ onUpgrade }: { onUpgrade: () => void }): React.ReactElement {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-background/60 via-background/80 to-background/95 p-4 text-center backdrop-blur-[2px]">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        <Lock className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Воркер — на платном тарифе</p>
        <p className="mx-auto max-w-[15rem] text-xs leading-snug text-muted-foreground">
          Автономный AI-воркер сам берёт задачи из этой колонки и доводит их до готового
          результата. На бесплатном тарифе колонка «Воркер» отключена.
        </p>
      </div>
      <Button size="sm" onClick={onUpgrade} className="gap-1.5">
        <Sparkles className="size-4" />
        Подключить воркера
      </Button>
    </div>
  );
}

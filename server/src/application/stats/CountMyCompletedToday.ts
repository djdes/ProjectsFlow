import type { ActivityRepository } from '../activity/ActivityRepository.js';

type Deps = {
  readonly activity: ActivityRepository;
};

// Сколько задач caller закрыл «сегодня» — цифра для мотивационного счётчика в интерфейсе.
//
// Границу суток задаёт КЛИЕНТ (локальная полночь): сервер живёт в UTC и не знает таймзону
// пользователя, а «сегодня» — понятие календарное. Значение зажимаем в разумное окно, чтобы
// подставленный since не превращал «сегодня» в «за всё время».
export const MAX_WINDOW_HOURS = 36;

export class CountMyCompletedToday {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, since: Date, now: Date = new Date()): Promise<number> {
    return this.deps.activity.countTasksCompletedByActorSince(
      userId,
      clampSince(since, now),
    );
  }
}

// Полночь в любой таймзоне отстоит от «сейчас» не больше чем на 24 ч + 14 ч максимального
// смещения, поэтому 36 ч с запасом покрывают легитимные значения. Будущее и мусор → начало
// последних 24 часов: счётчик лучше слегка занизит, чем покажет чужое окно.
function clampSince(since: Date, now: Date): Date {
  const t = since.getTime();
  const earliest = now.getTime() - MAX_WINDOW_HOURS * 3600_000;
  if (!Number.isFinite(t) || t > now.getTime() || t < earliest) {
    return new Date(now.getTime() - 24 * 3600_000);
  }
  return since;
}

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { METER_SEGMENTS, rankFor, traitsFor, MAX_RANK } from './ranks';

// Галочка нарисована вручную, а не взята из lucide: обводку с dasharray можно «прочертить»
// от начала к концу — этот жест и делает момент закрытия задачи заметным.
function DrawnCheck(): React.ReactElement {
  return (
    <svg viewBox="0 0 20 20" className="pf-rb-check" aria-hidden>
      <path d="M4 10.6 L8 14.6 L16 5.4" pathLength={1} style={{ strokeDasharray: 1 }} />
    </svg>
  );
}

// Печатная дорожка: две линии с переходом, контактная площадка и бегущий импульс.
function Trace(): React.ReactElement {
  return (
    <svg viewBox="0 0 23 15" aria-hidden>
      <path d="M23 4H12l-3.5 3.5H2.6" />
      <path d="M23 11H15l-2.6-3.5" />
      <circle cx="2.6" cy="7.5" r="2.5" />
      <rect className="pf-rb-dot" x="7" y="6" width="3.6" height="3" rx="0.7" />
    </svg>
  );
}

// Мотивационный счётчик «выполнено сегодня». Ранг = число закрытых задач: каждая задача
// повышает его и добавляет бейджу новую деталь (см. ranks.ts). Ноль — тёмная плашка
// «сигнала нет», первая задача заливает её цветом.
export function CompletedTodayPill(): React.ReactElement | null {
  const { count, celebrationKey } = useCompletedToday();
  const { animations } = useMotion();
  // Ключ проигрываемой церемонии. 0 — покой; смена ключа перемонтирует слой эффектов, иначе
  // повторное закрытие задачи не проигрывает анимацию заново.
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (celebrationKey === 0 || !animations) return;
    setBurst(celebrationKey);
    const off = window.setTimeout(() => setBurst(0), 2400);
    return () => window.clearTimeout(off);
  }, [celebrationKey, animations]);

  if (count === null) return null;

  const rank = rankFor(count);
  const t = traitsFor(count);
  const playing = burst > 0;
  // Мощность церемонии растёт с рангом: на первом — хлопок, на двенадцатом — полный залп.
  const power = Math.min(count, MAX_RANK) / MAX_RANK;
  const tracers = Math.round(8 + power * 16);
  const rings = count >= 9 ? 3 : count >= 4 ? 2 : 1;
  const digits = count >= 6 ? Math.round(3 + power * 5) : 0;

  return (
    <div
      // Ниже строки верхнего хрома (44px): там у страниц свои кнопки справа — хлебные крошки,
      // «Поделиться», ⋯ — и бейдж лёг бы прямо на них. safe-area: в PWA на iPhone инсеты
      // иначе уводят его под вырез. z-40 — ПОД диалогами (z-50).
      className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] top-[calc(3.25rem+env(safe-area-inset-top))] z-40"
    >
      <div
        className={cn('pf-rb', playing && 'pf-rb-playing')}
        style={
          {
            '--rb-c1': rank.c1,
            '--rb-c2': rank.c2,
            '--rb-c3': rank.c3,
            '--rb-fg': rank.ink,
            '--rb-bloom': t.bloom ? `${7 + Math.min(count, MAX_RANK) * 1.6}px` : '0px',
          } as React.CSSProperties
        }
        data-fill={t.fill ? '1' : undefined}
        data-scan={t.scan && animations ? '1' : undefined}
        data-rgb={t.rgb ? '1' : undefined}
        data-iris={t.iris && animations ? '1' : undefined}
        title={`Сегодня выполнено задач: ${count} · ранг ${rank.name}`}
      >
        <span className="pf-rb-stack">
          {t.reactor && animations && <span aria-hidden className="pf-rb-reactor" />}
          {t.grid && animations && (
            <>
              <span aria-hidden className="pf-rb-grid" />
              <span aria-hidden className="pf-rb-grid pf-rb-grid-b" />
            </>
          )}
          {t.rain && animations && (
            <span aria-hidden className="pf-rb-rain">
              {['1', '0', '1', '0'].map((d, i) => (
                <i key={i} style={{ left: `${10 + i * 26}%`, animationDelay: `${i * 0.6}s` }}>
                  {d}
                </i>
              ))}
            </span>
          )}
          {t.trace && (
            <>
              <span aria-hidden className="pf-rb-trace pf-rb-trace-l">
                <Trace />
              </span>
              <span aria-hidden className="pf-rb-trace pf-rb-trace-r">
                <Trace />
              </span>
            </>
          )}
          {t.hud && (
            <>
              <span aria-hidden className="pf-rb-hud pf-rb-hud-l" />
              <span aria-hidden className="pf-rb-hud pf-rb-hud-r" />
            </>
          )}

          <span className="pf-rb-frame pointer-events-auto">
            <span className="pf-rb-core">
              <DrawnCheck />
              {/* key={count}: React перемонтирует узел на новом значении, и цифра
                  прокручивается снизу вверх без ручного хранения прошлого числа. */}
              <span key={count} className="pf-rb-count">
                {count}
              </span>
              {t.cursor && <span aria-hidden className={cn('pf-rb-cursor', animations && 'pf-rb-blink')} />}
            </span>
          </span>

          {/* Слой церемонии. key=burst перемонтирует его целиком — так CSS-анимации
              стартуют заново на каждой закрытой задаче. */}
          {playing && (
            <span aria-hidden key={burst} className="pf-rb-fx">
              <span className="pf-rb-split pf-rb-split-r" />
              <span className="pf-rb-split pf-rb-split-c" />
              {Array.from({ length: rings }, (_, i) => (
                <span key={i} className={cn('pf-rb-ring', i === 1 && 'pf-rb-ring-b', i === 2 && 'pf-rb-ring-c')} />
              ))}
              <span className="pf-rb-rays" style={{ opacity: 0.5 + power * 0.5 }} />
              {Array.from({ length: tracers }, (_, i) => (
                <span
                  key={`t${i}`}
                  className="pf-rb-tracer"
                  style={
                    {
                      // Разброс детерминирован индексом: одинаков на каждом прогоне, но
                      // выглядит неравномерным. Math.random тут не нужен.
                      '--rot': `${i * (360 / tracers) + (i % 3) * 7}deg`,
                      '--dist': `${(26 + ((i * 11) % 26) + power * 22).toFixed(0)}px`,
                      '--len': `${6 + (i % 4) * 3}px`,
                      '--c': i % 3 === 0 ? rank.c2 : rank.c1,
                      animationDuration: `${600 + (i % 5) * 70}ms`,
                      animationDelay: `${(i % 4) * 18}ms`,
                    } as React.CSSProperties
                  }
                />
              ))}
              {Array.from({ length: digits }, (_, i) => {
                const a = ((i * (360 / Math.max(digits, 1)) + 20) * Math.PI) / 180;
                const dist = 34 + (i % 3) * 10;
                return (
                  <span
                    key={`d${i}`}
                    className="pf-rb-digit"
                    style={
                      {
                        '--dx': `calc(-50% + ${(Math.cos(a) * dist).toFixed(0)}px)`,
                        '--dy': `calc(-50% + ${(Math.sin(a) * dist).toFixed(0)}px)`,
                        '--c': i % 2 ? rank.c2 : rank.c1,
                        animationDelay: `${40 + i * 30}ms`,
                      } as React.CSSProperties
                    }
                  >
                    {i % 2 ? '0' : '1'}
                  </span>
                );
              })}
              <span className="pf-rb-tag">
                {rank.name}
                <small>{rank.grade.toUpperCase()}</small>
              </span>
            </span>
          )}
        </span>

        {t.meter && (
          <span aria-hidden className="pf-rb-meter">
            {Array.from({ length: METER_SEGMENTS }, (_, i) => (
              <i key={i} className={i < t.filledSegments ? 'pf-rb-on' : undefined} />
            ))}
            {t.reactor && <span className="pf-rb-sys">SYS</span>}
          </span>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { motionReduced } from '../../lib/liquid';

// Ползунок с прямым ведением: ручка идёт за пальцем, за краем шкала тянется с нарастающим
// сопротивлением (резинка), а отпущенная — возвращается пружиной оттуда, где её отпустили,
// с той скоростью, с какой её вели. Пружина — замкнутая формула, без CSS-переходов.
// Положение: --ratio (значение, ставит React) + --offset (ручка между делениями под пальцем)
// + --extra (растяжение за краем, со знаком). Под reduced-motion — без резинки и пружин.

type Props = {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
  valueText?: (value: number) => string;
  // Цвет заполненной части и кольца ручки.
  fill: string;
};

// Не дальше ~40 px: ручка остаётся в отступе своей панели.
const rubber = (over: number): number => 40 * (1 - Math.exp(-over / 100));
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

// Смещение и скорость пружины, отпущенной из x0 со скоростью v0 (к нулю), через t секунд.
function spring(x0: number, v0: number, t: number, w: number, z: number): { x: number; v: number } {
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * t);
  const b = (v0 + z * w * x0) / wd;
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  const x = e * (x0 * cos + b * sin);
  const v = e * (-z * w * (x0 * cos + b * sin) + wd * (b * cos - x0 * sin));
  return { x, v };
}

export function RubberSlider({ min, max, step = 1, value, onChange, label, valueText, fill }: Props): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const offsetRef = useRef(0);
  const extraRef = useRef(0);
  const frameRef = useRef(0);
  const dragRef = useRef<{ id: number; lastX: number; lastT: number; vx: number } | null>(null);
  valueRef.current = dragRef.current ? valueRef.current : value;

  const ratioOf = (v: number): number => (v - min) / (max - min);

  const write = (offset: number, extra: number): void => {
    offsetRef.current = offset;
    extraRef.current = extra;
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--offset', offset.toFixed(2));
    root.style.setProperty('--extra', extra.toFixed(2));
    root.style.setProperty('--squash', (1 - 0.25 * Math.min(1, Math.abs(extra) / 40)).toFixed(3));
  };

  const setValue = (v: number): void => {
    if (v === valueRef.current) return;
    valueRef.current = v;
    // The thumb's base moves now, not on React's next commit: no one-frame jump.
    rootRef.current?.style.setProperty('--ratio', String(ratioOf(v)));
    onChange(v);
  };

  // Back to rest: the offset between the thumb and its notch and the stretch past the end.
  const settle = (offset0: number, velocity0: number, extra0: number): void => {
    cancelAnimationFrame(frameRef.current);
    if (motionReduced()) {
      write(0, 0);
      return;
    }
    const t0 = performance.now();
    const sign = Math.sign(extra0);
    const tick = (now: number): void => {
      const t = (now - t0) / 1000;
      const o = spring(offset0, velocity0, t, 20, 0.8).x;
      // The band retracts to its rest length and stops there: it never flips to the other end.
      const e = sign === 0 ? 0 : sign * Math.max(0, sign * spring(extra0, 0, t, 17, 0.72).x);
      write(o, e);
      if (t < 1.5 && (Math.abs(o) > 0.05 || Math.abs(e) > 0.05)) frameRef.current = requestAnimationFrame(tick);
      else {
        write(0, 0);
        frameRef.current = 0;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const follow = (clientX: number): void => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const width = rect.width || 1;
    const x = clientX - rect.left;
    const reduced = motionReduced();
    let pos = clamp(x, 0, width);
    let extra = 0;
    if (!reduced && x > width) extra = rubber(x - width);
    else if (!reduced && x < 0) extra = -rubber(-x);
    pos = clamp(pos, 0, width);
    const raw = min + (pos / width) * (max - min);
    const v = clamp(Math.round((raw - min) / step) * step + min, min, max);
    setValue(v);
    write(reduced ? 0 : pos - ratioOf(v) * width, extra);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    cancelAnimationFrame(frameRef.current);
    const root = rootRef.current;
    root?.setPointerCapture(e.pointerId);
    root?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
    dragRef.current = { id: e.pointerId, lastX: e.clientX, lastT: performance.now(), vx: 0 };
    root?.setAttribute('data-held', '');
    follow(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT) / 1000;
    drag.vx = 0.7 * ((e.clientX - drag.lastX) / dt) + 0.3 * drag.vx;
    drag.lastX = e.clientX;
    drag.lastT = now;
    follow(e.clientX);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    dragRef.current = null;
    rootRef.current?.removeAttribute('data-held');
    // Moving on a notch is not a throw: the release velocity only nudges the settle.
    settle(offsetRef.current, clamp(drag.vx, -1500, 1500) * 0.25, extraRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const big = Math.max(step, Math.round((max - min) / 10 / step) * step);
    const current = valueRef.current;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? current + step
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? current - step
      : e.key === 'PageUp' ? current + big
      : e.key === 'PageDown' ? current - big
      : e.key === 'Home' ? min
      : e.key === 'End' ? max
      : null;
    if (next === null) return;
    e.preventDefault();
    const v = clamp(next, min, max);
    if (v === current) return;
    const width = rootRef.current?.getBoundingClientRect().width ?? 0;
    // Keep the thumb where it is for this frame, then let it spring onto the new notch.
    const offset = offsetRef.current + (ratioOf(current) - ratioOf(v)) * width;
    setValue(v);
    write(offset, extraRef.current);
    settle(offset, 0, extraRef.current);
  };

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const ratio = ratioOf(value);
  return (
    <div
      ref={rootRef}
      className="group/slider relative h-7 cursor-pointer select-none"
      style={{ '--ratio': ratio, touchAction: 'pan-y' } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        aria-hidden="true"
        className="absolute top-1/2 h-2 rounded-full bg-white/15"
        style={{
          left: 'calc(min(var(--extra, 0), 0) * 1px)',
          right: 'calc(min(var(--extra, 0) * -1, 0) * 1px)',
          transform: 'translateY(-50%) scaleY(var(--squash, 1))',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute left-0 top-1/2 h-2 rounded-full"
        style={{
          background: fill,
          width: 'max(0px, calc(var(--ratio) * 100% + (var(--offset, 0) + max(var(--extra, 0), 0)) * 1px))',
          transform: 'translateY(-50%) scaleY(var(--squash, 1))',
        }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText?.(value)}
        onKeyDown={onKeyDown}
        className="absolute top-1/2 size-5 rounded-full bg-white outline-none transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-4 focus-visible:ring-white/40 group-data-[held]/slider:[--knob:1.25] motion-reduce:transition-none"
        style={{
          left: 'calc(var(--ratio) * 100% + (var(--offset, 0) + var(--extra, 0)) * 1px)',
          transform: 'translate(-50%, -50%) scale(var(--knob, 1))',
          boxShadow: `0 0 0 3px ${fill}, 0 4px 12px rgba(0, 0, 0, 0.45)`,
        }}
      />
    </div>
  );
}

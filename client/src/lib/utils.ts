import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const anyValue = (): boolean => true;

// tailwind-merge не знает утилит блочной оси из плагина logicalBlock (tailwind.config.ts):
// mbs/mbe, pbs/pbe, inset-bs/be, border-bs/be, rounded-bs/be, scroll-mbs/… Без этих групп
// cn('mbs-2', className) не убирал бы перекрытый класс, и победителя решал бы порядок CSS,
// а не порядок в cn. Конфликты — как у физических собратьев (mt ↔ my ↔ m и т.д.), плюс
// inline-ось Tailwind 3.4 (ms/me/ps/pe/start/end) против mx/px/inset-x.
type LogicalBlockGroups =
  | 'mbs'
  | 'mbe'
  | 'pbs'
  | 'pbe'
  | 'inset-bs'
  | 'inset-be'
  | 'border-w-bs'
  | 'border-w-be'
  | 'rounded-bs'
  | 'rounded-be'
  | 'scroll-mbs'
  | 'scroll-mbe'
  | 'scroll-pbs'
  | 'scroll-pbe';

const twMerge = extendTailwindMerge<LogicalBlockGroups>({
  extend: {
    classGroups: {
      mbs: [{ mbs: [anyValue] }],
      mbe: [{ mbe: [anyValue] }],
      pbs: [{ pbs: [anyValue] }],
      pbe: [{ pbe: [anyValue] }],
      'inset-bs': [{ 'inset-bs': [anyValue] }],
      'inset-be': [{ 'inset-be': [anyValue] }],
      'border-w-bs': [{ 'border-bs': ['', anyValue] }],
      'border-w-be': [{ 'border-be': ['', anyValue] }],
      'rounded-bs': [{ 'rounded-bs': ['', anyValue] }],
      'rounded-be': [{ 'rounded-be': ['', anyValue] }],
      'scroll-mbs': [{ 'scroll-mbs': [anyValue] }],
      'scroll-mbe': [{ 'scroll-mbe': [anyValue] }],
      'scroll-pbs': [{ 'scroll-pbs': [anyValue] }],
      'scroll-pbe': [{ 'scroll-pbe': [anyValue] }],
    },
    conflictingClassGroups: {
      m: ['mbs', 'mbe'],
      my: ['mbs', 'mbe'],
      mx: ['ms', 'me'],
      p: ['pbs', 'pbe'],
      py: ['pbs', 'pbe'],
      px: ['ps', 'pe'],
      inset: ['inset-bs', 'inset-be'],
      'inset-y': ['inset-bs', 'inset-be'],
      'inset-x': ['start', 'end'],
      'border-w': ['border-w-bs', 'border-w-be'],
      'border-w-y': ['border-w-bs', 'border-w-be'],
      'border-w-x': ['border-w-s', 'border-w-e'],
      rounded: ['rounded-bs', 'rounded-be'],
      'rounded-bs': ['rounded-ss', 'rounded-se'],
      'rounded-be': ['rounded-es', 'rounded-ee'],
      'scroll-m': ['scroll-mbs', 'scroll-mbe'],
      'scroll-my': ['scroll-mbs', 'scroll-mbe'],
      'scroll-p': ['scroll-pbs', 'scroll-pbe'],
      'scroll-py': ['scroll-pbs', 'scroll-pbe'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

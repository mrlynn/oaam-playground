import clsx from 'clsx';
import type {ReactNode} from 'react';

import s from './styles.module.css';

export type Tone = 'good' | 'warn' | 'bad' | 'badFilled' | 'on' | undefined;

const TONE: Record<Exclude<Tone, undefined>, string> = {
  good: s.good,
  warn: s.warn,
  bad: s.bad,
  badFilled: s.badFilled,
  on: s.chipOn,
};

export function Chip({children, tone, title, color}: {children: ReactNode; tone?: Tone; title?: string; color?: string}) {
  return (
    <span className={clsx(s.chip, tone && TONE[tone], color && s.typeChip)} title={title} style={color ? {background: color} : undefined}>
      {children}
    </span>
  );
}

export function ChipButton({children, tone, title, onClick, pressed}: {children: ReactNode; tone?: Tone; title?: string; onClick: () => void; pressed?: boolean}) {
  return (
    <button type="button" className={clsx(s.chip, tone && TONE[tone])} title={title} onClick={onClick} aria-pressed={pressed}>
      {children}
    </button>
  );
}

export function ChipLink({children, tone, title, href}: {children: ReactNode; tone?: Tone; title?: string; href: string}) {
  return (
    <a className={clsx(s.chip, tone && TONE[tone])} title={title} href={href}>
      {children}
    </a>
  );
}

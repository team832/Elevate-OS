/**
 * The Elevate OS line icon set: 24-unit grid, 1.5px stroke, round joins, no fills,
 * drawn in `currentColor`. Use icons only where they help recognition (navigation,
 * search, notifications, menu) — not as decoration on every card.
 */
import type { SVGProps } from 'react';

const PATHS = {
  overview: 'M4 5.5h6.5V11H4zM13.5 5.5H20V9h-6.5zM13.5 12H20v6.5h-6.5zM4 14h6.5v4.5H4z',
  'my-work': 'M9 6h11M9 12h11M9 18h11M4 5.5l1 1 1.75-2M4 11.5l1 1 1.75-2M4 17.5l1 1 1.75-2',
  ops: 'M4 8.5h16v10.5H4zM9 8.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M4 13h16',
  academic: 'M3 9l9-4 9 4-9 4zM7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11M21 9v5',
  marketing: 'M4 10v4h3l6 4V6l-6 4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10',
  settings:
    'M12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5zM12 3.5l1.6 2.2 2.7-.5.6 2.7 2.4 1.3-1.1 2.5 1.1 2.5-2.4 1.3-.6 2.7-2.7-.5L12 20.5l-1.6-2.2-2.7.5-.6-2.7-2.4-1.3L5.8 12l-1.1-2.5 2.4-1.3.6-2.7 2.7.5z',
  search: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l4.5 4.5',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5zM10 20h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M7 10l5 5 5-5',
  'chevron-right': 'M10 7l5 5-5 5',
  'sign-out': 'M14 5H6v14h8M10.5 12H20M17 9l3 3-3 3',
  plus: 'M12 5v14M5 12h14',
  dashboard: 'M4 19.5h16M6.5 16V11M11 16V7M15.5 16v-6M20 16V4.5',
  alert: 'M12 4l9 15.5H3zM12 10v4.5M12 17v.5',
  calendar: 'M4.5 6.5h15V19.5h-15zM4.5 10.5h15M8.5 4.5v4M15.5 4.5v4',
  external: 'M13.5 5H19v5.5M19 5l-8 8M17 14v5H5V7h5',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px (16–20 in the UI). */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 18, label, className, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['el-icon', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

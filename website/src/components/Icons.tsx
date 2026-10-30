import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}>
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);

export const Copy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const Sun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
);

export const Moon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Icon>
);

export const Camera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-1.8A1.5 1.5 0 0 1 10.6 3.5h2.8a1.5 1.5 0 0 1 1.2.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </Icon>
);

export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c.5 4.2 2.3 6 6.5 6.5-4.2.5-6 2.3-6.5 6.5-.5-4.2-2.3-6-6.5-6.5 4.2-.5 6-2.3 6.5-6.5Z" />
    <path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" />
  </Icon>
);

export const TextLines = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6.5h14M5 11.5h14M5 16.5h8.5" />
  </Icon>
);

export const Steps = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.5c1.7 0 2.7 1.8 2.7 4.3S9.6 12 8 12 5.3 10.4 5.3 7.8 6.3 3.5 8 3.5Z" />
    <path d="M5.8 14.5h4.4v1.7a2.2 2.2 0 0 1-4.4 0v-1.7Z" />
    <path d="M16 7.5c1.7 0 2.7 1.8 2.7 4.3S17.6 16 16 16s-2.7-1.6-2.7-4.2 1-4.3 2.7-4.3Z" />
    <path d="M13.8 18.5h4.4v.3a2.2 2.2 0 0 1-4.4 0v-.3Z" />
  </Icon>
);

export const Scale = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <path d="M8.5 10a5 5 0 0 1 7 0M12 10.5l1.3-2" />
  </Icon>
);

export const Heart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10Z" />
  </Icon>
);

export const Watch = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="3.5" />
    <path d="M9 6l.6-2.5h4.8L15 6M9 18l.6 2.5h4.8L15 18M12 9.5V12l1.5 1" />
  </Icon>
);

export const Barcode = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17M8 8v8M11 8v8M14 8v8M16.5 8v8" />
  </Icon>
);

export const Wand = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 19.5 10-10M13 6l1-2.5L15 6l2.5 1-2.5 1-1 2.5L13 8l-2.5-1L13 6ZM18.5 13l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" />
  </Icon>
);

export const EyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5c5 0 8.5 4.5 9 6.5-.2.9-1 2.4-2.4 3.8M6.4 7C4.6 8.3 3.4 10.2 3 12c.5 2 4 6.5 9 6.5a9.6 9.6 0 0 0 4.4-1M4 4l16 16M9.9 10a3 3 0 0 0 4.1 4.1" />
  </Icon>
);

export const Chevron = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </Icon>
);

export const Server = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="16" height="7" rx="2.5" />
    <rect x="4" y="13" width="16" height="7" rx="2.5" />
    <path d="M8 7.5h.01M8 16.5h.01" strokeWidth={2.6} />
  </Icon>
);

export const Qr = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5V20M20 14v.5" />
  </Icon>
);

export const Terminal = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 7 4.5 5L5 17M12 17h7" />
  </Icon>
);

export const GitHub = ({ size = 20, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
    <path d="M12 2.25a9.75 9.75 0 0 0-3.08 19c.49.09.67-.21.67-.47v-1.65c-2.71.59-3.28-1.31-3.28-1.31-.45-1.13-1.09-1.43-1.09-1.43-.89-.61.07-.6.07-.6.98.07 1.5 1.01 1.5 1.01.87 1.5 2.29 1.06 2.85.81.09-.63.34-1.06.62-1.31-2.16-.25-4.44-1.08-4.44-4.81 0-1.06.38-1.93 1-2.61-.1-.25-.43-1.24.1-2.58 0 0 .82-.26 2.68 1a9.3 9.3 0 0 1 4.88 0c1.86-1.26 2.68-1 2.68-1 .53 1.34.2 2.33.1 2.58.62.68 1 1.55 1 2.61 0 3.74-2.28 4.56-4.45 4.8.35.3.66.9.66 1.81v2.68c0 .26.18.57.67.47A9.75 9.75 0 0 0 12 2.25Z" />
  </svg>
);

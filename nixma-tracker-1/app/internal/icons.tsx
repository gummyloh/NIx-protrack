/**
 * Minimal line-icon set for the internal nav. Hand-rolled rather than
 * pulling in an icon package -- keeps the dependency list unchanged and
 * these are the only ~12 glyphs the app needs.
 */
import { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2H16a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-9.5Z" />
  </Icon>
);

export const IconGauge = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 13a7 7 0 1 1 14 0" />
    <path d="M10 13 13 8" />
    <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.75" y="2.75" width="6" height="6" rx="1" />
    <rect x="11.25" y="2.75" width="6" height="6" rx="1" />
    <rect x="2.75" y="11.25" width="6" height="6" rx="1" />
    <rect x="11.25" y="11.25" width="6" height="6" rx="1" />
  </Icon>
);

export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
    <circle cx="7" cy="8" r="1.4" />
    <path d="m4 15 4.2-4.2a1.3 1.3 0 0 1 1.8 0L13 13.8" />
    <path d="m11.5 12 1.7-1.7a1.3 1.3 0 0 1 1.8 0L17.5 13" />
  </Icon>
);

export const IconNotes = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 3.5h12v10L12.5 17H4Z" />
    <path d="M12.5 17v-3.5H16" />
    <path d="M6.75 7h6.5M6.75 10h6.5" />
  </Icon>
);

export const IconColumns = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.75" y="3" width="14.5" height="14" rx="1.5" />
    <path d="M7.5 3v14M12.5 3v14" />
  </Icon>
);

export const IconTable = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
    <path d="M2.5 8h15M8 3.5v13" />
  </Icon>
);

export const IconBarChart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 16.5V9M10 16.5V3.5M16 16.5V11.5" />
    <path d="M2.5 16.5h15" />
  </Icon>
);

export const IconLayers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m10 3 7 4-7 4-7-4Z" />
    <path d="m3 11 7 4 7-4" />
  </Icon>
);

export const IconTrendUp = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m3 14 5-5 3 3 6-6.5" />
    <path d="M13 5.5h4V9.5" />
  </Icon>
);

export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="7.25" cy="7" r="2.5" />
    <path d="M2.5 16c0-2.5 2.1-4.25 4.75-4.25S12 13.5 12 16" />
    <path d="M13 7.25a2.25 2.25 0 1 0 0-4.5" />
    <path d="M13.75 11.9c2.1.4 3.75 2 3.75 4.1" />
  </Icon>
);

export const IconLogOut = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" />
    <path d="M13 13.5 17 10l-4-3.5" />
    <path d="M17 10H7.5" />
  </Icon>
);

export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
);

/* Inline stroke icons — one consistent 24/1.6 set.
 *
 * Inline rather than an icon package because this app ships as a local desktop
 * bundle: a webfont or an icon CDN is one more thing that can fail with no
 * network, and the whole product promise is that it works offline.
 */

import type { CSSProperties } from 'react';

type P = { size?: number; className?: string; style?: CSSProperties };

const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IcHome = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
);

export const IcFolder = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const IcGallery = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 4.5-4.5 3.5 3.5 3-2.5L20 18" />
  </svg>
);

export const IcFilter = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 5h18l-7 8v5.5l-4 2V13Z" />
  </svg>
);

export const IcSliders = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3" />
    <circle cx="16" cy="7" r="1.8" />
    <circle cx="10" cy="12" r="1.8" />
    <circle cx="15" cy="17" r="1.8" />
  </svg>
);

export const IcBook = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5V18c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2V4.5c-4.5 0-6.5.5-8 2Z" />
    <path d="M12 6.5V20" />
  </svg>
);

export const IcUsers = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.2c2 .7 3.2 2.4 3.2 4.8" />
  </svg>
);

export const IcBag = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4.5 8h15l-1 11.5a1.6 1.6 0 0 1-1.6 1.5H7.1a1.6 1.6 0 0 1-1.6-1.5Z" />
    <path d="M9 8V6.2a3 3 0 0 1 6 0V8" />
  </svg>
);

export const IcChart = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </svg>
);

export const IcGear = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
  </svg>
);

export const IcUpload = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M6.5 17.5A4 4 0 0 1 7 9.6a5.2 5.2 0 0 1 10-1.1 3.7 3.7 0 0 1 .6 7.3" />
    <path d="M12 12v8M9 15l3-3 3 3" />
  </svg>
);

export const IcHeart = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 19.5S4.5 15 4.5 9.8A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7.5 1.8c0 5.2-7.5 9.7-7.5 9.7Z" />
  </svg>
);

export const IcCheck = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IcCheckCircle = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.3 2.6 2.6L16 9.5" />
  </svg>
);

export const IcBell = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" />
    <path d="M10 19a2.2 2.2 0 0 0 4 0" />
  </svg>
);

export const IcHelp = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.4" />
    <path d="M12 17.2h.01" />
  </svg>
);

export const IcChevron = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IcCloud = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M6.8 18.5A3.8 3.8 0 0 1 7.3 11a5 5 0 0 1 9.6-1 3.6 3.6 0 0 1 .6 7.1Z" />
  </svg>
);

export const IcSend = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M20.5 3.5 3.8 10.2l6.6 2.6 2.6 6.6Z" />
    <path d="m10.4 12.8 4.6-4.6" />
  </svg>
);

export const IcMail = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="m4 8 8 5 8-5" />
  </svg>
);

export const IcLink = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M14 7h3a5 5 0 0 1 0 10h-3M10 17H7A5 5 0 0 1 7 7h3" />
    <path d="M8.5 12h7" />
  </svg>
);

export const IcCamera = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 8.5A2 2 0 0 1 5 6.5h2.2L8.6 4.5h6.8l1.4 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
);

export const IcCalendar = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
  </svg>
);

export const IcSparkle = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9Z" />
    <path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8Z" />
  </svg>
);

export const IcCopy = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="9" y="9" width="11" height="11" rx="2.2" />
    <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
  </svg>
);

export const IcFolderOpen = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 7a2 2 0 0 1 2-2h3.8l2 2.4H18a2 2 0 0 1 2 2V11" />
    <path d="M3 11h18l-2 7.4a2 2 0 0 1-2 1.6H6a2 2 0 0 1-2-1.6Z" />
  </svg>
);

export const IcUndo = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 9h9.5a5.5 5.5 0 1 1 0 11H8" />
    <path d="m7.5 5.5-3.5 3.5 3.5 3.5" />
  </svg>
);

export const IcEye = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IcDownload = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 3.5v11M8 11l4 4 4-4" />
    <path d="M4.5 19.5h15" />
  </svg>
);

/** Corners pushing outward — "give this the whole window". */
export const IcExpand = ({ size, className, style }: P) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
  </svg>
);

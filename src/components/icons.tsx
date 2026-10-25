import type { SVGProps } from 'react'

/** 全部界面图标均为内联 SVG（stroke currentColor），不使用 emoji 或远程图片字体。 */

type P = SVGProps<SVGSVGElement>

function Svg({ children, ...p }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const IconCheckCircle = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5.2" />
  </Svg>
)

export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M5 20v-7M12 20V5M19 20v-9" />
  </Svg>
)

export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M8 3v4M16 3v4M3.5 11h17" />
  </Svg>
)

export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21c1.4-3.8 4.2-5.7 7.5-5.7s6.1 1.9 7.5 5.7" />
  </Svg>
)

export const IconEdit = (p: P) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.7 3.8a2.2 2.2 0 0 1 3.1 3.1L7.5 19.2 3 20.5l1.3-4.5Z" />
  </Svg>
)

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 6.5h17M8.5 6.5v-2h7v2M6 6.5 7 21h10l1-14.5M10 11v6M14 11v6" />
  </Svg>
)

export const IconChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m14.5 18-6-6 6-6" />
  </Svg>
)

export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9.5 18 6-6-6-6" />
  </Svg>
)

export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
)

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </Svg>
)

export const IconFlame = (p: P) => (
  <Svg {...p}>
    <path d="M12 3c1.8 3.2-4.5 4.8-4.5 9.5a4.5 4.5 0 0 0 9 0C16.5 7.8 10.2 6.2 12 3Z" />
    <path d="M12 17.5a2.3 2.3 0 0 1-2.3-2.3c0-1.4 2.3-3.2 2.3-3.2s2.3 1.8 2.3 3.2A2.3 2.3 0 0 1 12 17.5Z" />
  </Svg>
)

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.8 20h18.4L12 4Z" />
    <path d="M12 10.5v3.5M12 17.3h.01" />
  </Svg>
)

export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M20 13.6A8.2 8.2 0 0 1 10.4 4 8.2 8.2 0 1 0 20 13.6Z" />
  </Svg>
)

export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
    <path d="M5.5 15V5.5a2 2 0 0 1 2-2H15" />
  </Svg>
)

export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11m-5-4.5 5 5 5-5M5 20h14" />
  </Svg>
)

export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 15.5V4.5m-5 5 5-5 5 5M5 20h14" />
  </Svg>
)

export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 9A8.6 8.6 0 1 0 21 13" />
    <path d="M21 4v5h-5" />
  </Svg>
)

export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.7h.01" />
  </Svg>
)

export const IconSparkles = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 1.7 4.6L18.3 9.3l-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3Z" />
    <path d="m18.5 14.5.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" />
  </Svg>
)

export const IconDots = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconTrendUp = (p: P) => (
  <Svg {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M14.5 7H21v6.5" />
  </Svg>
)

export const IconTrendDown = (p: P) => (
  <Svg {...p}>
    <path d="m3 7 6 6 4-4 8 8" />
    <path d="M21 10.5V17h-6.5" />
  </Svg>
)

export const IconMinusTrend = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const IconFlag = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 21V4" />
    <path d="M5.5 4.5c4-2 6.5 2 10.5 0V12c-4 2-6.5-2-10.5 0" />
  </Svg>
)

export const IconInbox = (p: P) => (
  <Svg {...p}>
    <path d="M4 13.5 6.6 5.5h10.8L20 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-5.5Z" />
    <path d="M4 13.5h4l1.5 2.5h5L16 13.5h4" />
  </Svg>
)

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </Svg>
)

export const IconMonitor = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
    <path d="M9 21h6M12 17v4" />
  </Svg>
)

export const IconSpinner = (p: P) => (
  <Svg {...p} className={`animate-spin ${p.className ?? ''}`} style={{ animation: 'spin 0.8s linear infinite', ...(p.style ?? {}) }}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
)

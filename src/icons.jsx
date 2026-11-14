import React from 'react'

const paths = {
  brand: <><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  home: <><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" className="icon-cutout"/><circle cx="16" cy="12" r="2" className="icon-cutout"/><circle cx="10" cy="18" r="2" className="icon-cutout"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  minimize: <path d="M5 12h14"/>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1"/>,
  restore: <><rect x="4" y="8" width="12" height="12" rx="1"/><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  reset: <><path d="M3 12a9 9 0 1 1 2.4 6.1M3 7v5h5"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  pulse: <path d="M2 12h5l3-7 4 14 3-7h5"/>,
  shield: <><path d="M12 22s7-3.5 7-9V6l-7-3-7 3v7c0 5.5 7 9 7 9Z"/><path d="m9 12 2 2 4-4"/></>,
  compare: <><path d="M4 4v16h16M8 16v-3m4 3V8m4 8v-5m4 5V5"/></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6.5 11h2l1.5-2.5 2.5 4.5 1.5-2h3.5"/></>,
  gpu: <><path d="M3 5v14m0-2h17a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H3m4 10v2m6-2v2"/><circle cx="10" cy="12" r="2.5"/><path d="M16 10h2m-2 4h2"/></>,
  chip: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/></>,
  memory: <><rect x="3" y="6" width="18" height="11" rx="2"/><path d="M7 9v4m5-4v4m5-4v4M7 17v3m5-3v3m5-3v3"/></>,
  disk: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 14h18m-14 2.5h.01m3 0h.01"/></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>,
  battery: <><rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4M6 9v6m4-6v6m4-6v6"/></>,
  flag: <><path d="M5 22V3m0 2c7-5 7 5 14 0v11c-7 5-7-5-14 0"/></>,
  play: <path d="M7 4v16l13-8L7 4Z"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  down: <path d="m6 9 6 6 6-6"/>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
  browser: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 9h8.5m-10.8 5-4.5-8m9 7.5-4.5 7.4"/></>,
  chat: <path d="M20 11a7.5 7.5 0 0 1-8 7H9l-5 3 1.5-5A6.6 6.6 0 0 1 4 11a8 8 0 0 1 16 0Z"/>,
  cloud: <path d="M7 18a4 4 0 1 1 1-8 5 5 0 0 1 9.8 1 3.5 3.5 0 1 1 .7 7H7Z"/>,
  terminal: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 2 2-2 2m5 0h5"/></>,
  app: <><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9h16m-13-2h.01m2.5 0h.01"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
}

export function Icon({ name, size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}


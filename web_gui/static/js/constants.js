/* ── Design Tokens & Navigation Mapping ── */

export const COLOURS = [
  '#ffffff', // Pure White
  '#e4e4e7', // Zinc 200 (Light grey)
  '#a1a1aa', // Zinc 400 (Medium grey)
  '#71717a', // Zinc 500 (Charcoal)
  '#d4d4d8', // Zinc 300 (Silver)
  '#f4f4f5', // Zinc 100 (Off white)
  '#e5e5e5', // Cool silver
  '#cccccc', // Light grey
];

export const COLOUR_DIMS = [
  'rgba(255,255,255,0.08)',
  'rgba(228,228,231,0.08)',
  'rgba(161,161,170,0.08)',
  'rgba(113,113,122,0.08)',
  'rgba(212,212,216,0.08)',
  'rgba(244,244,245,0.08)',
  'rgba(229,229,229,0.08)',
  'rgba(204,204,204,0.08)',
];

export const NAV_MAP = {
  'tab-dashboard': { title: 'DASHBOARD',   sub: 'Overview',       nav: 'nav-dashboard' },
  'tab-plotter':   { title: 'PLOTTER',     sub: 'Data Plotter',   nav: 'nav-plotter'   },
  'tab-daq':       { title: 'DAQ CONFIG',  sub: 'Hardware Setup', nav: 'nav-daq'       },
  'tab-db':        { title: 'DATABASE',    sub: 'Connection',     nav: 'nav-db'        },
  'tab-mockup':    { title: 'WAVEFORMS',   sub: 'Mock Generator', nav: 'nav-mockup'    },
  'tab-log':       { title: 'LOG CONSOLE', sub: 'Pipeline Output',nav: 'nav-log'       },
};

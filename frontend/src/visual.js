// visual.js — design tokens for the Rabbit Flow Designer canvas.
// All colors, fonts, node kinds, and dimensions live here so the rest of the
// modules can import a single ground truth rather than repeat magic strings.

export const KINDS = {
  trigger:  { color: '#f472b6', icon: '▶', label: 'Trigger' },
  knob:     { color: '#38bdf8', icon: '⚙', label: 'Knob' },
  agent:    { color: '#5b9dff', icon: '◇', label: 'Agent' },
  gate:     { color: '#f5a524', icon: '◈', label: 'Gate' },
  parallel: { color: '#a855f7', icon: '⋔', label: 'Parallel' },
  loop:     { color: '#2dd4bf', icon: '↻', label: 'Loop' },
  phase:    { color: '#94a3b8', icon: '▭', label: 'Phase' },
  skill:    { color: '#34d399', icon: '◆', label: 'Skill' },
  lossy:    { color: '#f5a524', icon: '⚠', label: 'Unparsed' },
};

export const MODELS = { opus: '#c084fc', sonnet: '#5b9dff', haiku: '#5eead4' };

// EC — edge colors keyed by edge type
export const EC = { flow: '#5b6675', loop: '#2dd4bf', skill: '#34d399', data: '#38bdf8' };

export const MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const SANS = "'IBM Plex Sans', system-ui, sans-serif";

// Default [width, height] per node kind
export const DIMS = {
  trigger: [196, 48],
  knob:    [200, 96],
  agent:   [234, 84],
  gate:    [234, 84],
  skill:   [184, 60],
  phase:   [240, 44],
  parallel:[300, 180],
  loop:    [320, 226],
  lossy:   [280, 60],
};

// Shared button base style — callers merge overrides with Object.assign
export const btn = (extra) => Object.assign(
  { height: 30, padding: '0 12px', background: '#0c1016', border: '1px solid #1d2530',
    color: '#aeb9c8', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: SANS },
  extra || {}
);

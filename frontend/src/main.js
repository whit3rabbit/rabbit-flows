// main.js — entry point for the Rabbit Flow Designer SPA.
// Loads vendored React + ReactFlow UMDs, initialises all modules with the
// runtime bindings, registers the <flow-canvas> custom element, and mounts
// the React app. No CDN — all deps come from frontend/vendor/.
//
// Vendored locally (frontend/vendor/) and served by server.js — no CDN.
// This removes the supply-chain / MITM surface a CDN <script> without SRI
// carries. To upgrade, re-pin and re-download:
//   react@18.3.1, react-dom@18.3.1, reactflow@11.11.4

const CSS  = '/vendor/reactflow.style.css';
const LIBS = [
  '/vendor/react.production.min.js',
  '/vendor/react-dom.production.min.js',
  '/vendor/reactflow.umd.min.js',
];

const loadCss = (href) => {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
};

// async=false makes a dynamically-inserted script download in parallel with its siblings
// but still EXECUTE in DOM-insertion order — so ReactDOM/ReactFlow see window.React set.
// (Without it, dynamic scripts default to async=true and could execute out of order.)
const loadScript = (src) => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.async = false; s.crossOrigin = 'anonymous';
  s.onload = res;
  s.onerror = () => rej(new Error('failed ' + src));
  document.head.appendChild(s);
});

async function boot() {
  loadCss(CSS);
  // Fetch all three vendor bundles in parallel; ordered execution is guaranteed by async=false.
  await Promise.all(LIBS.map(loadScript));

  const React    = window.React;
  const ReactDOM = window.ReactDOM;
  const RF       = window.ReactFlow;

  // Import all modules and wire up React/RF bindings.
  // The init functions exist because all modules are lazy with respect to React/RF
  // (the UMD bundles load after the ES modules are parsed).
  const [
    { initNodes, makeNodeTypes },
    { initGraph },
    { initInspector },
    { initManager },
    { initCodePanel },
    { initPalette },
    { initToolbar },
    { initFlowPane },
    { initCanvas, setNodeTypes, App },
  ] = await Promise.all([
    import('./nodes.js'),
    import('./graph.js'),
    import('./inspector.js'),
    import('./manager.js'),
    import('./codepanel.js'),
    import('./palette.js'),
    import('./toolbar.js'),
    import('./flowpane.js'),
    import('./canvas.js'),
  ]);

  initNodes(React, RF);
  initGraph(RF);
  initInspector(React);
  initManager(React);
  initCodePanel(React);
  initPalette(React);
  initToolbar(React);
  initFlowPane(React, RF);
  initCanvas(React, RF);
  setNodeTypes(makeNodeTypes());

  // parser.js is served as a plain ES module at /parser.js by server.js.
  // canvas.js dynamic-imports it on demand (loadRepoWorkflow); no eager import needed here.

  class FlowCanvas extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      this.style.display = 'block';
      this.style.width   = '100%';
      this.style.height  = '100%';
      const inner = document.createElement('div');
      inner.style.width = '100%'; inner.style.height = '100%';
      this.appendChild(inner); this._inner = inner;
      const h = React.createElement;
      if (ReactDOM.createRoot) { this._root = ReactDOM.createRoot(inner); this._root.render(h(App)); }
      else ReactDOM.render(h(App), inner);
    }
    disconnectedCallback() {
      if (this._root) { this._root.unmount(); this._root = null; }
      else if (this._inner) ReactDOM.unmountComponentAtNode(this._inner);
      this._mounted = false;
    }
  }

  if (!customElements.get('flow-canvas')) customElements.define('flow-canvas', FlowCanvas);
}

boot().catch((e) => console.error('[flow-canvas] boot error', e));

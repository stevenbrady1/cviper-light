import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { configurePdfJsAssets } from './parsing/pdfjs-assets';
import { refuseForeignDrops } from './platform/foreignDrops';
// Tailwind + design tokens. Imported first so utility layers precede component CSS.
import './styles/theme.css';

// Before anything can parse a CV. pdf.js resolves its worker and data files at
// runtime, and left unconfigured it silently looks in the wrong place once the
// app is packaged — see src/parsing/pdfjs-assets.ts.
configurePdfJsAssets();

// Before anything can be dragged. With Tauri's native drag-and-drop handler off
// (so tracker cards can move on Windows, L-186), a file or link dropped on the
// window would otherwise navigate the web view away from the app — see
// src/platform/foreignDrops.ts.
refuseForeignDrops(window);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

// Outermost, so a render error anywhere shows a way back instead of a blank
// window (L-226).
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

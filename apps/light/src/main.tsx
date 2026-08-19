import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { configurePdfJsAssets } from './parsing/pdfjs-assets';
// Tailwind + design tokens. Imported first so utility layers precede component CSS.
import './styles/theme.css';

// Before anything can parse a CV. pdf.js resolves its worker and data files at
// runtime, and left unconfigured it silently looks in the wrong place once the
// app is packaged — see src/parsing/pdfjs-assets.ts.
configurePdfJsAssets();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

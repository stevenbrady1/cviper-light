import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Tailwind + design tokens. Imported first so utility layers precede component CSS.
import './styles/theme.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

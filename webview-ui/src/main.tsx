import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { isBrowserRuntime } from './runtime';
import { initStandaloneClient, isStandaloneMode } from './standaloneClient';

async function main() {
  if (isBrowserRuntime) {
    if (isStandaloneMode()) {
      // Running in standalone mode - connect via WebSocket
      initStandaloneClient({
        onStateChange: (state) => {
          console.log('[StandaloneClient] State:', state);
        },
      });
    } else {
      // Running in browser dev mode - use mock data
      const { initBrowserMock } = await import('./browserMock.js');
      await initBrowserMock();
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);

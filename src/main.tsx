import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress known react-native-web error & capture global errors
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Cannot find single active touch')) {
    return;
  }

  // Dispatch custom event to be picked up by App.tsx
  try {
    const errorDetails = args.map(arg => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
      return String(arg);
    }).join(' ');

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-console-error', {
        detail: { message: errorDetails }
      }));
    }
  } catch (e) {
    // Ignore circular JSON errors etc
  }

  originalConsoleError(...args);
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  console.error("Root element not found");
}

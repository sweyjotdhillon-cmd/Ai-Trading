import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['react-native-web'],
    esbuildOptions: { mainFields: ['module', 'main'] },
  },
  worker: {
    rollupOptions: {
      external: ['candlestick'],
    }
  },
  build: {
    rollupOptions: {
      external: ['candlestick'],
    },
    commonjsOptions: {
      include: [/candlestick/, /node_modules/],
      transformMixedEsModules: true,
    }
  },
  resolve: {
    alias: {
      'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(__dirname, 'src/shims/codegenNativeComponent.ts'),
      'react-native-web/Libraries/Utilities/codegenNativeComponent': path.resolve(__dirname, 'src/shims/codegenNativeComponent.ts'),
      'react-native': 'react-native-web',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }
});

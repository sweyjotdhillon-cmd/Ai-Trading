import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
    proxy: {
      '/api/stock': {
        target: 'https://military-jobye-haiqstudios-14f59639.koyeb.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/stock/, '/stock'),
      },
      '/api/search': {
        target: 'https://military-jobye-haiqstudios-14f59639.koyeb.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search/, '/search'),
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  preview: {
    host: true,
    allowedHosts: true,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4173,
  }
});

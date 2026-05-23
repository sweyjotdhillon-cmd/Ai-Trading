import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { cloudflare } from '@cloudflare/vite-plugin';

const useCloudflarePlugin =
  process.env.CF_PAGES === '1' ||
  process.env.WORKERS_CI === '1' ||
  process.env.USE_CLOUDFLARE_VITE_PLUGIN === '1';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: useCloudflarePlugin ? [react(), cloudflare()] : [react()],
  optimizeDeps: {
    include: ['react-native-web'],
    esbuildOptions: { mainFields: ['module', 'main'] },
  },
  worker: {
    rollupOptions: {
      external: ['candlestick'],
    },
  },
  build: {
    rollupOptions: {
      external: ['candlestick'],
    },
    commonjsOptions: {
      include: [/candlestick/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  resolve: {
    alias: {
      'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(
        __dirname,
        'src/shims/codegenNativeComponent.ts'
      ),
      'react-native-web/Libraries/Utilities/codegenNativeComponent': path.resolve(
        __dirname,
        'src/shims/codegenNativeComponent.ts'
      ),
      'react-native': 'react-native-web',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});

import path from 'path';
import { defineConfig, loadEnv } from 'vite';


export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3101,
        host: 'localhost',
        strictPort: true,
        proxy: {
          '/api': {
            target: 'http://localhost:3000',
            changeOrigin: true,
            secure: false,
          }
        }
      },
      plugins: [],
      build: {
        rollupOptions: {
          output: {
            // Vendor libs change far less often than app code — split them so
            // returning users keep a warm cache across app deploys.
            manualChunks: {
              vendor: ['@google/genai', 'canvas-confetti'],
            }
          }
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

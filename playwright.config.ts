import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4321', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']} },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4321', url: 'http://127.0.0.1:4321', reuseExistingServer: false },
});

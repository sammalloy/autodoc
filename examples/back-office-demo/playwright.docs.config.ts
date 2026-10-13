import { defineDocsConfig } from '@autodoc/playwright';

export default defineDocsConfig({
  appRoot: import.meta.dirname,
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node serve.mjs', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
});

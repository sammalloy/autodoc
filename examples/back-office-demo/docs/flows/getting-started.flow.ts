import { docFlow } from '@autodoc/playwright';

docFlow('Getting started', async ({ page, shot }) => {
  await page.goto('/');
  await shot('home');
  await shot('help-button', { highlight: page.getByRole('button', { name: 'Help for this page' }) });
});

import { docFlow, expect } from '@autodoc/playwright';

docFlow('Create an invoice', async ({ page, shot }) => {
  await page.goto('/#/invoices');
  const newInvoice = page.getByRole('button', { name: 'New invoice' });
  await shot('invoice-list', { highlight: newInvoice });

  await newInvoice.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shot('new-invoice-tip', { clip: [page.locator('.card h1'), page.getByRole('tooltip')] });

  await newInvoice.click();
  await page.getByLabel('Customer').selectOption('Acme Ltd');
  await page.getByLabel('Amount (£)').fill('1250.00');
  await shot('invoice-form', {
    markers: [page.getByLabel('Customer'), page.getByLabel('Issue date'), page.getByLabel('Amount (£)'), page.getByRole('button', { name: 'Save draft' })],
  });
});

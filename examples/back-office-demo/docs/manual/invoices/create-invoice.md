---
title: Create an invoice
covers:
  - src/app.js
help:
  invoices.new:
    tip: Start a draft invoice. Nothing is sent until you choose Send.
    section: start-a-draft
  invoices.customer:
    tip: Only active customers are listed. Ask finance ops to reactivate one.
    section: pick-a-customer
  invoices.status:
    tip: Draft, Sent or Paid. Paid is set automatically when payment arrives.
    section: invoice-statuses
---

# Create an invoice

## Start a draft

1. Open **Invoices** from the top bar.
2. Click **New invoice**.

   <Shot id="invoice-list" alt="The invoice list with the New invoice button highlighted" />

Hovering **New invoice** shows a short tip:

<Shot id="new-invoice-tip" alt="The help tip on the New invoice button" />

## Pick a customer

Choose the customer, check the issue date and enter the amount, then click **Save draft**.

<Shot id="invoice-form" alt="The new invoice form with its fields numbered" />

## Invoice statuses

| Status | Meaning |
| --- | --- |
| Draft | Saved but not sent |
| Sent | Emailed to the customer |
| Paid | Payment received |

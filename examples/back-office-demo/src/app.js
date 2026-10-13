import { installHelp } from '/autodoc-help.js';

const help = installHelp({ index: '/help-index.json' });
document.getElementById('help-button').addEventListener('click', () => help.openForRoute(route()));

const invoices = [
  { no: 'INV-1042', customer: 'Acme Ltd', total: '£1,250.00', status: 'Paid' },
  { no: 'INV-1043', customer: 'Northwind', total: '£430.50', status: 'Draft' },
  { no: 'INV-1044', customer: 'Globex', total: '£2,980.00', status: 'Sent' },
];

const route = () => location.hash.slice(1) || '/';
const view = document.getElementById('view');

const pages = {
  '/': () => `
    <div class="card">
      <h1>Welcome back</h1>
      <p>You have <strong>${invoices.filter(i => i.status === 'Draft').length}</strong> draft invoice to finish.</p>
      <p class="muted">Today is ${new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })}.</p>
      <a href="#/invoices">Go to invoices</a>
    </div>`,
  '/invoices': () => `
    <div class="card">
      <h1>Invoices <button class="primary" data-help="invoices.new" onclick="location.hash='#/invoices/new'">New invoice</button></h1>
      <table>
        <thead><tr><th>Number</th><th>Customer</th><th>Total</th><th data-help="invoices.status">Status</th></tr></thead>
        <tbody>${invoices.map(i => `<tr><td>${i.no}</td><td>${i.customer}</td><td>${i.total}</td><td>${i.status}</td></tr>`).join('')}</tbody>
      </table>
    </div>`,
  '/invoices/new': () => `
    <div class="card">
      <h1>New invoice</h1>
      <label for="customer">Customer</label>
      <select id="customer" data-help="invoices.customer">
        <option value="">Choose a customer</option>
        <option>Acme Ltd</option><option>Northwind</option><option>Globex</option>
      </select>
      <label for="issued">Issue date</label>
      <input id="issued" value="${new Date().toISOString().slice(0, 10)}" readonly>
      <label for="amount">Amount (£)</label>
      <input id="amount" inputmode="decimal" placeholder="0.00">
      <div class="actions"><button class="primary" id="save">Save draft</button></div>
    </div>`,
};

function render() {
  const r = route();
  view.innerHTML = (pages[r] ?? pages['/'])();
  for (const a of document.querySelectorAll('.bar nav a')) {
    const target = a.getAttribute('href').slice(1);
    a.toggleAttribute('aria-current', target === '/' ? r === '/' : r.startsWith(target));
  }
}

addEventListener('hashchange', render);
render();

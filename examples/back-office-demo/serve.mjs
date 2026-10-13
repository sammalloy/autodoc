// Serves the demo app, its help index (built from the manual on each request) and the built manual.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildHelpIndex, loadApp } from '@autodoc/core';

const root = import.meta.dirname;
const helpRuntime = join(root, '../../packages/help/dist/index.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const port = Number(process.env.PORT ?? 4173);

function file(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/help-index.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(buildHelpIndex(loadApp(root))));
  }
  if (path === '/autodoc-help.js') return file(res, helpRuntime);
  if (path.startsWith('/help/')) return file(res, join(root, 'docs-site', path.slice(6)));
  if (path === '/') return file(res, join(root, 'src/index.html'));
  return file(res, join(root, 'src', path));
}).listen(port, () => console.log(`demo on http://localhost:${port}`));

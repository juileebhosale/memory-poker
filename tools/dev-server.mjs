// Local server that behaves like production (Vercel + the Next.js rewrite):
//   /                -> 307 redirect to /memory-poker/
//   /memory-poker    -> index.html, NO redirect (like the Next.js rewrite, which strips the slash)
//   /memory-poker/   -> index.html
//   anything else    -> the file at that path under the repo root
// Usage: node tools/dev-server.mjs [port]   (default 8000)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2]) || 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/_vercel/')) {
    // Vercel Web Analytics only exists on Vercel. Locally, answer with an empty script.
    res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('');
    return;
  }
  if (pathname === '/') {
    res.writeHead(307, { Location: '/memory-poker/' }).end();
    return;
  }
  let path = pathname === '/memory-poker' || pathname === '/memory-poker/'
    ? '/memory-poker/index.html'
    : pathname;
  const file = normalize(join(ROOT, decodeURIComponent(path)));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Memory Poker dev server: http://localhost:${PORT}/memory-poker/`);
  console.log(`Also try (no slash):     http://localhost:${PORT}/memory-poker`);
});

// Minimal, dependency-free static server for smoke tests.
// Serves the built `dist/` under the production base path `/AST9_HUB/` so the
// absolute asset URLs Vite emits (e.g. /AST9_HUB/assets/app-*.js) resolve —
// `vite preview` can't do this because vite.config only sets base on `build`.
// Usage: node tests/smoke/serve-dist.mjs [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const BASE = '/AST9_HUB';
const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf',
};

const server = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    if (pathname === BASE) pathname = BASE + '/';
    if (!pathname.startsWith(BASE + '/')) { res.writeHead(404); res.end('Not found'); return; }
    let rel = pathname.slice(BASE.length + 1);
    if (rel === '') rel = 'index.html';
    const filePath = normalize(join(ROOT, rel));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + require_sep())) { res.writeHead(403); res.end('Forbidden'); return; }
    let target = filePath;
    try { const s = await stat(target); if (s.isDirectory()) target = join(target, 'index.html'); }
    catch { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});

function require_sep() { return process.platform === 'win32' ? '\\' : '/'; }

server.listen(PORT, () => console.log(`[serve-dist] http://localhost:${PORT}${BASE}/ -> ${ROOT}`));

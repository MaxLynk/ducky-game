// A static server for dist/ on this machine only (127.0.0.1). Answers byte ranges, which
// iPhone Safari needs for anything it streams. Usage: node scripts/serve.mjs [port] [dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 5317);
const dir = path.resolve(process.argv[3] || path.join(here, '..', 'dist'));
const host = '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };

export function serve(root = dir, p = port, h = host) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    const size = fs.statSync(file).size;
    const type = types[path.extname(file)] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const a = range[1] ? Number(range[1]) : 0;
      const b = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(p, h, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  serve().then((s) => console.log(`serving ${dir} at http://${host}:${s.address().port}/`));
}

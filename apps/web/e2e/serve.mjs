// Minimal static server for the Next.js export in ./out, mirroring S3 + CloudFront behaviour:
// `/foo/` → out/foo/index.html, `/foo` → redirect to `/foo/`, unknown → out/404.html.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = new URL('../out/', import.meta.url).pathname;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

function send(res, file, status = 200) {
  res.writeHead(status, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) {
      res.writeHead(308, { location: `${path}/${url.search}` });
      return res.end();
    }
    file = join(file, 'index.html');
  }
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (existsSync(file) && statSync(file).isFile()) return send(res, file);
  const notFound = join(root, '404.html');
  if (existsSync(notFound)) return send(res, notFound, 404);
  res.writeHead(404);
  res.end('Not found');
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});

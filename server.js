import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');

const PORT            = process.env.PORT || 8080;
const API_TARGET      = process.env.API_TARGET || 'http://127.0.0.1:8000';
const NTOPNG_TARGET   = process.env.NTOPNG_BASE_URL || 'https://flow-ntop.aquitelecom.com';
const NTOPNG_TOKEN    = process.env.NTOPNG_TOKEN || '';
const CF_AUTHORIZATION = process.env.CF_AUTHORIZATION || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function proxy(req, res, targetUrl, extraHeaders = {}) {
  const target = new URL(targetUrl);
  const lib = target.protocol === 'https:' ? https : http;

  const headers = { ...req.headers, host: target.host, ...extraHeaders };

  const proxyReq = lib.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers,
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad gateway: ${err.message}`);
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    return proxy(req, res, API_TARGET + url.pathname + url.search);
  }

  if (url.pathname.startsWith('/ntopng-api')) {
    const rest = url.pathname.replace(/^\/ntopng-api/, '') || '/';
    const headers = {};
    if (NTOPNG_TOKEN) {
      headers['Authorization'] = `Token ${NTOPNG_TOKEN}`;
      headers['X-Auth-Token'] = NTOPNG_TOKEN;
    }
    if (CF_AUTHORIZATION) {
      headers['Cookie'] = `CF_Authorization=${CF_AUTHORIZATION}`;
      headers['CF-Access-Jwt-Assertion'] = CF_AUTHORIZATION;
    }
    return proxy(req, res, NTOPNG_TARGET + rest + url.search, headers);
  }

  // Static files from dist/, SPA fallback to index.html
  let filePath = join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html');
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Flow Guard frontend serving on :${PORT}`);
  console.log(`  /api       -> ${API_TARGET}`);
  console.log(`  /ntopng-api -> ${NTOPNG_TARGET}`);
});

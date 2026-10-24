import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createBrokerRoutes } from './oauth.mjs';

const indexPath = new URL('./index.html', import.meta.url);

export function createServer(options = {}) {
  const brokerRoutes = createBrokerRoutes(options);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    if (await brokerRoutes.handle(req, res, url)) return;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    const path = req.url.split('?')[0];
    let body;
    let contentType;
    let status = 200;
    if (path === '/healthz') {
      body = JSON.stringify({ status: 'ok', service: 'smc-dashboard' });
      contentType = 'application/json; charset=utf-8';
    } else if (path === '/api/status') {
      body = JSON.stringify({
        realtimeConnected: false,
        stage: 'broker-authorization-available',
        message: 'Connect your own cTrader session at /auth/ctrader. Public snapshots and daily references are not live. Check /api/ctrader/status for the current browser session connection.',
      });
      contentType = 'application/json; charset=utf-8';
    } else if (path === '/' || path === '/index.html') {
      try {
        body = await readFile(indexPath);
        contentType = 'text/html; charset=utf-8';
      } catch {
        status = 500;
        body = 'Dashboard file unavailable';
        contentType = 'text/plain; charset=utf-8';
      }
    } else {
      status = 404;
      body = 'Not found';
      contentType = 'text/plain; charset=utf-8';
    }
    res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  server.on('close', () => brokerRoutes.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Dashboard web server listening on port ${port}; cTrader authorization endpoint available; a browser session must connect before receiving broker data.`);
  });
}

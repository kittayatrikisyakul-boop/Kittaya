import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const indexPath = new URL('./index.html', import.meta.url);

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
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
    } else if (path === '/auth/ctrader/callback') {
      // Reserve the registered redirect endpoint without accepting broker
      // authorization codes before a verified OAuth flow is installed.
      const query = new URL(req.url, 'http://localhost').searchParams;
      status = query.has('code') || query.has('error') ? 503 : 200;
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      body = '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>cTrader connection setup</title><h1>cTrader connection setup</h1><p>Redirect endpoint registered for Kittaya Dashboard.</p><p>OAuth token exchange and live broker data are not enabled yet. Do not start account authorization until the connection flow is configured.</p><p>หน้านี้เตรียมไว้สำหรับตั้งค่าแอป ยังไม่ได้เชื่อมบัญชีหรือรับราคาเรียลไทม์</p></html>';
      contentType = 'text/html; charset=utf-8';
    } else if (path === '/api/status') {
      body = JSON.stringify({
        realtimeConnected: false,
        stage: 'web-server-only',
        message: 'Broker integration is not installed. The dashboard uses daily reference rates, not a live broker feed.',
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Dashboard web server listening on port ${port}; broker feed is not connected.`);
  });
}

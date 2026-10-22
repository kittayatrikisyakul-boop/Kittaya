# SMC Dashboard

## Current capabilities

The web server serves the existing dashboard. Forex card data remains a daily reference feed; gold/oil card prices have no connected feed. TradingView charts are independent of dashboard quotes. Broker authentication, streaming market data, and real-time SMC computation are **not implemented yet**. `/api/status` reports this explicitly. `/healthz` validates only the web server, not a market-data connection.

## Deploy this web server on Render

Create a **Web Service** from `kittayatrikisyakul-boop/Kittaya`:

- Branch: `main`
- Language/runtime: Node
- Root Directory: leave empty
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Select your preferred instance plan after checking its cost. Free instances may sleep and should not be relied on for an uninterrupted market-data connection. No API keys are needed to deploy the current web server. Render supplies `PORT`; the server binds to `0.0.0.0`.

After deployment, open the HTTPS service URL shown by Render. Confirm the dashboard loads and `/healthz` returns `{"status":"ok","service":"smc-dashboard"}`. Obtain this URL before configuring a broker OAuth callback. Do not configure a callback path until its handler is implemented.

GitHub Pages continues to host static HTML only; server-side endpoints require the Render service.

## Local validation

Requires Node.js 22 or 24.

```sh
npm ci
npm test
npm start
```

## Next: cTrader connection prerequisites

A cTrader account (demo is suitable for development), an Open API application approved as required by cTrader, and a hosted OAuth callback are prerequisites. All broker credentials and tokens must remain server-side. Never add client secrets or access/refresh tokens to this public repository, browser scripts, or chat. Configure them through the hosting service's Environment settings when broker support is implemented.

Before declaring real-time readiness, validate authorized account access, symbol availability for XAUUSD/GBPJPY/GBPNZD/GBPAUD/USDJPY, historical candles, live quotes, reconnect/catch-up, and stale-data suppression. A successful web deployment does not validate these capabilities.

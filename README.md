# SMC Dashboard

## Current capabilities

The web server serves the existing dashboard. Cards default to a one-time snapshot read from public TradingView/OANDA symbol pages. Each record preserves its source URL and page retrieval time; the actual quote timestamp is unknown. This is not a live feed and never generates streaming alerts. Fourteen symbols are included; oil is unavailable. The source selector can switch to daily reference Forex rates, which do not include gold/oil. The selected mode is retained in browser local storage. Neither mode is a live broker connection. TradingView charts are independent of dashboard quotes. Broker authentication, streaming market data, and real-time SMC computation are **not implemented yet**. `/api/status` reports this explicitly. `/healthz` validates only the web server, not a market-data connection.

## Deploy this web server on Render

Create a **Web Service** from `kittayatrikisyakul-boop/Kittaya`:

- Branch: `main`
- Language/runtime: Node
- Root Directory: leave empty
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Select your preferred instance plan after checking its cost. Free instances may sleep and should not be relied on for an uninterrupted market-data connection. No API keys are needed to deploy the current web server. Render supplies `PORT`; the server binds to `0.0.0.0`.

After deployment, open the HTTPS service URL shown by Render. Confirm the dashboard loads and `/healthz` returns `{"status":"ok","service":"smc-dashboard"}`. The reserved broker redirect URL is `https://kittaya.onrender.com/auth/ctrader/callback`. It displays a setup notice only; it does not exchange authorization codes or connect a broker account. Authorization requests are refused until the OAuth flow is implemented. Registering this URL in the developer application does not enable authentication or live data.

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

## TradingView snapshot

The snapshot is bundled in `index.html` as `TRADINGVIEW_SNAPSHOT`. It is a one-time observation, not an automated scraping service or a TradingView data API. It does not refresh itself. Retrieval time must never be described as the quote/tick timestamp. Values do not establish candle structure, so existing manually supplied OB/FVG/TP/SL levels have not been recalculated. Snapshot and daily-reference data are kept separate; switching clears prior quote baselines and events.

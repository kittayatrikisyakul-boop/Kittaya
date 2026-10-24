# SMC Dashboard

## Current modes

- **cTrader:** per-browser, read-only broker connection. Backend streams BID/ASK quotes and H4 trend bars. Browser polls backend snapshots approximately every two seconds. Available exact symbol names are matched against the 14 requested Forex/gold instruments. Oil is optional and currently not subscribed. Missing or ambiguous symbols remain unavailable; there are no simulated prices.
- **TradingView snapshot:** a one-time public-page observation bundled in `index.html`. Actual tick timestamps are unknown. This mode is not live and does not refresh itself or produce live signals.
- **Daily reference API:** daily Forex rates, not broker quotes; no gold/oil feed.

TradingView charts are an independent feed. They must not be described as the source of cTrader quote/signal values.

## Render setup

Create a Node **Web Service** using `main`, empty Root Directory, Build Command `npm ci`, Start Command `npm start`, Health Check Path `/healthz`. Node 22 or 24 is required. Render supplies `PORT`; the process binds to `0.0.0.0`.

Set these in **Render → Environment**, never in the public repository or chat:

- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET` (rotate any previously disclosed secret)
- `CTRADER_REDIRECT_URI=https://kittaya.onrender.com/auth/ctrader/callback`

Register the exact same callback URL in the approved cTrader application. No other credentials are required in the frontend. `/api/ctrader/status` reports configuration presence and this browser's authorization/connection status without exposing credentials.

After deployment, open **https://kittaya.onrender.com/auth/ctrader** in the browser that will view the dashboard. Consent is requested with `scope=accounts`, not trading scope. Return to the callback in the same browser; OAuth state must match the initiating session. The flow fails closed if state is missing/invalid rather than accepting an unbound authorization code. Select an authorized account, then the dashboard selects cTrader mode automatically. Token exchange, expiry-aware refresh, account authorization and broker WebSocket traffic take place server-side. OAuth credentials, codes and tokens are never returned to browser JavaScript or logged by the application.

**Sessions and tokens are held only in server RAM**, isolated by HttpOnly/Secure/SameSite=Lax cookies. A session expires after one hour of inactivity. A server restart, Render sleep/redeploy or browser-cookie removal requires reconnecting; no durable token store is configured. No claim of uninterrupted operation is made for Render's free service. Tokens refresh while an active session polls; broker subscriptions and H4 history reload after disconnection. Session capacity is bounded at 100.

GitHub Pages can display the static snapshot/reference modes only. Use the Render origin for broker authentication and live mode.

## Signals and data semantics

- BID is the displayed broker quote. ASK is received separately. Do not substitute a TradingView or another broker quote.
- Server requires provider timestamps and rejects out-of-order/future quotes. Quotes older than 120 seconds or a disconnected broker are not treated as fresh, including the last quote received while the market is closed.
- H4 candle prices use protocol integers divided by 100000; bar timestamps are UTC minutes. Only closed H4 bars are used for structure. At least 20 closed bars are required.
- A pivot uses two closed bars to each side. A close crossing the latest confirmed pivot produces BOS; an opposite-direction structural break produces CHoCH.
- An OB is the last opposite candle within eight preceding candles before the break. It is invalidated by a closed price beyond its distal edge. FVGs use three candles and are removed when fully filled. These are explicit implementation rules, not a claim that all SMC traders define structures identically.
- Live zone-entry/proximity notifications require fresh quotes and available candle analysis. They describe observed zone entries, not guaranteed trade outcomes. Browser polling may miss short-lived intrapoll movements; this is not a tick-perfect alert delivery system.
- Entry/SL/TP trade setups are not yet generated from the live engine. Manual reference targets are hidden in cTrader mode rather than reused as broker signals. Confirmed pivot targets are shown when available.
- Snapshot/daily data, old-account baselines and broker reconnects cannot silently become new live ticks.

`/healthz` validates the web server only. `/api/ctrader/status` and `/api/ctrader/market` apply to the current authenticated browser, not other visitors. Do not expose account tokens via links or screenshots.

## Validation and limits

```sh
npm ci
npm test
npm start
```

Automated tests use mock OAuth/token services and simulated broker frames: state/cookie binding, read-only scope and message allowlist, account selection, non-disclosure of tokens, broker price scaling, timestamps, exact symbol mapping, closed-candle BOS/CHoCH/FVG calculations and static serving. Browser checks cover broker, snapshot and daily modes, stale data suppression, source switching and navigation.

**A real cTrader authorization and market-data session must still be validated by the account owner after deployment.** Local mocked tests do not establish valid credentials, broker entitlement, provider state round-tripping, live symbol availability or live market connectivity. If the provider does not return the requested OAuth state, report the sanitized error; do not remove state validation as a workaround.

Official protocol references used: [Spotware schemas](https://github.com/spotware/openapi-proto-messages), inspected commit `3fd8bddfbe0cfc2ecfda079623dc4e498af11e66`; [OpenApiPy](https://github.com/spotware/OpenApiPy), inspected commit `e944996e6fe9436b8b4a1b668da4ac41a826bb85` (authorization/token endpoints and grant parameters). This implementation uses Node's native WebSocket JSON transport, not the Python SDK.

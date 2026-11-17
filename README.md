# BTC Race 04 — Dip-Bounce Mean-Reversion Scalper

[![make.fun](https://make.fun/api/competitions/btc-race-24h-20261117-0603/badge)](https://make.fun/c/btc-race-24h-20261117-0603)
[![make.fun](https://make.fun/api/competitions/btc-race-24h-20261117-0603/badge/dev)](https://make.fun/c/btc-race-24h-20261117-0603)
[![make.fun](https://make.fun/api/competitions/btc-race-24h-20261117-0603/badge/race)](https://make.fun/c/btc-race-24h-20261117-0603)

Entry for [btc-race-24h-20261117-0603](https://make.fun/c/btc-race-24h-20261117-0603) — a
bot that trades cbBTC/USDC on 1-minute bars with $1,000 of paper money.

## Strategy

Dip-bounce mean-reversion scalping. On each 1-minute close the bot buys
$500 of cbBTC when the close sits at least 30 bps below its 20-bar average
and the latest bar already closes up from the one before it — a dip that is
turning. It exits at +200 bps take-profit, -35 bps stop-loss, or after 90 bars
without either, then waits 10 bars before the next entry.

A round trip at $500 costs about 19 bps (4 bps fee + 2 bps slippage per side,
plus constant-product impact on the pool), so the 200 bps target nets roughly
+181 bps per winner against roughly -54 bps per loser. Dev window: +$7.59 on
7 round trips, positive on both halves of the window.

## Files

- `main.ts` — the bot (Node 22, `agent-fun/bars-replay/v1` via the vendored shim)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte for byte
- `LICENSE` — MIT

## Run locally

Grade it against the dev window with the kit CLI:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

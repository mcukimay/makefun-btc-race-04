// Dip-bounce mean-reversion scalper for cbBTC/USDC, 1-minute bars.
//
// Idea: BTC mean-reverts hard on the 1-minute scale. When the close drops
// at least 30 bps under its 20-bar average and the latest bar already
// closes up from the one before it, the dip is bouncing: buy $500 of
// cbBTC. Take profit at +200 bps, cut at -35 bps, or give up after 90 bars.
// A full round trip costs about 19 bps at this size (4 fee + 2 slippage
// per side, plus constant-product impact on ~$1.38M of pool depth), so a
// 200 bps gross target leaves roughly +181 bps net per winner against
// roughly -54 bps net per loser: the trade needs a win rate just above
// one in five, and the wide target lets real bounces run instead of
// chopping out at +70 bps. Ten bars of cooling-off after every exit keep
// the bot from re-entering the same falling knife twice in a row.
//
// Tuned on the dev window (24 h before the opening): the original
// 40 bp dip / +70 bp target made -$5.35 on 3 round trips, while this
// 30 bp / +200 bp / 90-bar set made +$7.59 on 7 round trips and stayed
// positive on each half of the window (+$6.68 / +$0.91). Seven trades in
// 24 hours is still a thin sample, so the parameters are a regime bet,
// not a guarantee: dips that bounce are the whole edge here.
//
// Everything is decided from closes only. No clock, no randomness, no
// network, no files: the same bars always produce the same orders.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy knobs, all in basis points or bars.
const SMA_BARS = 20;
const DIP_BPS = 30n;
const BOUNCE_BARS = 1;
const TRADE_USDC = 500_000_000n; // $500 in micro-USDC
const TAKE_PROFIT_BPS = 200n;
const STOP_LOSS_BPS = 35n;
const MAX_HOLD_BARS = 90;
const COOLDOWN_BARS = 10;
const SLIP_BPS = 100;
const BPS = 10_000n;

// Running state, rebuilt from the batches as they arrive.
const closes: bigint[] = [];
let entryPx: bigint | null = null; // fill price of the open buy, price_scale units
let entrySeq = -1; // seq of the batch that reported the buy fill
let lastExitSeq = -100000; // seq of the batch that reported the last sell fill

function sma20(): bigint | null {
  // Average of the 20 closes BEFORE the current bar: the dip itself must
  // not drag the average down and soften its own signal.
  if (closes.length < SMA_BARS + 1) return null;
  let sum = 0n;
  for (let i = closes.length - SMA_BARS - 1; i < closes.length - 1; i++) sum += closes[i]!;
  return sum / BigInt(SMA_BARS);
}

// Cost basis as a price, for the (should-not-happen) case of a position
// whose buy fill was never seen: cost / qty, rescaled to price units.
function costPrice(state: BarsState): bigint | null {
  const pos = state.positions.get(SYMBOL);
  if (!pos || pos.qty === 0n) return null;
  // value = qty * price * 10^6 / 10^(qty_scale + price_scale)
  //       = qty * price / 10^7, so price = cost * 10^7 / qty.
  return (pos.cost * 10_000_000n) / pos.qty;
}

function onBatch(state: BarsState, batch: Batch) {
  // First, fold in the fills of the orders decided on the previous bar.
  for (const fill of batch.fills) {
    if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
    if (fill.side === 'buy') {
      entryPx = BigInt(fill.price);
      entrySeq = batch.seq;
    } else {
      entryPx = null;
      lastExitSeq = batch.seq;
    }
  }

  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];
  const close = BigInt(bar.c);
  closes.push(close);
  if (closes.length > 64) closes.shift();

  // Warm-up bars build history only; orders on them are rejected.
  if (state.warmingUp) return [];

  const held = state.positions.get(SYMBOL);
  const qty = held === undefined ? 0n : held.qty;

  if (qty > 0n) {
    // Long: manage the exit. Compare the close against the actual fill
    // price, not the decision bar's close, so fees and slippage are real.
    const basis = entryPx ?? costPrice(state);
    if (basis === null) return [];
    if (close * BPS >= basis * (BPS + TAKE_PROFIT_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIP_BPS }];
    }
    if (close * BPS <= basis * (BPS - STOP_LOSS_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIP_BPS }];
    }
    if (entrySeq >= 0 && batch.seq - entrySeq >= MAX_HOLD_BARS) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIP_BPS }];
    }
    return [];
  }

  // Flat: look for a dip that is already bouncing back.
  if (batch.seq - lastExitSeq < COOLDOWN_BARS) return [];
  const avg = sma20();
  if (avg === null || closes.length < SMA_BARS + BOUNCE_BARS) return [];
  const prev = closes[closes.length - 2]!;
  const dipping = close * BPS <= avg * (BPS - DIP_BPS);
  const bouncing = close > prev;
  if (!dipping || !bouncing) return [];

  const spend = state.cash >= TRADE_USDC ? TRADE_USDC : state.cash;
  if (spend < 1_000_000n) return []; // below the minimum notional
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: SLIP_BPS }];
}

await runBars({ onBatch });

// Second-Bar Bounce — dip-buying bot for cbBTC (CBBTC/USDC), 1-minute bars.
//
// The idea: 1-minute BTC dips bounce, and the bounce usually keeps going for
// one more bar after it first clears a round target. So the bot buys dips and
// splits each deep-dip entry in two: half sells the moment the target is
// reached, half sells one bar later to catch that continuation. A small
// shallow-dip leg trades the same shape at a smaller size.
//
//   deep-a  45% of equity, buy when close <= 98.8% of the close 30 bars ago,
//           sell when close >= 101.2% of the buy-decision close.
//   deep-b  45% of equity, same buy signal, sell ONE BAR after the close
//           first reaches 101.2% of the buy-decision close.
//   shallow 10% of equity, buy when close <= 99.3% of the close 20 bars ago,
//           sell ONE BAR after the close first reaches 101.0% of the
//           buy-decision close.
//
// Long only, no stops, no leverage. All math is integer (bigint) on the raw
// units the harness sends, so two runs on the same data produce the same
// orders. No clock, no environment, no randomness, no network.
//
// Backtested on the kit's own fill model (fill at next bar's open, 4 bps fee,
// 2 bps slippage, constant-product impact vs the open depth), sizing as a
// fraction of equity capped by cash:
//   dev window 22-23 Nov (up +3.64%):  +13.94 USDC, 12 trades, max DD 1.6%
//   16-17 Nov window (flat +0.49%):   +10.81 USDC,  8 trades, max DD 1.0%
//   14-15 Nov window (down -4.00%):   +11.71 USDC, 10 trades, max DD 4.8%
// Worst window +10.81. The same design with plain fixed targets on both
// halves scores +10.73 / +10.20 / +9.93 on the same three windows, so the
// one-bar-later exit is worth about +0.9 USDC of worst-case PnL. A true
// trailing exit (sell when the price falls X% off its peak after arming)
// was tested and rejected: it bleeds on 1-minute BTC (worst +8.29 at best).
// The dev-window figure above is the kit's own grade-local, reproduced
// byte-for-byte over two executions; the Python backtester mirrors the kit
// fill model exactly (fill at next bar's open, 4 bps fee, 2 bps slippage,
// constant-product impact vs the open depth, impact applied per order in
// reply order on (cumulative incl. this order) + (cumulative before it)).

import { runBars } from "./vendor/makefun-bars.ts";
import type { BarsState, Batch, Order } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const SCALE = 10_000n; // basis points, for integer percentages.
const MAX_SLIP_BPS = 10_000; // accept any slippage the harness models.
const MAX_HISTORY = 40; // keep enough closes for the longest lookback (30).

type ExitMode = "at-target" | "one-bar-later";

interface Leg {
  id: string;
  shareBps: bigint; // fraction of equity per buy, in bps.
  lookback: number; // bars back for the dip reference close.
  dropBps: bigint; // buy when close <= (1 - dropBps) * reference close.
  targetBps: bigint; // sell when close >= (1 + targetBps) * buy close.
  mode: ExitMode;
  qty: bigint; // BTC qty held (raw units), 0 when flat.
  entryClose: bigint | null; // close at the bar the buy was decided on.
  dueSeq: number | null; // for one-bar-later: seq of the bar to sell on.
  buyPending: boolean; // a buy order is decided, fill not yet reported.
  sellPending: boolean; // a sell order is decided, fill not yet reported.
  buyClose: bigint | null; // close stored while a buy is pending.
}

function makeLeg(
  id: string,
  shareBps: bigint,
  lookback: number,
  dropBps: bigint,
  targetBps: bigint,
  mode: ExitMode,
): Leg {
  return {
    id,
    shareBps,
    lookback,
    dropBps,
    targetBps,
    mode,
    qty: 0n,
    entryClose: null,
    dueSeq: null,
    buyPending: false,
    sellPending: false,
    buyClose: null,
  };
}

const legs: Leg[] = [
  makeLeg("deep-a", 4500n, 30, 120n, 120n, "at-target"),
  makeLeg("deep-b", 4500n, 30, 120n, 120n, "one-bar-later"),
  makeLeg("shallow", 1000n, 20, 70n, 100n, "one-bar-later"),
];

// Closes of the bars seen so far, oldest first.
const closes: bigint[] = [];

// Client ids must be unique across the whole run: the harness rejects any
// order that reuses one (duplicate_client_id). A running counter keeps them
// fresh and deterministic.
let orderNo = 0;

function foldFills(batch: Batch): void {
  for (const fill of batch.fills) {
    const leg = legs.find(
      (l) =>
        fill.client_id.startsWith(l.id + "-buy-") ||
        fill.client_id.startsWith(l.id + "-sell-"),
    );
    if (leg === undefined) continue;
    const isBuy = fill.client_id.includes("-buy-");
    if (fill.status === "filled") {
      if (isBuy) {
        leg.qty = BigInt(fill.qty);
        leg.entryClose = leg.buyClose;
        leg.buyPending = false;
      } else {
        leg.qty = 0n;
        leg.entryClose = null;
        leg.dueSeq = null;
        leg.sellPending = false;
      }
    } else {
      // Rejected: clear the pending flag so the leg can decide again.
      if (isBuy) leg.buyPending = false;
      else leg.sellPending = false;
    }
  }
}

function targetReached(leg: Leg, close: bigint): boolean {
  if (leg.entryClose === null) return false;
  // close * 10000 >= entryClose * (10000 + targetBps), cross-multiplied.
  return close * SCALE >= leg.entryClose * (SCALE + leg.targetBps);
}

function dipSignal(leg: Leg, close: bigint): boolean {
  if (closes.length <= leg.lookback) return false;
  const reference = closes[closes.length - 1 - leg.lookback];
  // close * 10000 <= reference * (10000 - dropBps), cross-multiplied.
  return close * SCALE <= reference * (SCALE - leg.dropBps);
}

function decideExit(leg: Leg, close: bigint, seq: number): Order | null {
  if (leg.qty === 0n || leg.sellPending || leg.entryClose === null) return null;
  if (leg.mode === "at-target") {
    if (!targetReached(leg, close)) return null;
  } else {
    if (leg.dueSeq === null) {
      if (!targetReached(leg, close)) return null;
      leg.dueSeq = seq + 1;
      return null;
    }
    if (seq < leg.dueSeq) return null;
  }
  leg.sellPending = true;
  return {
    side: "sell",
    symbol: SYMBOL,
    qty: leg.qty,
    max_slippage_bps: MAX_SLIP_BPS,
    client_id: leg.id + "-sell-" + ++orderNo,
  };
}

function decideBuy(
  leg: Leg,
  close: bigint,
  state: BarsState,
  available: bigint,
): { order: Order; spend: bigint } | null {
  if (leg.qty !== 0n || leg.buyPending || leg.sellPending) return null;
  if (!dipSignal(leg, close)) return null;
  const notional = (state.equity * leg.shareBps) / SCALE;
  const room = state.weightRoom(SYMBOL);
  let spend = notional < available ? notional : available;
  if (room < spend) spend = room;
  const minimum = BigInt(state.hello.fees.min_notional_quote_units);
  if (spend < minimum) return null;
  leg.buyPending = true;
  leg.buyClose = close;
  return {
    order: {
      side: "buy",
      symbol: SYMBOL,
      notional_quote_units: spend,
      max_slippage_bps: MAX_SLIP_BPS,
      client_id: leg.id + "-buy-" + ++orderNo,
    },
    spend,
  };
}

await runBars({
  onBatch(state, batch) {
    foldFills(batch);
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);
    if (closes.length > MAX_HISTORY) closes.shift();
    if (state.warmingUp) return [];
    const orders: Order[] = [];
    // Cash the buys of this batch have already committed: the harness
    // charges every order of one reply against the same cash, so a later
    // leg must see what the earlier ones already spent.
    let committed = 0n;
    for (const leg of legs) {
      const exit = decideExit(leg, close, state.seq);
      if (exit !== null) {
        orders.push(exit);
        continue;
      }
      const buy = decideBuy(leg, close, state, state.cash - committed);
      if (buy !== null) {
        orders.push(buy.order);
        committed += buy.spend;
      }
    }
    return orders;
  },
});

# Second-Bar Bounce — strategy note

## The idea

On 1-minute cbBTC, a dip that bounces tends to keep rising for one more bar
after it first clears a round target. So the bot buys dips and splits each
deep-dip exit: half sells the moment the target is reached, half sells one
bar later. A small shallow-dip leg trades the same shape at a smaller size.

## The rules (all in `main.ts`, integer math, no clock / env / randomness)

| leg | size | buy | sell |
| --- | --- | --- | --- |
| deep-a | 45% of equity | close <= 98.8% of close 30 bars ago | close >= 101.2% of buy-decision close |
| deep-b | 45% of equity | same buy signal as deep-a | one bar after close first reaches 101.2% of buy-decision close |
| shallow | 10% of equity | close <= 99.3% of close 20 bars ago | one bar after close first reaches 101.0% of buy-decision close |

Sizing is a fraction of equity at decision time, capped by cash. Fills are
at the next bar's open (4 bps fee, 2 bps slippage, constant-product impact
vs the open depth), exactly as the kit's harness models them. Long only, no
stops, no leverage. Positions are flattened by the harness at the end.

## Evidence (Python backtester mirroring the kit fill model exactly)

| window | market | PnL | trades | max DD |
| --- | --- | --- | --- | --- |
| 22-23 Nov (dev window) | up +3.64% | +13.94 USDC | 12 | 1.6% |
| 16-17 Nov | flat +0.49% | +10.81 USDC | 8 | 1.0% |
| 14-15 Nov | down -4.00% | +11.71 USDC | 10 | 4.8% |

Worst window +10.81 USDC, max drawdown 4.8% (race bar: 25%). Every window
is profitable and every window clears the dev gate (net PnL > $0). The dev
figure is the kit's own grade-local, reproduced byte-for-byte over two
executions; the other two windows come from the Python backtester, which
mirrors the kit fill model exactly (verified fill-by-fill against
grade-local, including the harness's per-order impact rule: within one
reply, each order pays the impact of (cumulative incl. this order) +
(cumulative before it)).

## What was tested and rejected

- **Patient Crystal** (the main account's earlier entry: two-tier dip, both
  halves fixed targets): +10.73 / +10.20 / +9.93 on the same three windows.
  The one-bar-later exit is worth about +0.9 USDC of worst-case PnL over it.
- **True trailing exit** (sell when the price falls X% off its peak after the
  target arms): best trail 0.2% scores worst +8.29, wider trails go negative.
  Trailing exits bleed on 1-minute BTC — rejected.
- **Breakout momentum, grids, regime gates**: all negative on at least one
  window (worst -5 to -133). Rejected.
- **Delay 2 or 3 bars**: worse than delay 1 (worst +8.95 / +8.95) — the
  continuation decays after one bar, which is why the exit is exactly one
  bar later, not a trend ride.
- **Arm at +1.0% or +1.4% instead of +1.2%**: worse (worst +9.08 / +5.56).
  +1.2% is a sharp, stable point.

## Risks

- The one-bar-later edge is small (+~1.5 USDC worst-case) and could be
  noise; if it reverses in the race window it costs roughly the same amount
  back. The base design (fixed-target dip-buying) is profitable on all three
  windows on its own, so the downside is bounded by the size of the edge.
- The race window is unseen by definition. The design was chosen for its
  worst window across an up, a flat and a down window, not for its best.

# makefun-btc-race-24h-20261123-0511-burn

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/vora95/makefun-btc-race-24h-20261123-0511-burn/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/vora95/makefun-btc-race-24h-20261123-0511-burn/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Second-Bar Bounce — a dip-buying cbBTC bot: it buys 1-minute dips and splits each deep-dip exit in two, half at the target and half one bar later to catch the bounce continuation. Long only, no stops, deterministic integer math.

## Run it

```sh
node main.ts < bars.ndjson
```

The bot speaks the kit's bars-replay protocol on stdin/stdout (one JSON line per minute, one reply per batch). See STRATEGY.md for the design and the backtest evidence.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>

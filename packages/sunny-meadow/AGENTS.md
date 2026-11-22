# Sunny Meadow (`@bighouse/sunny-meadow`) — Economy & Balance Engineering Guide

This document records the authoritative balance verification spreadsheet, economic invariants, and implementation workflow for **햇살 초원 모험 (Sunny Meadow Adventure)**.

---

## 1. Balance Verification Google Spreadsheet (Single Source of Truth)

- **Spreadsheet ID**: `1kEpRELJo7C80Ju8UmXLadLO0dclRbw-RzBVowMdPjdQ`
- **Spreadsheet URL**: https://docs.google.com/spreadsheets/d/1kEpRELJo7C80Ju8UmXLadLO0dclRbw-RzBVowMdPjdQ/edit
- **Title**: `햇살 초원 모험 - 경제·강화·제련 밸런스 검증`

### Workbook Tab Structure

| Tab Name | Purpose | Key Code Mirrors |
|---|---|---|
| `1_기본설정_공식` | Master constants for player growth, weapon enhancement, powder pricing, and drop/respawn baselines. Editing values here recalculates all downstream sheets automatically. | `src/catalogs.ts`, `src/progression.ts`, `src/economy.ts` |
| `2_무기_몬스터_DB` | All 10 weapons (base ATK, cooldown, crit, ATK/upgrade, unupgraded DPS) and all 18 monsters (stage, level, HP, ATK, EXP, elite/boss stone drop rates). | `src/catalogs.ts` |
| `3_강화_제련_비용표` | Two tables: (1) `+0 → +10` enhancement tier/stone/coin costs, exact pity-adjusted expected attempts, and stage chest equivalents; (2) 3-tier stone (`초급`/`중급`/`고급`) + `강화석 가루` dismantle/smelt exchange table with automated **Anti-Arbitrage (`PASS`/`FAIL`)** checks. | `src/economy.ts` |
| `4_스테이지별_전투밸런스` | Stage 1–10 combat matrix across `+0`, `+3 (초급)`, `+6 (중급)`, and `+10 (고급)` plus cross-tier outlier checks (low-tier `+10` vs higher-tier `+0` and Stage 10 Final Boss `별빛 드래곤`), evaluating DPS, HTK, TTK, and balance verdict (`적정`/`과다`/`과소`). | `src/economy.ts`, `src/client.ts`, `src/server.ts` |
| `5_공격력vs공속_가치비교` | Marginal DPS comparison of Attack Power (`atk`) vs Attack Speed (`dex`) upgrades across Stage 1–10 and Lv.60, proving why mixed builds (`+6/+4`) outperform pure `+10` from mid-game (`단풍 대검`) onward. | `src/economy.ts` |
| `6_코인수급_소모_시뮬레이션` | 10-minute farming income (chests + field coins + tiered stone drop value) vs expected minutes to reach `+3`, `+6`, and `+10` per stage. | `src/economy.ts`, `src/server.ts`, `src/stages/index.ts` |

---

## 2. Verified Economy & Combat Design Rules

Always preserve these invariants when adding weapons, monsters, stages, stones, or recipes:

### A. 3-Tier Upgrade Stone & Powder System
- **Tiers**:
  - **초급 (`t1`)**: `stone_red`, `stone_green`, `stone_blue`, `stone_orange` — Shop-purchasable, drops in all stages (dominant in Stages 1–4), used for **`+0 → +3`** enhancement.
  - **중급 (`t2`)**: `stone_red_t2`, `stone_green_t2`, `stone_blue_t2`, `stone_orange_t2` — Obtained via **제련 (Smelting)** or drops in **Stages 4–10**, used for **`+3 → +6`** enhancement.
  - **고급 (`t3`)**: `stone_red_t3`, `stone_green_t3`, `stone_blue_t3`, `stone_orange_t3` — Obtained via **제련 (Smelting)** or drops in **Stages 7–10**, used for **`+6 → +10`** enhancement.
  - **강화석 가루 (`stone_powder`)**: Stackable up to `999` per inventory slot (1 slot footprint), obtained exclusively by **분해 (Dismantling)** any upgrade stone.

### B. Exchange Ratios & Anti-Arbitrage Invariants
1. **Dismantle Powder Yields (`P_t`) vs Smelt Powder Costs (`R_t`)**:
   - **초급**: Red/Green dismantle `3` / smelt `5 + 20c`; Blue dismantle `4` / smelt `7 + 25c`; Orange dismantle `5` / smelt `9 + 30c`.
   - **중급**: Red/Green dismantle `8` / smelt `12 + 90c`; Blue dismantle `10` / smelt `15 + 110c`; Orange dismantle `12` / smelt `18 + 130c`.
   - **고급**: Red/Green dismantle `20` / smelt `30 + 280c`; Blue dismantle `24` / smelt `36 + 340c`; Orange dismantle `28` / smelt `42 + 400c`.
2. **Strict Anti-Arbitrage Checks** (verified in `3_강화_제련_비용표` Column M):
   - **No powder loop**: `dismantlePowder / smeltPowder <= 0.67` (< 1.0) for every stone.
   - **No coin arbitrage**: `sellPrice / basisCost <= 0.30` for every stone and powder (`stone_powder` sell = `3` coins).
   - **No dismantle-to-sell profit**: `dismantlePowder * powderSellPrice < stone.sellPrice` for every stone.
   - **No smelt-to-undercut-shop**: For buyable Tier 1 stones, `smeltPowder * 20 + smeltCoins >= buyPrice` (smelting Tier 1 is a color-conversion sink for dropped surplus stones, not a shop discount).

### C. Combat Balance (`computeEffectiveCombatStats`)
- **Attack Power (`atk`)**: `atkBonus = atkLevel * max(3, round(weapon.atk * 0.08) + 2)`
- **Attack Speed & Crit (`dex`)**:
  - `dexBonus = dexLevel * 2` (`totalDex = baseDex + dexBonus`)
  - `critChance = min(0.65, weapon.critChance + baseDex * 0.004 + dexBonus * 0.009)` (+1.8% crit per upgrade)
  - `cooldownMult = max(0.62, 1 - baseDex * 0.004 - dexBonus * 0.015)` (-3.0% cooldown per upgrade, capped at -38%, with `minCooldownSec = 0.14`)
  - Keeping `baseDex` cooldown scaling gentle (`0.004`) prevents Lv.30–60 players from hitting the speed cap prematurely and keeps Attack Speed upgrades competitive with Attack Power upgrades across all levels.

### D. Enhancement Progression (`+0 → +10`)
| Levels | Required Tier | Stones / Try | Coin Fee | Base Success Rate | Pity |
|---|---|---:|---:|---:|---|
| `+0 → +3` | 초급 (`t1`) | `1, 1, 1` | `25, 36, 53` | `100%, 100%, 100%` | +5%/fail (max +25%) |
| `+3 → +6` | 중급 (`t2`) | `1, 2, 2` | `80, 120, 175` | `85%, 75%, 65%` | +5%/fail (max +25%) |
| `+6 → +10` | 고급 (`t3`) | `1, 2, 2, 3` | `250, 360, 500, 700` | `55%, 45%, 35%, 25%` | +5%/fail (max +25%) |

---

## 3. Workflow for Future Balance & Economy Updates

Whenever you change weapon stats, monster HP/rewards, drop rates, upgrade formulas, or smelting recipes:

1. **Read current sheet values first**:
   ```bash
   gsheets readonly read 1kEpRELJo7C80Ju8UmXLadLO0dclRbw-RzBVowMdPjdQ '1_기본설정_공식!A1:D38'
   ```
2. **Update the affected constants/rows in Google Sheets** (`1_기본설정_공식`, `2_무기_몬스터_DB`, or `3_강화_제련_비용표`) using narrow `gsheets mutate write` / `batch` calls so formulas stay intact.
3. **Re-read evaluated outputs** on `3_강화_제련_비용표`, `4_스테이지별_전투밸런스`, `5_공격력vs공속_가치비교`, and `6_코인수급_소모_시뮬레이션` and confirm:
   - Zero formula errors (`#REF!`, `#NAME?`, `#VALUE!`, `#DIV/0!`, `#ERROR!`)
   - All anti-arbitrage checks in `3_강화_제련_비용표!M18:M30` evaluate to `PASS`
   - Normal/elite TTK stays in a fun pacing band and mixed builds remain viable from mid-game onward
4. **Mirror the verified constants into code** (`src/economy.ts`, `src/catalogs.ts`, `src/server.ts`, `src/client.ts`) and cover every invariant in `packages/sunny-meadow/test/economy.test.ts`.
5. **Update this `AGENTS.md`** if new tabs, stone tiers (e.g., `최고급`/`전설`), or imbuing mechanics (Blue/Orange stone effects) are added.

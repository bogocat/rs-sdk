# bogocat — lab log

Bot: `bogocat` on `rs-sdk-demo.fly.dev` (shared community server).
Computer: tower, headless (no browser), driver = pi harness + `scripts/batch.sh`.

## 2026-10-22 — Phase 0 smoke test

**Goal:** falsify the plan's chain end to end (plan v2 §5): client up → tutorial →
real skill action with *observed* effect → in-game logout → hiscores flush.

**Setup**
- clone `MaxBittker/rs-sdk` @ `b565f2d92` -> `/root/projects/rs-sdk`
- `bun install` (root + `server/webclient`), `bots/create-bot.ts bogocat --no-chat`
- root `.env` -> `TELEMETRY=false` (bug-report reads `process.env`, never `bot.env`)
- `bots/bogocat/probe.ts`, `bots/bogocat/smoke.ts`, `scripts/batch.sh`

**Observed (run 1, manual)**
- spawn: tutorial island (3094,3106), interface 3559 open, all skills lvl 1
- `skipTutorial()` -> Lumbridge (3218,3230)
- `chopTree` -> logs in inventory, Woodcutting xp 0 -> 625
- `sendClickComponent(2458)` accepted; `lite/runner.ts` logged
  `Game session ended (logged-out)`
- hiscores row created on first logout: `Overall 34, 1m 02s`

**Observed (run 2, through `scripts/batch.sh`)**
- `tutorial_open_at_start: false`; `skipTutorial` -> `success:false "No tutorial NPC found"`
  (correct on a non-tutorial character — informational, not a failure)
- `chopTree` 625 -> 1250 xp (+625), Logs slot 18, `lifeId` unchanged (1)
- `logout_click: {"success":true,"message":"Clicked component 2458","phase":"dispatch"}`
- runner rc=1, `logged-out`; batch verdict PASS; hiscores `Overall 38, 1m 14s`

**Findings (empirical, now settled)**
1. **`sendClickComponent(2458)` works from the lite client.** The server-side tab
   visibility check (`IfButtonHandler.ts:20`) did not block it — no tab pre-click needed.
2. **Playtime batches correctly.** Playtime went 62s -> 74s across two sessions with
   minutes offline in between: offline time does not accrue, because the character is
   actually logged out. The `playtime` stamp moved only because levels changed.
3. **The runner exits 1 on a clean logout** (`logged-out`), 0 only for `stopped`. A
   wrapper that treats non-zero as failure inverts the result.
4. **`tee` masks that exit code.** `bun ... | tee log` reports tee's 0. `scripts/batch.sh`
   captures the real status; never pipe a runner.
5. `chopTree` returns `{success, logs, message}` — woodcutting XP is the corroborating
   observation, not the return value.

**State:** Woodcutting 3 (1250 xp), Overall 38, playtime 1m 14s. Character is logged out.

**Next:** Phase 1 — one skill to a target level in bounded batches, measure xp/hour and
playtime per level from `/hiscores`. Add the local private gateway (`GATEWAY_URL`) first,
since 1-shot actions still pay two WAN RTTs.

**Cost:** zero LLM in the batch loop; iteration cost is the agent writing scripts only.

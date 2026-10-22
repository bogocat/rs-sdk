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

## 2026-10-22 — Phase 1: fork patches + gateway A/B

**Fork:** `bogocat/rs-sdk` (patches pushed on `main`). Local clone: `origin` = fork,
`upstream` = MaxBittker.

**Patches (with verification, not just edits)**
1. `.gitignore` — `bots/*/*` + negations. Verified: `script.ts`/`lab_log.md` trackable,
   `bot.env` still ignored.
2. `sdk/cli.ts` — honors `SHOW_CHAT=false`. Verified by A/B on a live client:
   `SHOW_CHAT=true` -> `## Player Chat` present (1); `SHOW_CHAT=false` -> absent (0).
3. `sdk/bug-report.ts` — `TELEMETRY=false` in `bots/*/bot.env` now applies (was
   `process.env` only). Verified: `bun sdk/bug-report.ts --help` -> "Telemetry is off".
4. `CLAUDE.md` — bug reporting is operator-only in this fork.
5. `.pi/mcp.json` — pi's rs-agent MCP entry.
6. `bots/_template/script.ts` — 600s timeout for batches.
7. `scripts/batch.sh` — bounded batch wrapper, now with logout recovery: a script that dies
   before its logout step gets `bots/<bot>/logout.ts` run against the still-up client.
   Verified with a deliberately failing script: recovery logged out, verdict
   "script failed (rc=1); session was logged out cleanly".

**Local gateway:** `GATEWAY_HOSTNAME=127.0.0.1 AGENT_PORT=7780 bun run gateway` in
`server/gateway` (loopback only, auth off — private by design). `GATEWAY_URL` in `bot.env`.

**A/B, same script, 120s each**

| arm | chops | ms/chop | chops/hr | xp gained | xp/hr | trees used |
|---|---|---|---|---|---|---|
| remote gateway | 7 | 8729 | 202.5 | 4375 (lvl 34->39) | 126,590 | 5 |
| local gateway | 15 | 7532 | 445.2 | 9375 (lvl 11->34) | 278,231 | 12 |

Also: **two remote-gateway runs failed outright** before that (17:41, 17:42) — the demo
gateway closed the lite client's socket (`Gateway closed, reconnecting in 3000ms`) and the
SDK handshake timed out 30s later. The local gateway passed on the first attempt.

**Honest reading:** chops/hour is the only comparable number across the two arms (xp per log
scales with level, so the xp/hr columns are not comparable). 2.2x on n=1 per arm is
suggestive, not established — needs alternating runs at a fixed level. What *is* established:
the remote gateway is unreliable from this host and the local one is not.

**Hiscore state:** Woodcutting 39, Overall 66, playtime 7m 47s. An idle probe session (~40s
logged in, no level-up) left the row unchanged — playtime only restamps on level change, so
that idle time will be charged to the next level-up. Do not leave the client up between probes.

**Next:** Phase 2 — fair A/B (alternating 3x at one level), then reduce ms/chop by camping a
single tile and re-chopping respawns instead of walking between trees (7.5s/chop is mostly
walking, not gateway latency).

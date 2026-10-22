#!/usr/bin/env bash
# Bounded batch job for an rs-sdk bot (plan v2 §1 / §5).
#
#   scripts/batch.sh <bot> <script.ts>
#
# Contract: the script MUST end with the in-game logout (2458). A batch that ends any
# other way (idle / disconnected / error) is a FAILED batch: the character keeps
# accruing playtime and the hiscores never flush.
#
# Pass condition (verified, not assumed):
#   - script exits 0
#   - runner log contains "Game session ended (logged-out)"
# Errors, in ascending severity: script rc != 0, runner exit != 1, no logged-out line.

set -uo pipefail

BOT=${1:?usage: batch.sh <bot> <script.ts>}
SCRIPT=${2:?usage: batch.sh <bot> <script.ts>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNS="$ROOT/runs"; mkdir -p "$RUNS"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RUNNER_LOG="$RUNS/$BOT-$STAMP-runner.log"
SCRIPT_LOG="$RUNS/$BOT-$STAMP-script.log"

fail() { echo "[batch] FAIL: $*" >&2; exit 1; }

# --- 1. start the headless client -------------------------------------------------
( cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT" ) >"$RUNNER_LOG" 2>&1 &
RUNNER_PID=$!

for _ in $(seq 1 120); do
    grep -q "Gateway connected, registering as" "$RUNNER_LOG" 2>/dev/null && break
    kill -0 "$RUNNER_PID" 2>/dev/null || { cat "$RUNNER_LOG"; fail "lite client died before registering"; }
    sleep 0.5
done
grep -q "Gateway connected, registering as" "$RUNNER_LOG" || { cat "$RUNNER_LOG"; fail "lite client never registered (60s)"; }
echo "[batch] client up (pid $RUNNER_PID), running $SCRIPT"

# --- 2. run the script (bounded) --------------------------------------------------
timeout 600 bun "$ROOT/bots/$BOT/$SCRIPT" >"$SCRIPT_LOG" 2>&1
SCRIPT_RC=$?
echo "[batch] script rc=$SCRIPT_RC (log: $SCRIPT_LOG)"

# --- 3. wait for the client to end, then classify --------------------------------
for _ in $(seq 1 60); do
    kill -0 "$RUNNER_PID" 2>/dev/null || break
    sleep 0.5
done
if kill -0 "$RUNNER_PID" 2>/dev/null; then
    # A failed script never reaches its logout step, which leaves the character logged in
    # and burning playtime (the hiscore tiebreak). Recover with the logout helper while the
    # client is still up, so a crashed batch costs nothing but the stack trace.
    if ! grep -q "Game session ended (logged-out)" "$RUNNER_LOG"; then
        echo "[batch] no logout yet; running the logout helper before stopping the client" >&2
        timeout 60 bun "$ROOT/bots/$BOT/logout.ts" >>"$SCRIPT_LOG" 2>&1 || true
        for _ in $(seq 1 20); do
            kill -0 "$RUNNER_PID" 2>/dev/null || break
            sleep 0.5
        done
    fi
fi
if kill -0 "$RUNNER_PID" 2>/dev/null; then
    echo "[batch] client did not exit after the script; sending SIGINT (it traps SIGINT, not SIGTERM)" >&2
    kill -INT "$RUNNER_PID" 2>/dev/null
    sleep 3
    kill -0 "$RUNNER_PID" 2>/dev/null && kill -9 "$RUNNER_PID" 2>/dev/null
    wait "$RUNNER_PID" 2>/dev/null; RUNNER_RC=$?
else
    wait "$RUNNER_PID"; RUNNER_RC=$?
fi

# --- 4. verdict -------------------------------------------------------------------
echo "[batch] runner rc=$RUNNER_RC (log: $RUNNER_LOG)"
if ! grep -q "Game session ended (logged-out)" "$RUNNER_LOG"; then
    tail -5 "$RUNNER_LOG" >&2
    fail "session did not end via logout — playtime is still accruing, hiscores unflushed"
fi
[ "$SCRIPT_RC" -eq 0 ] || fail "script failed (rc=$SCRIPT_RC); session was logged out cleanly"
# runner exits 1 on a clean logout: only reason 'stopped' exits 0 (runner.ts:445)
[ "$RUNNER_RC" -eq 1 ] || echo "[batch] WARN: expected runner rc=1 on logged-out, got $RUNNER_RC"

echo "[batch] PASS $BOT $SCRIPT"
echo "[batch] hiscores: https://rs-sdk-demo.fly.dev/hiscores/player/$BOT?profile=main"

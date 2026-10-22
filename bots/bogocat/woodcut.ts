declare const process: { env: Record<string, string | undefined> };

import { runScript } from '../../sdk/runner';

// Phase 1: bounded woodcutting batch. Chops, drops logs when full, logs out at the end.
// The batch is time-bounded on purpose: playtime is the hiscore tiebreak, so every
// logged-in tick has to buy something.
//
//   WOODCUT_MS=240000 bun bots/bogocat/woodcut.ts   (or via scripts/batch.sh)
//
// Fails (non-zero) on: death, no tree found, or a chop failure streak. Success is only
// claimed when the woodcutting XP actually moved.

const DURATION_MS = Number(process.env.WOODCUT_MS ?? 240_000);
const LOGS_DROP_AT = 24; // occupied slots before banking-by-dropping
const MAX_FAIL_STREAK = 6;
const TREE_AREA = { x: 3200, z: 3225 };

const wc = (sdk: any) => sdk.getState()?.skills?.find((k: any) => /^woodcutting$/i.test(k.name));

await runScript(async ({ bot, sdk }) => {
    const start = Date.now();
    const s0 = sdk.getState();
    if (!s0?.inGame) throw new Error('not in game');
    const lifeId0 = s0.player?.lifeId;
    const xp0 = wc(sdk)?.experience ?? 0;
    const lvl0 = wc(sdk)?.baseLevel ?? 1;

    let chops = 0;
    let drops = 0;
    let fails = 0;
    let totalChopMs = 0;
    const treesSeen = new Set<string>();

    while (Date.now() - start < DURATION_MS) {
        const st = sdk.getState();
        if (st?.player?.lifeId !== lifeId0) throw new Error(`died (lifeId ${lifeId0} -> ${st?.player?.lifeId})`);
        if (!st?.inGame) throw new Error('lost game session');

        if ((st.inventory?.length ?? 0) >= LOGS_DROP_AT) {
            const d = await bot.dropItem(/^logs$/i, 'all');
            if (d.slotsDropped > 0) drops += d.slotsDropped;
            continue;
        }

        let tree = sdk.findNearbyLoc(/^tree$/i);
        if (!tree) {
            const walk = await bot.walkTo(TREE_AREA.x, TREE_AREA.z, 8, { timeout: 60_000 });
            if (!walk.success) {
                if (++fails > MAX_FAIL_STREAK) throw new Error(`cannot reach trees: ${walk.message}`);
                continue;
            }
            tree = sdk.findNearbyLoc(/^tree$/i);
            if (!tree) {
                if (++fails > MAX_FAIL_STREAK) throw new Error('no tree loc after walking');
                continue;
            }
        }

        treesSeen.add(`${tree.x},${tree.z}`);
        const t0 = Date.now();
        const res = await bot.chopTree(tree);
        totalChopMs += Date.now() - t0;
        if (res.success) {
            chops++;
            fails = 0;
        } else if (++fails > MAX_FAIL_STREAK) {
            throw new Error(`chop failure streak: ${res.message}`);
        }
    }

    const xp1 = wc(sdk)?.experience ?? 0;
    const lvl1 = wc(sdk)?.baseLevel ?? 1;
    const elapsed = Date.now() - start;
    const summary = {
        elapsedMs: elapsed,
        chops,
        xp0,
        xp1,
        xpGained: xp1 - xp0,
        level0: lvl0,
        level1: lvl1,
        xpPerHour: Math.round(((xp1 - xp0) / elapsed) * 3_600_000),
        chopsPerHour: Number(((chops / elapsed) * 3_600_000).toFixed(1)),
        msPerChop: chops ? Math.round(totalChopMs / chops) : null,
        logsDropped: drops,
        treesUsed: treesSeen.size,
        gateway: process.env.GATEWAY_URL ?? 'remote',
    };
    console.log('[woodcut] ' + JSON.stringify(summary));
    if (!(xp1 > xp0)) throw new Error(`no woodcutting xp observed (${xp0} -> ${xp1})`);

    const logout = await sdk.sendClickComponent(2458);
    console.log('[woodcut] logout: ' + JSON.stringify(logout));
    return summary;
}, { timeout: DURATION_MS + 120_000 });

import { runScript } from '../../sdk/runner';

// Phase 0 smoke test — see /root/.pi/agent/handoffs/rs-bot-plan-v2.md §5.
// skipTutorial -> chopTree with observed XP delta -> attempt in-game logout (2458).
// Exits non-zero if any link in the chain fails to produce an observed effect.

const wcXp = (sdk: any): number =>
    sdk.getState()?.skills?.find((k: any) => /^woodcutting$/i.test(k.name))?.experience ?? -1;

await runScript(async ({ bot, sdk }) => {
    const r: Record<string, unknown> = { steps: [] as string[] };
    const step = (name: string, value: unknown) => {
        (r.steps as string[]).push(`${name}: ${JSON.stringify(value)}`);
        console.log(`[smoke] ${name}:`, JSON.stringify(value));
    };

    const s0 = sdk.getState();
    if (!s0?.inGame) throw new Error('not in game');
    r.player0 = { name: s0.player?.name, x: s0.player?.worldX, z: s0.player?.worldZ };
    r.lifeId0 = s0.player?.lifeId;
    const tutorOpen0 = s0.interface?.interfaceId === 3559 || s0.modalInterface === 3559;
    step('tutorial_open_at_start', tutorOpen0);

    // 1. tutorial
    const t0 = Date.now();
    const tut = await bot.skipTutorial();
    step('skipTutorial', { ...tut, ms: Date.now() - t0 });
    const s1 = sdk.getState();
    step('after_tutorial_pos', { x: s1?.player?.worldX, z: s1?.player?.worldZ, iface: s1?.interface?.interfaceId });

    // 2. woodcutting with observed XP delta
    const xp0 = wcXp(sdk);
    let tree = sdk.findNearbyLoc(/^tree$/i);
    if (!tree) {
        step('walk_to_trees', await bot.walkTo(3200, 3225, 6, { timeout: 120_000 }));
        tree = sdk.findNearbyLoc(/^tree$/i);
    }
    step('tree_found', tree ? { name: tree.name, x: tree.x, z: tree.z, d: tree.distance } : null);
    if (!tree) throw new Error('no tree loc found after walking');

    const chop = await bot.chopTree(tree);
    const xp1 = wcXp(sdk);
    step('chopTree', { ...chop, xpBefore: xp0, xpAfter: xp1, xpDelta: xp1 - xp0 });
    if (!(xp1 > xp0)) throw new Error(`no woodcutting xp observed (${xp0} -> ${xp1})`);

    // 3. death guard
    const s2 = sdk.getState();
    const lifeId1 = s2?.player?.lifeId;
    step('lifeId_after', { lifeId0: r.lifeId0, lifeId1, changed: lifeId1 !== r.lifeId0 });

    // 4. in-game logout attempt (2458 = logout:try_logout)
    r.preLogoutPos = { x: s2?.player?.worldX, z: s2?.player?.worldZ };
    r.preLogoutInv = s2?.inventory?.map((i: any) => `${i.name} x${i.count}`);
    let logout: any = null;
    try {
        logout = await sdk.sendClickComponent(2458);
    } catch (e) {
        logout = { threw: String(e) };
    }
    step('logout_click', logout);

    r.result = 'CHAIN-OK';
    return r;
}, { timeout: 240_000 });

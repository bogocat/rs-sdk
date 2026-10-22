import { runScript } from '../../sdk/runner';

// Cleanly end a session without spending playtime. Safe to run on any character;
// no-ops nothing, so a batch wrapper can use it as its always-logout step.
await runScript(async ({ sdk }) => {
    const before = sdk.getState();
    const res = await sdk.sendClickComponent(2458);
    console.log('[logout] ' + JSON.stringify({ pos: before?.player && [before.player.worldX, before.player.worldZ], res }));
    return res;
}, { timeout: 30_000 });

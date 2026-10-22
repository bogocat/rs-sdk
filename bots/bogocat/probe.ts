import { runScript } from '../../sdk/runner';

// Phase 0 probe: dump ground truth about the freshly created bot.
// Read-only — no actions, no logout.
await runScript(async ({ sdk }) => {
    const s = sdk.getState();
    if (!s) throw new Error('no world state');
    const p = s.player;
    const out = {
        inGame: s.inGame,
        tick: s.tick,
        player: p ? {
            name: p.name,
            x: p.worldX,
            z: p.worldZ,
            plane: p.level,
            hp: p.hp,
            lifeId: p.lifeId,
            respawnCount: p.respawnCount,
            isDead: p.isDead,
        } : null,
        modalOpen: s.modalOpen,
        modalInterface: s.modalInterface,
        dialog: { isOpen: s.dialog.isOpen, text: s.dialog.text, options: s.dialog.options?.map(o => o.text) },
        skills: Object.fromEntries(s.skills.map(k => [k.name, { lvl: k.level, xp: k.experience }])),
        inventory: s.inventory.map(i => `${i.name} x${i.count}`),
        nearbyLocs: s.nearbyLocs.slice(0, 40).map(l => `${l.name}@${l.x},${l.z} d=${l.distance}`),
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
}, { timeout: 90_000 });

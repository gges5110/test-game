# Explore & Craft

A browser-based medieval-town RTS built with Three.js. Manage villagers, gather resources, build up a town, and fight a rival AI camp that grows its own economy and periodically raids you — no player avatar, pure top-down command.

**Play it live:** https://gges5110.github.io/test-game/

## Controls

- **WASD / arrow keys** — pan the camera (drag pans on touch)
- **Scroll / pinch** — zoom
- **Left-click** — select a villager, building, or resource node (nodes are view-only, showing how much is left)
- **Left-drag** — box-select multiple villagers
- **Double-click** a villager or soldier — select every unit of that same kind currently on screen
- **Right-click** (or tap, on mobile) — command selected villagers: move to a point, gather a resource node, or garrison inside a Town Center/Castle. Hovering previews the order with a badge cursor: a sword over an attackable enemy (soldiers selected), or the resource's own icon over a node (villagers selected)
- **Right-click ground** (with a Town Center/Barracks/Archery Range/Stable selected instead of units) — set its rally point; newly trained units head straight there
- **B** — with a villager selected, jump to Build ▸ Economic
- **M** — with a villager selected, jump to Build ▸ Military
- **Shift** (held while placing a building) — after confirming, stay in placement mode for another of the same building instead of closing the menu
- **Esc** — close menus, cancel a placement, or deselect

## Gameplay

- Villagers automatically seek nearby resource nodes (wood, stone, food, gold) when idle, or can be directly commanded. Right-clicking a resource node, or picking "Gather Wood/Stone/Food/Gold" from a selected villager's command grid, sticks that villager to the chosen resource type — it keeps hunting for more of the same when idle instead of drifting to whatever's nearest, until you move it or reassign it. Nothing produces resources on its own (AoE2-style) — every load is gathered and physically carried back by a villager.
- Resource nodes have real stock (AoE2-style), not a single instant harvest: a stone or gold node holds 200, wood 150, food 125, and a villager pulls 2 units/second from whatever they're standing at. A villager hauls up to 10 per trip, shuttles it to the nearest drop-off, then walks back to the same node for another load until it's fully exhausted. Gold is scarcer than the others (fewer, smaller clusters) — nothing costs it yet, but it gathers, stores, and shows in the inventory strip like everything else, ready for whenever it gets a use.
- A load has to be dropped off at a Town Center (any resource, including gold), or the matching specialized building: a Lumber Camp for wood, a Mining Camp for stone, a Mill for food. Villagers automatically walk to whichever qualifying building is nearest when they finish gathering, so placing camps near your resources cuts down on walking. Farms are a plantable food node villagers gather from just like a berry bush or tree — not a passive income source — so they still need a Mill or Town Center nearby to drop food off at.
- The Build ▸ Economic/Military menu places Houses (+5 population capacity), Farms, a Blacksmith, Barracks/Archery Range/Stable (train soldiers), Outposts and Castles (auto-attack nearby enemies, and Castles also train Soldiers), and more Town Centers (also +5 capacity, and trains Villagers).
- Soldiers, Archers, and Scouts counter each other in a rock-paper-scissors triangle — Soldier beats Archer, Archer beats Scout, Scout beats Soldier — dealing 1.5x damage against whichever they counter. Enemy guards count as Soldiers for this. Select a unit (or hover a Train button) to see what it beats and what it's weak to.
- Each unit has its own silhouette, not just a recolor: Soldiers carry a shield and wear a helmet crest, Archers are slimmer with a quiver on their back, Scouts are lean with a plume and a spear, Villagers wear a straw hat and carry a hoe, and enemy guards are stockier with horns and an axe.
- Villagers can garrison inside a Town Center or Castle (15-villager capacity each) — right-click it with villagers selected to send them in. Garrisoned villagers are hidden and safe from attack, and a garrisoned Town Center (which has no attack of its own otherwise) gains one, scaling with how many are sheltering inside. Select the building to see everyone currently inside as a row of clickable icons (click one to send just that villager back out), or use Ungarrison to send everyone back out at once. Selecting any building that can auto-attack (Outpost, Castle, or a garrisoned Town Center) shows a ring on the ground marking its attack range.
- Population is capped at 200 and gated by housing — Town Centers and Houses each add capacity, and training pauses once you're at the limit until more housing (or losses) free up room.
- A fixed enemy camp sits a distance away, starting with the same Town Center + 3 villagers as the player, and running the same economy loop: its own villagers draw from the same map-wide resource field the player does (an equal, symmetric share of wood/stone/food clusters, not a smaller separate patch) and build up its own houses/barracks/towers over time. Its build order reacts to circumstances — it rushes a Barracks over economy growth if it's lost every guard, and jumps a House to the front of the queue once its own population is actually capped. Every 60s it raids with a party sized to how many guards it actually has (up to half, capped at 6), aimed at your weakest standing building rather than always your Town Center. Attack the camp to slow its growth, or let it grow and come to you. Click an enemy guard or villager to inspect its stats (view-only — no commands, and never more than one at a time).
- The map has properly rolling hills, flattened only in a valley around each base. Every standing building (yours or the enemy camp's) is a real obstacle — villagers, soldiers, and guards steer around one instead of walking through it, the same as they'd steer around any other obstacle, whether it's their destination or just in the way.
- Progress autosaves to `localStorage` (and on tab close/hide), so reloading resumes your town. Use the reset button in the HUD to wipe the save and start over.
- You lose the moment you have no buildings, villagers, or soldiers left — AoE2's own defeat rule. A full-screen "Your Town Has Fallen" overlay appears with a one-click restart. You win by eliminating the enemy camp the same way — no buildings, villagers, or guards left on their side — which shows a dismissable "Enemy Camp Destroyed" overlay and lets you keep playing.

## Development

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # type-check and produce a production build
npm run preview  # preview the production build locally
```

Deployment is automatic: pushes to `main` trigger the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the site and publishes it to GitHub Pages.

## Tech stack

- [Three.js](https://threejs.org/) for 3D rendering
- [Vite](https://vitejs.dev/) + TypeScript, no framework or ECS
- Plain `localStorage` for save/load persistence

## Project structure

```
src/
  main.ts              # orchestration: scene setup, game loop, input wiring
  systems/              # camera, building, crafting, inventory, save/load
  world/                # terrain, resources, villagers, enemy camp, buildings
  ui/                    # HUD (inventory, menus, prompts)
```

### Visuals vs. gameplay

Mesh/material construction is kept in its own file, separate from the class
that owns the corresponding gameplay state — so tuning what something looks
like and tuning what it does never touch the same lines:

| Visuals (mesh factories only, no game state) | Gameplay (stats, state machines, combat) |
|---|---|
| `world/buildings.ts` | `systems/building.ts`, `systems/townBuildings.ts` |
| `world/unitVisuals.ts` | `world/soldier.ts`, `world/villager.ts`, `world/enemyCamp.ts` |
| `world/resourceVisuals.ts` | `world/resources.ts` |
| `world/effects.ts`, `world/healthBar.ts` | — (self-contained visual utilities) |

A visuals file only ever builds a `THREE.Object3D`/material from plain values
passed in — it never imports or touches game state. A gameplay file never
constructs `THREE.Geometry`/`Material` directly — it calls a factory from its
visuals counterpart. `main.ts` and `systems/*` are the shared integration
point both sides occasionally touch (e.g. wiring up a new unit type), but the
day-to-day churn of "change what a Scout looks like" vs. "change what a
Scout does" no longer lands in the same file.

## Testing

```bash
npm test          # run the unit tests once
npm run test:watch
```

Game rules with real bookkeeping — the production queue, construction
progress and repair costs — live in `src/systems/production.ts`, deliberately
free of rendering and global state so they can be tested directly
(`src/systems/production.test.ts`). These are the parts where a mistake is
invisible on screen until it has already cost the player resources, so they
get assertions rather than eyeballing.

### Inspecting a running game

A live state handle is exposed on `window.__game`, which is far more reliable
than reading the `localStorage` autosave (that lags behind by up to the
autosave interval):

```js
__game.summary()    // compact snapshot: resources, unit counts, every building
__game.buildings    // live PlacedBuilding objects
__game.selection    // what's currently selected
__game.enemyCamp    // the rival camp: its buildings, villagers, guards, resources, raid timer
```

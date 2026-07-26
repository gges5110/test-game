# Explore & Craft

A browser-based medieval-town RTS built with Three.js. Manage villagers, gather resources, build up a town, and fight a rival AI camp that grows its own economy and periodically raids you — no player avatar, pure top-down command.

**Play it live:** https://gges5110.github.io/test-game/

## Controls

- **WASD / arrow keys** — pan the camera (drag pans on touch)
- **Scroll / pinch** — zoom
- **Left-click** — select a villager or building
- **Left-drag** — box-select multiple villagers
- **Double-click** a villager or soldier — select every unit of that same kind currently on screen
- **Right-click** (or tap, on mobile) — command selected villagers: move to a point, or gather a resource node
- **Right-click ground** (with a Town Center/Barracks/Archery Range/Stable selected instead of units) — set its rally point; newly trained units head straight there
- **B** — with a villager selected, jump to Build ▸ Economic
- **M** — with a villager selected, jump to Build ▸ Military
- **Shift** (held while placing a building) — after confirming, stay in placement mode for another of the same building instead of closing the menu
- **Esc** — close menus, cancel a placement, or deselect

## Gameplay

- Villagers automatically seek nearby resource nodes (wood, stone, food) when idle, or can be directly commanded. Nothing produces resources on its own (AoE2-style) — every load is gathered and physically carried back by a villager.
- A load has to be dropped off at a Town Center, or the matching specialized building: a Lumber Camp for wood, a Mining Camp for stone, a Mill for food. Villagers automatically walk to whichever qualifying building is nearest when they finish gathering, so placing camps near your resources cuts down on walking. Farms are a plantable food node villagers gather from just like a berry bush or tree — not a passive income source — so they still need a Mill or Town Center nearby to drop food off at.
- The Build ▸ Economic/Military menu places Houses (+5 population capacity), Farms, a Blacksmith, Barracks/Archery Range/Stable (train soldiers), Outposts and Castles (auto-attack nearby enemies), and more Town Centers (also +5 capacity, and trains Villagers).
- Population is capped at 200 and gated by housing — Town Centers and Houses each add capacity, and training pauses once you're at the limit until more housing (or losses) free up room.
- A fixed enemy camp sits a distance away, starting with the same Town Center + 3 villagers as the player, and running the same economy loop: its own villagers gather from a small local resource patch and build up its own houses/barracks/towers over time. Its guards patrol the camp and periodically raid the player's town — attack the camp to slow its growth, or let it grow and come to you. Click an enemy guard or villager to inspect its stats (view-only — no commands, and never more than one at a time).
- Progress autosaves to `localStorage` (and on tab close/hide), so reloading resumes your town. Use the reset button in the HUD to wipe the save and start over.

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

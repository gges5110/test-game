# Explore & Craft

A browser-based medieval-town RTS with tower-defense combat, built with Three.js. Manage villagers, gather resources, build up a town, and defend it from waves of wolves — no player avatar, pure top-down command.

**Play it live:** https://gges5110.github.io/test-game/

## Controls

- **WASD / arrow keys** — pan the camera (drag pans on touch)
- **Scroll / pinch** — zoom
- **Left-click** — select a villager or building
- **Left-drag** — box-select multiple villagers
- **Right-click** (or tap, on mobile) — command selected villagers: move to a point, or gather a resource node
- **C** — open the Craft menu
- **B** — open the Build menu
- **Esc** — close menus, cancel a placement, or deselect

## Gameplay

- Villagers automatically seek nearby resource nodes (wood, stone, food) when idle, or can be directly commanded.
- The Build menu places Houses (more villagers), Farms (passive food), Storage (capacity), a Blacksmith, Towers (auto-attack wolves in range), Walls, and Campfires.
- The Craft menu offers one-time tool upgrades that boost gather yield.
- Wolves spawn in escalating waves and beeline for the nearest building — towers and walls are the only defense.
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
  world/                # terrain, resources, villagers, wolves, buildings
  ui/                    # HUD (inventory, menus, prompts)
```

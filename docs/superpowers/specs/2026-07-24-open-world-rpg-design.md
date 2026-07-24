# Open-World RPG v1 — "Explore & Craft" — Design

## Overview

A single-player, third-person, low-poly 3D RPG running entirely in the browser.
The player spawns on a procedurally generated island, walks around, gathers
resources, and crafts items. No combat, no NPCs, no saving yet — the goal of
v1 is to nail the core "explore and gather" feel before adding systems on top.

## Tech Stack

- **Three.js** for 3D rendering
- **Vite** for dev server + bundling (fast hot-reload while iterating)
- **Vanilla TypeScript** (no game framework/ECS) — plain classes/modules,
  structure kept minimal rather than imposed upfront
- **simplex-noise** npm package for procedural terrain generation
- No physics engine — raycast-down-to-terrain for grounding, simple
  sphere-distance checks for gathering/collision with objects

## World

- One bounded island (~400×400 units), heightmap terrain generated from
  layered simplex noise (rolling hills, a few peaks, a flat starting valley
  near spawn)
- Biome variation via noise-driven vertex coloring over a single terrain mesh
  (grassy lowlands, rocky highlands) — no separate biome meshes for v1
- Resource nodes (trees, rocks, bushes) scattered procedurally using the same
  seed, avoiding steep slopes and water
- One fixed seed for v1 (no seed-reroll UI needed yet) — the goal is proving
  out the loop, not world variety

## Player & Controls

- Low-poly humanoid character built from simple primitives (capsule body, box
  limbs) — enough to prove movement/animation feel before investing in a real
  model
- WASD to move, mouse-drag / right-click-drag to orbit the third-person
  follow camera, space to jump (visual arc only, no real physics)
- Character always snapped to terrain height via downward raycast

## Gathering & Crafting

- Walking near a resource node shows a prompt (e.g. "Press E to chop");
  holding depletes the node (which respawns after a timer) and adds the
  resource to inventory
- 3 resource types to start: Wood, Stone, Fiber
- Inventory is a plain counter object (no grid/drag-drop UI needed yet — just
  counts shown in a HUD panel)
- Crafting menu (press C) lists 2-3 recipes (e.g. Torch, Basic Tool,
  Campfire) that consume resources and produce a craftable item/placeable

## Day/Night Cycle

- Directional light angle animates on a timer to simulate sun movement,
  ambient color shifts warm→cool — gives the world a sense of life without
  additional systems

## Project Structure

```
test-game/
  index.html
  package.json
  vite.config.ts
  src/
    main.ts              # entry point, game loop, scene setup
    world/
      terrain.ts          # heightmap generation + mesh
      resources.ts         # resource node placement, gathering logic
    player/
      controller.ts        # movement, camera follow, input handling
      model.ts              # placeholder character mesh
    systems/
      inventory.ts           # inventory state
      crafting.ts             # recipes + crafting logic
      daynight.ts               # light/sky animation
    ui/
      hud.ts                     # inventory display, prompts, crafting menu (DOM overlay)
  docs/superpowers/specs/         # design docs
```

- UI (HUD, crafting menu, prompts) is built as DOM overlays on top of the
  canvas, not in-3D — faster to build/style, standard approach for browser
  games
- Game loop uses `requestAnimationFrame` with delta-time based updates passed
  to each system

## Testing / Verification

No automated test suite for v1 — correctness here means "does it feel right
when played." Verification happens by running the Vite dev server and
driving it in-browser after each milestone:

1. Terrain renders + camera orbits
2. Character walks around and stays grounded
3. Resource nodes appear and can be gathered
4. Crafting menu produces items
5. Day/night cycle visibly works

## Out of Scope for v1

- Combat, enemies
- NPCs, quests
- Saving/loading (localStorage persistence)
- Physics engine
- Infinite/chunked world streaming
- Seed reroll UI

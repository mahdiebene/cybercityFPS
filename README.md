# Cybercity: Neon Sector FPS

A browser-based first-person shooter prototype built with Three.js and Vite. The game drops the player into a dense night-time city grid with switchable weapons, scoped aiming, reactive enemies, destructible map objects, and a tactical squad director for enemy behavior.

## Features

- Three.js first-person movement with collision handling, sprinting, crouching, jumping, and smooth camera/weapon motion.
- Dense city map using external city-kit assets, street lighting, visible boundaries, roads, sidewalks, props, gates, barrels, relays, and cover objects.
- Six weapon classes: Pistol, Rifle, Shotgun, SMG, Marksman, and Railgun.
- Aim-down-sights support, scoped weapons, recoil tuning, muzzle flashes, shell ejection, hit markers, impact effects, and reload states.
- Enemy characters built from imported character assets and detailed rig parts, with separate head/body/limb hit detection.
- Tactical enemy AI with navigation grid pathfinding, cover selection, squad roles, shared squad memory, flanking, suppressing, charging, defending, regrouping, and search behavior.
- HUD with health, armor, wave, score, weapon slots, ammo, reload meter, crosshair, scope overlay, damage vignette, and notices.
- External audio and procedural layers for weapon shots, reloads, enemy hits, impacts, ambience, and combat feedback.
- PBR materials from ambientCG for asphalt, concrete, and metal surfaces.

## Controls

| Input | Action |
| --- | --- |
| `W`, `A`, `S`, `D` | Move |
| Mouse | Look / aim |
| Left mouse | Fire |
| Right mouse | Aim down sights / scope |
| `1` - `6` | Switch weapons |
| `R` | Reload |
| `Shift` | Sprint |
| `Ctrl` | Crouch |
| `Space` | Jump |
| `Esc` | Pause / resume |

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Vite will print the local URL, usually:

```text
http://127.0.0.1:5173/
```

Build a production bundle:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

```text
.
├── index.html
├── src/
│   ├── main.js
│   └── style.css
├── public/
│   └── assets/
├── ASSETS.md
├── package.json
└── README.md
```

## Assets And Licenses

The project uses free external assets from Kenney, OpenGameArt, and ambientCG. See [ASSETS.md](ASSETS.md) for the full source and license list.

## Status

This is an active gameplay prototype focused on browser-playable FPS mechanics, tactical AI, and city combat presentation. It is ready to run locally, build with Vite, and continue iterating toward a more polished FPS experience.

# Ducky

**MIT covers the code only (src, scripts, config and tests).**

Ducky is a penguin and the captain of The Iceberg.
He comes from the Ducky picture-book series.

The game will let you belly-slide across the ice, throw snowballs, and walk into The Iceberg to explore her. Then you'll fly her to other planets as the story unfolds.

This game is being built in public. The current build is a web game for a computer or a tablet, published from `main` to `duckys.app`.

The code and Ducky assets are licensed differently. See [LICENSE](LICENSE) and [ASSETS-LICENSE.md](ASSETS-LICENSE.md). The Ducky assets are all rights reserved by Maxwell Industries LLC.

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). Forks must rename the game and replace the Ducky assets as described in [TRADEMARKS.md](TRADEMARKS.md).

## The current build

Ducky can belly-slide on the ice, slow to a stop on packed snow, aim and throw snowballs, open The Iceberg's airlock and walk aboard. The ship is the walkable Iceberg: three decks with the companion stair down to the sleeping rooms, the lower deck to the reactor, the gallery stair to the hold, and an elevator with three stops (main deck, reactor deck, hold). Up front, the use button at the cockpit vestibule places Ducky in the cockpit, where the lighting-backup console works; the export builds no stair to the raised cockpit yet. The inspector shows every room of the ship. Flight is planned, not implemented.

## Run locally

    npm ci
    npm run build
    npm run serve

Open `http://127.0.0.1:5317/`. The local server binds to localhost. The build in `dist/` is a static site, so any static host can serve it; `duckys.app` builds and serves it on Vercel as set in [vercel.json](vercel.json). All scripts, models and textures are served from the same origin. There is no CDN, paid service or login.

The build needs `assets/{set,ducky-ice,ducky-helmet}.glb`, `sky.jpg`, `collision.json`, `provenance.json` and the walkable Iceberg export in `assets/iceberg/` (its manifest, and the GLBs it names). All of them are committed under [ASSETS-LICENSE.md](ASSETS-LICENSE.md). An incomplete build fails with the missing names, and the build refuses any Iceberg file whose sha256 differs from the export manifest. Phones load the variants in `assets/phone/` instead (textures 512 px, sky 2048 px). After any change to the top level of `assets/`, rebuild them with `node scripts/make-phone-assets.mjs` (needs ffmpeg); the build refuses variants made from different assets. The Iceberg export carries its own phone LODs.

## Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrows, relative to the camera | Drag on the left half |
| Belly slide / get up | Space | Slide |
| Aim | Point at the ice, target or hull; the arc previews the throw | Drag on the right half to look and aim |
| Throw | Left click or F | Snowball |
| Look | Right drag or J/L/U/O | Drag on the right half |
| Open door, call the elevator, go up to or down from the cockpit, use the console | E near the object | Use |
| Elevator car buttons | 1 main deck, 2 reactor deck, 3 hold; E sends the car to the next stop | Use |
| Inspect | V, then choose a model | Inspect, then choose a model |
| Orbit / zoom in inspector | Drag or look keys; wheel or zoom buttons | Drag; zoom buttons |
| Return to Ducky | V or Escape | Return |

The airlock is on the ship's port flank, straight ahead of the spawn. Aboard, the view is Ducky's own, 1.3 m above whatever deck or stair he stands on. Forward along the main hall is the cockpit vestibule; the companion stair beside the hall arch goes down to the lower deck, the sleeping rooms and the avionics bay, then aft through the pellet room to the reactor. The elevator stands at the aft end of the main hall, and the gallery stair behind the workshop goes down into the hold. The two seats beside the pilot's chair stay empty.

`?demo=1` plays the 60 second walkthrough. `?capture=1` pauses automatic time so the browser tool can step frames. `?debug=1` displays coordinates and hit counts. `?dpr=1` uses one drawing-buffer pixel per viewport pixel. The original exterior collision-off control remains available at `?collision=off`.

## Asset pack and ownership

The asset pack contains the walkable Iceberg, ice plain, Ducky bare-headed and in his helmet, sky, collision grid and a SHA-256 provenance manifest. The walkable Iceberg (`assets/iceberg/`) is one game export of the ship built from the model of record: fourteen places (the exterior, twelve rooms and the elevator), each as a desktop LOD and phone LODs, a collision GLB per place plus the hull, a barrier reference and a manifest with the waypoints, routes, elevator and sha256 of every file. Blender 5.3.0 Alpha exported the models through the private production pipeline. Rebuilding those production assets is separate from building this game.

Aboard, the ship runs on Rapier physics (`@dimforge/rapier3d-compat`, Apache-2.0) built from the collision GLBs: a capsule 1.40 m tall on Rapier's character controller climbs the stairs, and the elevator's car and doors move by the export's own elevator spec. The physics modules (`src/colliders.js`, `src/character.js`, `src/elevator.js`) are ported from the harness that proved the export. The hull's collider answers snowball rays outside; aboard, snowballs meet the ship's colliders. Six procedural Blender materials reach glTF as plain white; the game gives each the colour its name states until the export bakes them. No new model or texture was downloaded; see [THIRD-PARTY.md](THIRD-PARTY.md).

The code is MIT licensed under [LICENSE](LICENSE). The Ducky assets are copyright 2026 Maxwell Industries LLC, all rights reserved under [ASSETS-LICENSE.md](ASSETS-LICENSE.md). The third-party notices do not grant rights to the project assets. This repository excludes production masters, manuscripts and private source paths.

## Verify

    npm test
    npm run licences
    node scripts/milestone-browser.mjs --jobs=verify,controls,metrics,capture --out=review-output
    node scripts/iceberg-browser.mjs --jobs=routes,stills,perf --out=review-output
    node scripts/phone-browser.mjs --out=review-output

The browser tool launches local Chrome, records page requests, drives the production simulation and uses real keyboard, mouse and touch events for the control tests. Any failed acceptance check or off-origin page request fails the run. It writes JSON evidence, stills and a 60 second 1920 by 1080 MP4. Capture uses fixed simulation steps and 30 fps encoding; the separate metrics job measures wall-clock animation frames for a full minute.

`scripts/iceberg-browser.mjs` is the walkable Iceberg's acceptance on the desktop profile: from the ice it opens the airlock with E and walks aboard, then walks every route of the export in the game with the same stick and use input a player gives (the stairs, the sleeping rooms, the reactor, every elevator stop both ways, the gallery stair to the hold), goes up to the cockpit and switches the console, throws a snowball aboard, rides the car by key and walks back out onto the ice. Any console error, page exception, failed or off-origin request fails it. `--jobs=stills` takes a still per room; `--jobs=perf` measures time to ready, the frame rate over the demo walk and renderer memory, and `--dist=DIR` runs it on any build for a comparison. `npm test` walks the same routes headless, with negative controls: without the stair ramp, without the car floor, or with a landing door stuck shut, the route must fail.

`scripts/phone-browser.mjs` checks phones: the start-problem card when WebGL2 is unavailable, recovery after a lost WebGL context, the landscape Return button, rendering on Pixel, iPad mini and desktop profiles, and GPU memory proxies for the phone quality profile.

The browser tool accepts `--egl-vendor=FILE` to select an installed GPU driver on a computer with multiple GPUs. The measured RTX 5070 Ti result is 59.93 fps over a full minute at 1920 by 1080. The tool records the actual renderer. That result does not claim performance for an integrated GPU or an untested phone. Browser profiles and captured frames are temporary; set TMPDIR to a local writable directory for verification.

`scripts/browser.mjs` and `scripts/drive.mjs` retain the original walk-test checks. Milestone tests add surface friction, ballistics/cooldown, door traversal, furniture/wall collision and inspection. The original walk-test dist is the negative browser control. The baseline has the old slide but fails the rough-snow, snowball and M2 checks.

## Model replacement and current scope

Every room of the ship is an inspectable model slot named `iceberg:<room>` (for example `iceberg:main-hall`, `iceberg:cockpit`), with `ship` for the exterior and `airlock:outer-door` for the game's animated outer door. The inspector lists them with their bounds, and its cutaway takes the deckhead off a room. `window.__dk.replaceModel(slotId, localGlbUrl)` replaces a slot's visual while preserving its transform; `window.__dk.modelIds()` lists the IDs. The export is never edited: shaders cut the hull opening in front of the airlock and the export's closed outer-door slab only in the game view.

Collision aboard is the export's own collision GLBs; the ice plain keeps its walk grid. Aboard, a room is drawn with the rooms within two portals of it and the hull, which is the rooms' outer skin.

Open, and waiting on decisions: the export builds no stair to the raised cockpit (the hull fairing over the vestibule leaves no headroom), so the use button places Ducky in it and back, as the export's own cockpit route does; boarding Catapult 1 on foot is unresolved, so her cabin is not reachable. The accepted ice-wall placement is still a walk-test arrangement. Campaign story beats, final materials and final room dressing need the author team's later review. This delivery does not edit any book or change the series canon.

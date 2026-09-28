# Ducky

**MIT covers the code only (src, scripts, config and tests).**

Ducky is a penguin and the captain of The Iceberg.
He comes from the Ducky picture-book series.

The game will let you belly-slide across the ice, throw snowballs, and walk into The Iceberg to explore her. Then you'll fly her to other planets as the story unfolds.

This game is being built in public. The current build is a web game for a computer or a tablet, published from `main` to `duckys.app`.

The code and Ducky assets are licensed differently. See [LICENSE](LICENSE) and [ASSETS-LICENSE.md](ASSETS-LICENSE.md). The Ducky assets are all rights reserved by Maxwell Industries LLC.

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). Forks must rename the game and replace the Ducky assets as described in [TRADEMARKS.md](TRADEMARKS.md).

## The current build

Ducky can belly-slide on the ice, slow to a stop on packed snow, aim and throw snowballs, open The Iceberg's airlock, walk her main deck to the forward cockpit, switch the lighting-backup console, and inspect models. This is the first playable build. Flight is planned, not implemented.

## Run locally

    npm ci
    npm run build
    npm run serve

Open `http://127.0.0.1:5317/`. The local server binds to localhost. The build in `dist/` is a static site, so any static host can serve it; `duckys.app` builds and serves it on Vercel as set in [vercel.json](vercel.json). All scripts, models and textures are served from the same origin. There is no CDN, paid service or login.

The build needs `assets/{ship,set,ducky-ice,ducky-helmet}.glb`, `sky.jpg`, `collision.json` and `provenance.json`. All of them are committed in `assets/` under [ASSETS-LICENSE.md](ASSETS-LICENSE.md). An incomplete build fails with the missing names.

## Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrows, relative to the camera | Drag on the left half |
| Belly slide / get up | Space | Slide |
| Aim | Point at the ice, target or hull; the arc previews the throw | Drag on the right half to look and aim |
| Throw | Left click or F | Snowball |
| Look | Right drag or J/L/U/O | Drag on the right half |
| Open door / use console | E near the object | Use |
| Inspect | V, then choose a model | Inspect, then choose a model |
| Orbit / zoom in inspector | Drag or look keys; wheel or zoom buttons | Drag; zoom buttons |
| Return to Ducky | V or Escape | Return |

The airlock is on the ship's port flank, straight ahead of the spawn. Inside, follow the main-deck floor lights forward, toward ship stations +12 to +20. Approach the side of the console to operate it. The two seats beside the pilot's chair stay empty. The yellow, blue and pink buttons are visual blockouts; the lighting-backup interaction is implemented.

`?demo=1` plays the 60 second walkthrough. `?capture=1` pauses automatic time so the browser tool can step frames. `?debug=1` displays coordinates and hit counts. `?dpr=1` uses one drawing-buffer pixel per viewport pixel. The original exterior collision-off control remains available at `?collision=off`.

## Asset pack and ownership

The asset pack contains the solid-ring ship, ice plain, Ducky bare-headed and in his helmet, sky, collision grid and a SHA-256 provenance manifest. Blender 5.3.0 Alpha exported the models through the private production pipeline. Rebuilding those production assets is separate from building this game. The game needs only these local exports and its npm dependency.

The runtime merges ship materials for drawing and indexes the original triangles for accurate hull ray tests. Procedural Blender materials remain flattened by glTF. No new model or texture was downloaded; see [THIRD-PARTY.md](THIRD-PARTY.md).

The code is MIT licensed under [LICENSE](LICENSE). The Ducky assets are copyright 2026 Maxwell Industries LLC, all rights reserved under [ASSETS-LICENSE.md](ASSETS-LICENSE.md). The third-party notices do not grant rights to the project assets. This repository excludes production masters, manuscripts and private source paths.

## Verify

    npm test
    npm run licences
    node scripts/milestone-browser.mjs --jobs=verify,controls,metrics,capture --out=review-output
    node scripts/phone-browser.mjs --out=review-output

The browser tool launches local Chrome, records page requests, drives the production simulation and uses real keyboard, mouse and touch events for the control tests. Any failed acceptance check or off-origin page request fails the run. It writes JSON evidence, stills and a 60 second 1920 by 1080 MP4. Capture uses fixed simulation steps and 30 fps encoding; the separate metrics job measures wall-clock animation frames for a full minute.

`scripts/phone-browser.mjs` checks phones: the start-problem card when WebGL2 is unavailable, recovery after a lost WebGL context, the landscape Return button, rendering on Pixel, iPad mini and desktop profiles, and GPU memory proxies for the phone quality profile.

The browser tool accepts `--egl-vendor=FILE` to select an installed GPU driver on a computer with multiple GPUs. The measured RTX 5070 Ti result is 59.93 fps over a full minute at 1920 by 1080. The tool records the actual renderer. That result does not claim performance for an integrated GPU or an untested phone. Browser profiles and captured frames are temporary; set TMPDIR to a local writable directory for verification.

`scripts/browser.mjs` and `scripts/drive.mjs` retain the original walk-test checks. Milestone tests add surface friction, ballistics/cooldown, door traversal, furniture/wall collision and inspection. The original walk-test dist is the negative browser control. The baseline has the old slide but fails the rough-snow, snowball and M2 checks.

## Model replacement and current scope

Every game-only interior piece has a `blockout:` asset-slot name in `src/world.js`. The inspector lists those names and model bounds. `window.__dk.replaceModel(slotId, localGlbUrl)` replaces a slot's visual while preserving its transform. Use the slot's local coordinate frame; `window.__dk.modelIds()` lists the IDs. The source Blender ship remains intact; a shader cuts the prototype's airlock opening only in the game view.

The deck plan is in `src/layout.js`, including the walls and furniture shared with collision. The exterior shell and ice wall are hidden for first-person indoor exploration. The interior is deliberately a blockout: aft hold and lower deck remain future work. The model inspector isolates the selected object and can hide interior walls and ceilings.

The accepted ice-wall placement is still a walk-test arrangement. Campaign story beats, final materials and final room dressing need the author team's later review. This delivery does not edit any book or change the series canon.

The inspector also includes `ship:cockpit-of-record`, extracted from the ship GLB's named cockpit, console and seat meshes without moving them. This is the detailed existing Blender cockpit, not the blockout. Its sole measures z=2.17 to 2.26 m, with the main-deck vestibule below; integrating those stairs into walking is still unfinished. The blockout keeps the required forward location and a continuous flat route for this milestone. Both versions can be viewed in the game to guide model work.

The replacement hook supports visual evaluation. Collision remains the current layout and walk grid. Production replacements for animated doors or responding screens will need their named interaction anchors bound to those behaviours when the asset lane integrates them.

# Ducky v2, round 7: the game's two Ducky exports

Safe to publish: this note names no private path, file or person. The private record of the
export stays out of the public repository.

These two files replace the round 3 exports in `assets/`. `assets/provenance.json` carries the same
sha256 for each.

| file | sha256 | bytes | triangles |
|---|---|---|---|
| ducky-helmet.glb | fa43b7cedc36a0b0b0bb737348ab25ae21d9163aaff066eb66304c2d380c90d5 | 7,695,036 | 392,460 |
| ducky-ice.glb | ecda1a44444529840c193037f722dc6c74d336476a05b83f8d181599eac87e77 | 2,675,208 | 71,828 |

- **Source IDs:** unchanged, `ducky-v2/helmet` and `ducky-v2/ice`.
- **Generator:** Blender 5.3.0 Alpha, through the private Blender export pipeline, on the CPU. Both files record `Khronos glTF Blender I/O v5.3.19` in `asset.generator`. The round 3 exports they replace recorded v5.3.32.
- **Determinism:** a second export gave the same bytes for both files.
- **What changed from the exports in the game now:** they were Ducky v2 round 3. These are round 7.
  - The approved round 4 helmet, with its liner and two lamp pods.
  - The lower flippers, the re-seated cashmere scarf and the soft-arc brows.
  - The round 5 finish: chrome roughness 0.20, and the knit colour, normal and sheen.
  - The helmet-on face paint, in the helmet export only.
- **Game contract:** both files keep the game's contract.
  - The same 30 deform joints, in the same order as the ice export in the game now, so `DEF-thigh.L`, `DEF-thigh.R`, `DEF-upper_arm.L` and `DEF-upper_arm.R` are there.
  - The root `ducky_rig` turned to face +x, with the same rotation.
  - No animations, lights or cameras.
  - `ducky_v2_helmet*` nodes only in the helmet export.
  - `ducky_v2_visor_glass` at alphaMode BLEND.
  - A `ducky_v2_scarf` node in both files.
- **The face swap:** the helmet export's body colour map is the helmet-on face. The ice export's is the bare face. The game already swaps the two exports on its surface switch, so it needs no texture swap of its own.
- **Visor glass:** a Principled at roughness 0.30 and IOR 1.20, at alpha 0.063 (the round 3 export's 0.14, times the 0.45 reflection scale of round 5's less shiny glass).
- **Lamp pods:** they export as emissive (strength 6). The two helmet spot lights do not export, as before.
- **Privacy scan:** every string in each file's JSON chunk and the raw bytes of each file were scanned for private names and paths. There were 0 hits in both files. A planted copy with a private path in one node name and one image name was caught on both strings, and removed.

# Brush provenance

Jiebi's new brush adapts Catmull–Rom interpolation and stable pressure variation from a user-supplied line-animation toolkit (`engine.py`, original SHA-256 `2c473bfcb0a229518941e1d3ccab648b767bcb9a6048a2918232bec06286f75e`). The project owner requested this adaptation. No film assets, scene code, private paths or original toolkit package are distributed here.

- `extension/ink.mjs` and `ink.py` convert Catmull–Rom segments to cubic Bézier curves. Jiebi adds corner detection, closure and bounds checks. `auto`, `flow` and `corner` describe how a line passes through points; they are not object templates.
- Pressure is fixed at frame zero. The original seed-50 noise values are retained as a small static table; seven arc-length reference samples are checked to numerical tolerance. Canvas and Cairo use different sampling and antialiasing, so this is not a pixel-identical reproduction.
- New paths have `brush: didan-v1`; old stored paths keep their existing geometry. A reveal clips the same path by arc length and does not alter the saved object. It ends immediately on interaction. No continuous jitter or shape morphing is added.
- `check_ink.py` checks frontend/backend geometry, preserved corners and closure, collision rules, selection bounds, pressure references and immutable reveal/retraction.

SketchAgent's MIT license and attribution remain in the repository. Jiebi's adaptation is released as part of this project under MIT; this does not relicense the separate original film toolkit. Detailed private provenance remains with the project owner.

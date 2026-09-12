# Squad Rush — an original cartoon 3D army runner

A complete, playable mobile-first army runner built with [three.js](https://threejs.org/)
and plain ES modules. Swipe between three lanes, pick your gates, grow the squad,
fight through waves and bosses — the run never resets until you die.

**Play it:** open `game/index.html` from a local server (see *Running* below), or
visit the GitHub Pages URL for this repository under `/game/`.

```
┌──────────────────────────────────────────────────────────────┐
│  ⬅  swipe / arrow keys  ➡                                    │
│                                                              │
│   LANE 0          LANE 1          LANE 2                     │
│   ┌─────┐         ┌─────┐         ┌─────┐                    │
│   │ ×3  │         │ +25 │         │ ÷2  │   ← gate row       │
│   └─────┘         └─────┘         └─────┘                    │
│        ▓▓▓▓          ▓▓▓▓▓▓▓         ▓▓▓      ← enemy waves   │
│              🎖️🎖️🎖️🎖️🎖️                       ← your squad    │
└──────────────────────────────────────────────────────────────┘
```

## What it does

* **Three lanes, one squad.** Swipe (or press ←/→) and the *whole* squad slides
  across; you never control an individual soldier.
* **Real gate maths.** `+25`, `−5`, `×3`, `÷2` do exactly what they say.
  Division floors (25 ÷ 2 = 12), subtraction never goes below zero, and the
  squad is always a whole number.
* **Automatic combat.** Soldiers fire on their own at the lane they are standing
  in. Every enemy that reaches the squad removes **exactly one** soldier.
* **Weapon upgrades** for fire rate ⚡, damage 💥, range 🎯, multi-shot 🔫 and
  area damage 💣 — with the weapon silhouette evolving from pistol to advanced
  rifle as a purely cosmetic reflection of the stats.
* **Bosses**: giant commander, tank, horde and a warlord-with-escort combo.
* **Stages that never reset the run.** Clear a stage and your squad, weapon and
  upgrades carry straight into the next one. Only death ends a run.
* **Guaranteed-solvable levels.** Every stage is generated *backwards* from its
  boss and then proven beatable by a simulator before you ever see it.
* **Continues, gems, lifetime Soldier Points and cosmetic skins**, all persisted.

## Running

Any static file server works — ES modules will not load from `file://`.

```bash
cd game
npm run serve          # http://127.0.0.1:8080/game/index.html
# or
python3 -m http.server 8080     # from the repository root
```

Append `?debug=1` to the URL for the developer overlay (see *Debug tools*).

## Tests

```bash
cd game
npm test               # the whole suite, including a 10,000-level stress test
npm run test:stress    # just the stress test, with a full report
STRESS_LEVELS=500 npm test    # a quicker pass while iterating
```

The suite covers the arithmetic, the combat rules, the economy, save/load,
level generation and — most importantly — **parity between the live game and
the simulator** (see below).

### Mobile check

Layout and touch need a real browser, so they live in a separate harness that
runs against a served build:

```bash
npm run serve                       # in one terminal
node tools/mobile-check.mjs         # in another (needs Playwright available)
```

It drives iPhone, Pixel and iPad profiles with genuine touch events and fails
if the HUD leaves the screen, a swipe does not move the squad, WebGL is
missing, or the page scrolls under the finger. It is not part of `npm test`
because the game itself has no dependencies and the suite should stay that way.

Worth knowing: `body { overflow: hidden }` means a HUD element can sit *off*
the screen without ever showing up in `scrollWidth`, so this harness measures
element rectangles against the viewport instead.

## Architecture

Everything under `src/core/` is pure logic with no browser or three.js
dependency, which is what makes the rules testable in Node and reusable by both
the game and the level simulator.

```
src/core/                     rules, maths, generation  (no rendering)
  Config.js                   every tunable number in the game
  GateMath.js                 +  −  ×  ÷  and their exact inverses
  WeaponStats.js              weapon levels -> factors -> visual tier
  CombatModel.js              THE combat truth: dps, engagements, bosses
  LaneEngagement.js           the same combat, stepped frame by frame
  DifficultyManager.js        difficulty curve + post-95% enemy-speed rules
  LevelGenerator.js           backward generation + reject/regenerate loop
  LevelSimulator.js           plays every meaningful path through a stage
  LevelValidator.js           structural proof-reading of a candidate stage
  RunState.js                 the current run (squad, weapon, stage)
  Profile.js                  permanent progression + save system
  Economy.js                  gems, continue pricing, continue restoration
  SkinCatalog.js              cosmetic skins (no gameplay fields at all)
  Rng.js                      seedable PRNG so any level is reproducible

src/systems/                  presentation and orchestration (three.js)
  GameManager.js              game loop + state machine, wires it all together
  LaneController.js           lane index and smoothed lateral position
  InputManager.js             swipe, drag and keyboard
  SquadManager.js             the squad, drawn as one InstancedMesh
  FormationManager.js         where each soldier stands
  EnemyManager.js             enemy waves, pooling, instanced rendering
  WeaponSystem.js             automatic fire + its visual feedback
  GateManager.js              gate frames, labels and crossing
  BossManager.js              boss encounters
  LevelManager.js             streams a generated stage into the world
  CameraController.js         elevated third-person chase camera
  EnvironmentManager.js       recycled ground tiles, scenery and themes
  VFXManager.js               pooled tracers, sparks and bursts
  AudioManager.js             synthesised placeholder audio
  UIManager.js                HUD, menus, death screen, shops
  DebugOverlay.js             developer tools (dev builds only)

src/art/                      procedural cartoon meshes
  GeometryKit.js              primitive helpers + geometry merging
  CharacterFactory.js         soldiers, enemies and bosses
```

## Guaranteed solvability

This is the part the whole design hangs off: **a generated stage is never
shipped to the player until it has been proven beatable.**

1. `DifficultyManager` fixes the stage's difficulty (70% at stage 1, +3 points
   per stage, capped at 95%) and the enemy speed.
2. `LevelGenerator` designs a *golden path*: a lane choice and gate value per
   section, projected forward so it knows what the squad can actually be at
   every point.
3. Each fight is sized by the soldiers it should cost a squad at full strength,
   solved for by bisection against the real combat model.
4. The boss is sized the same way, from the power available when the player
   reaches it.
5. **Backward propagation**: starting at the boss, the generator works out the
   smallest squad that still leaves a viable route, inverting each gate and
   each wave in turn until it reaches the stage entrance.
6. `LevelValidator` proof-reads the candidate: gate maths, whole-number squads,
   difficulty, enemy-speed rules, wave overlap, stage duration, boss sanity.
7. `LevelSimulator` then plays **every** lane path through the stage. If not one
   of them survives, the candidate is rejected and a new one is generated.

A rejected candidate also tunes the next attempt (too hard → gentler, no threat
at all → sharper), so generation converges instead of spinning. If everything
else somehow fails, a deliberately gentle fallback stage is built — and it is
validated too.

`npm run test:stress` generates 10,000 stages across the full stage range and a
wide spread of entry states, and audits every accepted one.

## Simulation and gameplay cannot drift apart

A simulator that promises a beatable level is worthless if the real game plays
by different rules, so there is only ever **one** implementation of the combat
maths:

* `CombatModel.resolveLaneStream` resolves a whole enemy stream analytically —
  fast enough to validate thousands of stages.
* `LaneEngagement` steps that identical model frame by frame for the live game:
  same damage pool, same front-to-back targeting, same carry-over of surplus
  damage, same one-soldier-per-contact rule.
* `tests/parity.test.mjs` proves the two agree, and
  `tests/integration-parity.test.mjs` replays whole generated stages through the
  live rules and requires them to clear everything the simulator certified.

The simulator additionally applies a conservative efficiency factor, so it can
only ever *under*-promise.

Where the live game has to *stage* a fight the model prices — spawning a boss
escort, for instance — the spawn plan lives in `CombatModel` next to the
function that resolves it (`escortLaneSpawns`), so the two cannot quietly drift
apart. The boss also holds back until the road is clear: the squad's firepower
is a single pool, and letting a boss and a wave draw on it in the same frame
would spend it twice.

## Debug tools

Development builds (localhost, or any URL with `?debug=1`) get an overlay on
`F2` showing current squad, combat power, required power, difficulty, enemy
speed, stage progress, winning-path counts and the last gate calculation —
plus buttons to add or remove soldiers, skip a stage, spawn a wave, grant gems
and weapon upgrades, regenerate the level, show lane numbers and log every
winning path. It is unreachable in a production build.

## Balancing

Every number lives in `src/core/Config.js` — lane width, squad speed, formation
spacing, weapon base stats and upgrade increments, combat coefficients, enemy
stats, boss archetypes, the difficulty curve, generation rules, economy and
camera. Nothing gameplay-related is hard-coded anywhere else, and the tests
read from the same file, so a balance change is a one-file change.

## Credits

Original work. Art, code, level generation and audio are all generated
procedurally in this repository; the only third-party dependency is three.js
(MIT), vendored in `vendor/`.

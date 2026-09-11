/**
 * CharacterFactory.js -- builds the cartoon characters.
 *
 * Everything is deliberately chunky and low-poly: exaggerated helmets, big
 * heads, short limbs.  Silhouettes are what matter at mobile distance, so the
 * player's soldiers stand tall and green-ish with a bright helmet crest while
 * enemies are hunched, red-black and horned -- readable apart at a glance even
 * when 300 of them fill the screen.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries, box, ball, cylinder, cone } from './GeometryKit.js';

/**
 * One soldier, merged into a single geometry.
 * @param {object} colors { uniform, gear, skin, accent } from the active skin
 * @param {number} weaponTier 0..3 -- pistol, SMG, rifle, advanced rifle
 */
export function buildSoldierGeometry (colors, weaponTier = 0) {
  const { uniform, gear, skin, accent } = colors;
  const parts = [
    // legs
    box(0.17, 0.34, 0.17, gear, [-0.11, 0.17, 0]),
    box(0.17, 0.34, 0.17, gear, [0.11, 0.17, 0]),
    // boots
    box(0.19, 0.1, 0.26, 0x2a2a2a, [-0.11, 0.05, 0.03]),
    box(0.19, 0.1, 0.26, 0x2a2a2a, [0.11, 0.05, 0.03]),
    // torso + webbing
    box(0.42, 0.42, 0.26, uniform, [0, 0.6, 0]),
    box(0.44, 0.1, 0.28, gear, [0, 0.52, 0]),
    box(0.12, 0.16, 0.1, accent, [0.16, 0.66, -0.13]),
    // arms
    box(0.12, 0.32, 0.13, uniform, [-0.27, 0.6, 0.02]),
    box(0.12, 0.32, 0.13, uniform, [0.27, 0.6, 0.02]),
    // head + helmet
    ball(0.17, skin, [0, 0.94, 0]),
    ball(0.2, gear, [0, 0.99, 0], 7),
    box(0.42, 0.05, 0.24, gear, [0, 0.94, 0.02]),
    box(0.06, 0.14, 0.06, accent, [0, 1.14, 0])
  ];

  // Weapon silhouette grows with the visual tier (cosmetic only -- combat
  // behaviour comes from WeaponStats).
  const weaponLength = [0.3, 0.42, 0.56, 0.66][Math.min(3, weaponTier)];
  const weaponColor = [0x3a3a3a, 0x33383d, 0x2c3238, 0x2b4a5a][Math.min(3, weaponTier)];
  parts.push(box(0.09, 0.1, weaponLength, weaponColor, [0.26, 0.62, 0.22 + weaponLength * 0.25]));
  parts.push(box(0.07, 0.14, 0.08, weaponColor, [0.26, 0.54, 0.2]));
  if (weaponTier >= 2) parts.push(box(0.05, 0.05, 0.16, 0x8a8f95, [0.26, 0.7, 0.3]));
  if (weaponTier >= 3) parts.push(box(0.14, 0.05, 0.14, 0x3df0ff, [0.26, 0.72, 0.24]));

  return mergeGeometries(parts);
}

/** One enemy grunt: hunched, horned, unmistakably not one of ours. */
export function buildEnemyGeometry (palette = {}) {
  const body = palette.body !== undefined ? palette.body : 0xb03636;
  const gear = palette.gear !== undefined ? palette.gear : 0x2b1c1c;
  const skin = palette.skin !== undefined ? palette.skin : 0xc98b6a;
  const accent = palette.accent !== undefined ? palette.accent : 0xffcf3d;

  return mergeGeometries([
    box(0.16, 0.3, 0.16, gear, [-0.11, 0.15, 0]),
    box(0.16, 0.3, 0.16, gear, [0.11, 0.15, 0]),
    box(0.44, 0.38, 0.3, body, [0, 0.52, 0.04]),      // hunched forward
    box(0.46, 0.09, 0.32, gear, [0, 0.46, 0.04]),
    box(0.13, 0.3, 0.13, body, [-0.29, 0.52, 0.1]),
    box(0.13, 0.3, 0.13, body, [0.29, 0.52, 0.1]),
    ball(0.16, skin, [0, 0.83, 0.06]),
    ball(0.19, gear, [0, 0.87, 0.05], 7),
    cone(0.07, 0.18, accent, [-0.16, 1.0, 0.05]),      // horns
    cone(0.07, 0.18, accent, [0.16, 1.0, 0.05]),
    box(0.3, 0.06, 0.06, 0x8d8d8d, [0.3, 0.46, 0.2])   // melee bar
  ]);
}

/** Boss bodies. Not instanced -- there is only ever one on screen. */
export function buildBoss (type) {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  if (type === 'TANK') {
    const geometry = mergeGeometries([
      box(2.6, 0.8, 4.0, 0x55603f, [0, 0.7, 0]),
      box(2.9, 0.5, 4.2, 0x3d452e, [0, 0.35, 0]),
      box(1.6, 0.7, 1.8, 0x67734a, [0, 1.4, -0.2]),
      box(0.26, 0.26, 2.6, 0x2f3524, [0, 1.45, 1.6]),
      cylinder(0.45, 0.45, 0.35, 0x22261a, [-1.35, 0.45, 1.3], [0, 0, Math.PI / 2]),
      cylinder(0.45, 0.45, 0.35, 0x22261a, [1.35, 0.45, 1.3], [0, 0, Math.PI / 2]),
      cylinder(0.45, 0.45, 0.35, 0x22261a, [-1.35, 0.45, -1.3], [0, 0, Math.PI / 2]),
      cylinder(0.45, 0.45, 0.35, 0x22261a, [1.35, 0.45, -1.3], [0, 0, Math.PI / 2]),
      box(0.5, 0.2, 0.5, 0xffcf3d, [0, 1.85, -0.2])
    ]);
    group.add(new THREE.Mesh(geometry, material));
    group.userData.kind = 'tank';
    return group;
  }

  // GIANT / HORDE / COMBO share an oversized grunt body with different accents.
  const accent = type === 'COMBO' ? 0x9b59b6 : (type === 'HORDE' ? 0xe67e22 : 0xffcf3d);
  const bodyColor = type === 'COMBO' ? 0x7b2d8e : 0x8e2b2b;
  const geometry = mergeGeometries([
    box(0.5, 0.9, 0.5, 0x2b1c1c, [-0.42, 0.45, 0]),
    box(0.5, 0.9, 0.5, 0x2b1c1c, [0.42, 0.45, 0]),
    box(1.7, 1.3, 1.0, bodyColor, [0, 1.55, 0.05]),
    box(1.8, 0.3, 1.1, 0x2b1c1c, [0, 1.35, 0.05]),
    box(0.44, 1.0, 0.44, bodyColor, [-1.05, 1.6, 0.1]),
    box(0.44, 1.0, 0.44, bodyColor, [1.05, 1.6, 0.1]),
    ball(0.52, 0xc98b6a, [0, 2.55, 0.05], 10),
    ball(0.6, 0x2b1c1c, [0, 2.66, 0.02], 10),
    cone(0.22, 0.6, accent, [-0.5, 3.1, 0.02]),
    cone(0.22, 0.6, accent, [0.5, 3.1, 0.02]),
    box(1.1, 0.22, 0.22, 0x9aa0a6, [1.2, 1.3, 0.5]),
    box(0.5, 0.5, 0.3, accent, [0, 1.75, 0.55])
  ]);
  group.add(new THREE.Mesh(geometry, material));
  group.userData.kind = 'giant';
  return group;
}

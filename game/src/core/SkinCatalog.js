/**
 * SkinCatalog.js -- cosmetic-only soldier skins (spec 31).
 *
 * Skins change colours and a couple of silhouette accents.  They must never
 * touch WeaponStats or squad maths; the catalogue therefore carries no
 * gameplay fields at all.
 */
const CATALOG = [
  {
    id: 'recruit',
    name: 'Recruit',
    cost: 0,
    colors: { uniform: 0x6aab4e, gear: 0x39592f, skin: 0xe2b089, accent: 0xffd24a }
  },
  {
    id: 'desert',
    name: 'Desert Soldier',
    cost: 1500,
    colors: { uniform: 0xd9b877, gear: 0x8a6f3c, skin: 0xe0a97a, accent: 0xf4e2a1 }
  },
  {
    id: 'arctic',
    name: 'Arctic Soldier',
    cost: 4000,
    colors: { uniform: 0xe8f1f7, gear: 0x9fb6c4, skin: 0xf0c8a6, accent: 0x6fd3ff }
  },
  {
    id: 'tactical',
    name: 'Tactical Soldier',
    cost: 9000,
    colors: { uniform: 0x36414d, gear: 0x1d242c, skin: 0xd9a077, accent: 0xff7a3d }
  },
  {
    id: 'heavy',
    name: 'Heavy Soldier',
    cost: 18000,
    colors: { uniform: 0x6b6f52, gear: 0x3c4033, skin: 0xdba379, accent: 0xc0392b }
  },
  {
    id: 'futuristic',
    name: 'Futuristic Soldier',
    cost: 32000,
    colors: { uniform: 0x2b3a67, gear: 0x16204a, skin: 0xe6b98f, accent: 0x3df0ff }
  },
  {
    id: 'commando',
    name: 'Cartoon Commando',
    cost: 55000,
    colors: { uniform: 0x7a3fa8, gear: 0x46216b, skin: 0xe8b48c, accent: 0xffe14d }
  },

  /* ------------------------------------------------------------------------
   * The long tail: twenty prestige skins on a roughly geometric price ladder
   * from 10,000 to 1,000,000 lifetime Soldier Points. Each step is about 30%
   * dearer than the last so every unlock stays a stretch rather than the
   * ladder flattening out, and the palettes are spread around the colour
   * wheel so two skins never read as the same soldier at mobile distance.
   * ---------------------------------------------------------------------- */
  {
    id: 'jungle_ranger',
    name: 'Jungle Ranger',
    cost: 10000,
    colors: { uniform: 0x2f5d3a, gear: 0x1b2f1c, skin: 0xc98f63, accent: 0xa8e05f }
  },
  {
    id: 'urban_scout',
    name: 'Urban Scout',
    cost: 13000,
    colors: { uniform: 0x6b7a8c, gear: 0x2f3742, skin: 0xefc39a, accent: 0xff8c42 }
  },
  {
    id: 'night_operator',
    name: 'Night Operator',
    cost: 17000,
    colors: { uniform: 0x30382a, gear: 0x1b2015, skin: 0xd9a77c, accent: 0x36e0d0 }
  },
  {
    id: 'savanna_tracker',
    name: 'Savanna Tracker',
    cost: 22000,
    colors: { uniform: 0xc08b3e, gear: 0x6b4a22, skin: 0x8a5a34, accent: 0xf5e3b3 }
  },
  {
    id: 'coral_diver',
    name: 'Coral Diver',
    cost: 29000,
    colors: { uniform: 0x1f8a8a, gear: 0x14465a, skin: 0xf0c9a4, accent: 0xff6f61 }
  },
  {
    id: 'volcanic_sapper',
    name: 'Volcanic Sapper',
    cost: 38000,
    colors: { uniform: 0x5c3028, gear: 0x2e1512, skin: 0x7a4a2c, accent: 0xff5722 }
  },
  {
    id: 'copper_vanguard',
    name: 'Copper Vanguard',
    cost: 50000,
    colors: { uniform: 0xb56a3a, gear: 0x7a4222, skin: 0xe0a878, accent: 0x3fd0c9 }
  },
  {
    id: 'emerald_guard',
    name: 'Emerald Guard',
    cost: 65000,
    colors: { uniform: 0x1f9e6b, gear: 0x11543c, skin: 0xcf9a6a, accent: 0xffd24a }
  },
  {
    id: 'crimson_lancer',
    name: 'Crimson Lancer',
    cost: 85000,
    colors: { uniform: 0xb22b3a, gear: 0x5e1420, skin: 0xf2c6a0, accent: 0xdfe6ec }
  },
  {
    id: 'steel_sentinel',
    name: 'Steel Sentinel',
    cost: 110000,
    colors: { uniform: 0xafbcc9, gear: 0x5d6a77, skin: 0xd8a47a, accent: 0x4aa3ff }
  },
  {
    id: 'midnight_raider',
    name: 'Midnight Raider',
    cost: 145000,
    colors: { uniform: 0x2b4fd8, gear: 0x14265e, skin: 0x8d5a38, accent: 0x8b6bff }
  },
  {
    id: 'solar_marine',
    name: 'Solar Marine',
    cost: 190000,
    colors: { uniform: 0xf2a03d, gear: 0x7c4a1e, skin: 0xf5d0aa, accent: 0xfff3d0 }
  },
  {
    id: 'amethyst_knight',
    name: 'Amethyst Knight',
    cost: 245000,
    colors: { uniform: 0x9b30ff, gear: 0x4a1080, skin: 0xd6a077, accent: 0xff8fd0 }
  },
  {
    id: 'frost_lancer',
    name: 'Frost Lancer',
    cost: 315000,
    colors: { uniform: 0x6fb4d8, gear: 0x3b5a73, skin: 0xf3d2b6, accent: 0xeaf8ff }
  },
  {
    id: 'obsidian_ghost',
    name: 'Obsidian Ghost',
    cost: 405000,
    colors: { uniform: 0x14141a, gear: 0x050507, skin: 0x6f4326, accent: 0x9dff8f }
  },
  {
    id: 'rose_marshal',
    name: 'Rose Marshal',
    cost: 520000,
    colors: { uniform: 0xd4557a, gear: 0x6e2038, skin: 0xf0c4a2, accent: 0xf7c948 }
  },
  {
    id: 'titanium_colossus',
    name: 'Titanium Colossus',
    cost: 660000,
    colors: { uniform: 0x8f9c7e, gear: 0x414a33, skin: 0xcf9a6a, accent: 0xff7a1a }
  },
  {
    id: 'aurora_sentinel',
    name: 'Aurora Sentinel',
    cost: 780000,
    colors: { uniform: 0x2fbfa0, gear: 0x17324a, skin: 0xecc39c, accent: 0xff4fd8 }
  },
  {
    id: 'golden_marshal',
    name: 'Golden Marshal',
    cost: 900000,
    colors: { uniform: 0xffd700, gear: 0x8a6a00, skin: 0xd9a06a, accent: 0xfff8e1 }
  },
  {
    id: 'prism_paladin',
    name: 'Prism Paladin',
    cost: 1000000,
    colors: { uniform: 0xb388ff, gear: 0x3a2a6b, skin: 0xf0cba6, accent: 0x00ffd5 }
  }
];

/**
 * Always ordered cheapest first, so the shop lists a ladder the player can
 * read at a glance. Sorting here rather than by hand keeps the source
 * grouped by theme without the UI inheriting that order.
 */
export const SKINS = Object.freeze(
  [...CATALOG].sort((a, b) => a.cost - b.cost).map(Object.freeze)
);

export function getSkin (id) {
  return SKINS.find((skin) => skin.id === id) || SKINS[0];
}

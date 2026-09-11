/**
 * SkinCatalog.js -- cosmetic-only soldier skins (spec 31).
 *
 * Skins change colours and a couple of silhouette accents.  They must never
 * touch WeaponStats or squad maths; the catalogue therefore carries no
 * gameplay fields at all.
 */
export const SKINS = Object.freeze([
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
  }
]);

export function getSkin (id) {
  return SKINS.find((skin) => skin.id === id) || SKINS[0];
}

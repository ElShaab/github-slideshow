/**
 * EnvironmentManager.js -- the world the squad runs through (spec 38).
 *
 * Ground is a small ring of recycled tiles; scenery is instanced and recycled
 * the same way, so running for an hour costs the same as running for a minute.
 * Themes change with the stage and cross-fade rather than cutting, which keeps
 * the "one continuous run" feeling intact.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';

/**
 * Merges geometries that share position/normal/uv (no vertex colours).
 * Used to fold a tile's lane dashes and kerbs into single draw calls.
 */
function mergePlain (geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    const count = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array, vertexOffset * 3);
    normal.set(geometry.attributes.normal.array, vertexOffset * 3);
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) {
        index[indexOffset + i] = geometry.index.array[i] + vertexOffset;
      }
      indexOffset += geometry.index.count;
    } else {
      for (let i = 0; i < count; i++) index[indexOffset + i] = vertexOffset + i;
      indexOffset += count;
    }
    vertexOffset += count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

export const THEMES = [
  { id: 'training', name: 'Training Ground', ground: 0x6f9e54, road: 0x8d8f7a, prop: 0x4e7a3a, sky: 0x8fd3ff, accent: 0xd8c37a },
  { id: 'desert', name: 'Desert Battlefield', ground: 0xd9bc7a, road: 0xc3a463, prop: 0xa9803f, sky: 0xffd9a0, accent: 0xe9e2c4 },
  { id: 'forest', name: 'Deep Forest', ground: 0x3f7a3f, road: 0x6d7358, prop: 0x255c2a, sky: 0xa8e6c0, accent: 0x86b84a },
  { id: 'city', name: 'City Ruins', ground: 0x8a8f96, road: 0x646a71, prop: 0x9aa4ad, sky: 0xb9d6ea, accent: 0xd1603d },
  { id: 'snow', name: 'Snow Front', ground: 0xe8f1f7, road: 0xc9d6e0, prop: 0xa9c0d2, sky: 0xdff0ff, accent: 0x7fc4ff },
  { id: 'industrial', name: 'Industrial Base', ground: 0x7c7468, road: 0x5c5952, prop: 0x8c6b4a, sky: 0xc9c2b6, accent: 0xf0a92b }
];

const TILE_LENGTH = 40;
const TILE_COUNT = 9;
const PROP_CAPACITY = 90;

export class EnvironmentManager {
  constructor (scene, config = CONFIG) {
    this.scene = scene;
    this.config = config;
    this.themeIndex = 0;
    this.theme = THEMES[0];
    this.group = new THREE.Group();
    scene.add(this.group);

    const width = config.render.corridorWidth;

    this.groundMaterial = new THREE.MeshLambertMaterial({ color: this.theme.ground });
    this.roadMaterial = new THREE.MeshLambertMaterial({ color: this.theme.road });
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });

    this.tiles = [];
    // Each tile is four meshes, not twenty: the lane dashes and both kerbs are
    // merged into single geometries up front.  Ground tiles are the most
    // numerous objects in the scene, so this is where draw calls are won.
    const dashGeometries = [];
    for (const offset of [-config.lanes.width / 2, config.lanes.width / 2]) {
      for (let d = 0; d < 5; d++) {
        const dash = new THREE.PlaneGeometry(0.14, 3.4);
        dash.rotateX(-Math.PI / 2);
        dash.translate(offset, 0.01, -TILE_LENGTH / 2 + 4 + d * 8);
        dashGeometries.push(dash);
      }
    }
    const dashGeometry = mergePlain(dashGeometries);

    const kerbGeometries = [];
    for (const side of [-1, 1]) {
      const kerb = new THREE.BoxGeometry(0.5, 0.42, TILE_LENGTH);
      kerb.translate(side * (width / 2 + 0.25), 0.2, 0);
      kerbGeometries.push(kerb);
    }
    const kerbGeometry = mergePlain(kerbGeometries);

    for (let i = 0; i < TILE_COUNT; i++) {
      const tile = new THREE.Group();

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, TILE_LENGTH), this.groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      tile.add(ground);

      const road = new THREE.Mesh(new THREE.PlaneGeometry(width, TILE_LENGTH), this.roadMaterial);
      road.rotation.x = -Math.PI / 2;
      tile.add(road);

      // Lane dividers: the clearest possible read of "three lanes".
      tile.add(new THREE.Mesh(dashGeometry, this.lineMaterial));
      // Kerbs mark the edge of the playfield.
      tile.add(new THREE.Mesh(kerbGeometry, this.roadMaterial));

      tile.position.z = i * TILE_LENGTH;
      this.group.add(tile);
      this.tiles.push(tile);
    }

    // Instanced scenery either side of the road.
    this.propMaterial = new THREE.MeshLambertMaterial({ color: this.theme.prop });
    this.props = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.5, 4.2, 6), this.propMaterial, PROP_CAPACITY
    );
    this.props.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.props.frustumCulled = false;
    this.group.add(this.props);

    this.blockMaterial = new THREE.MeshLambertMaterial({ color: this.theme.accent });
    this.blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.2, 2.2, 2.2), this.blockMaterial, PROP_CAPACITY
    );
    this.blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blocks.frustumCulled = false;
    this.group.add(this.blocks);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._euler = new THREE.Euler();

    this.propSeed = 1;
    this.baseZ = 0;
  }

  /** Applies a theme; stages cycle through them as the run goes deeper. */
  setTheme (index, { instant = false } = {}) {
    const theme = THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
    if (theme === this.theme && !instant) return;
    this.themeIndex = index;
    this.theme = theme;
    this.targetColors = theme;
    if (instant) this._applyColors(1);
  }

  _applyColors (t) {
    this.groundMaterial.color.lerp(new THREE.Color(this.theme.ground), t);
    this.roadMaterial.color.lerp(new THREE.Color(this.theme.road), t);
    this.propMaterial.color.lerp(new THREE.Color(this.theme.prop), t);
    this.blockMaterial.color.lerp(new THREE.Color(this.theme.accent), t);
    if (this.scene.fog) this.scene.fog.color.lerp(new THREE.Color(this.theme.sky), t);
    if (this.scene.background) this.scene.background.lerp(new THREE.Color(this.theme.sky), t);
  }

  update (dt, squadZ) {
    // Recycle ground tiles around the squad.
    const first = Math.floor((squadZ - TILE_LENGTH * 2) / TILE_LENGTH);
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i].position.z = (first + i) * TILE_LENGTH;
    }

    // Scatter scenery deterministically from the tile index so it does not
    // pop or dance as tiles recycle.
    let index = 0;
    for (let i = 0; i < this.tiles.length && index < PROP_CAPACITY - 2; i++) {
      const tileZ = (first + i) * TILE_LENGTH;
      for (let s = 0; s < 5; s++) {
        const seed = Math.abs(Math.sin((first + i) * 12.9898 + s * 78.233) * 43758.5453);
        const side = s % 2 === 0 ? -1 : 1;
        const x = side * (this.config.render.corridorWidth / 2 + 3 + (seed % 1) * 22);
        const z = tileZ + (seed * 7 % TILE_LENGTH);
        const scale = 0.7 + (seed % 0.6);

        this._position.set(x, 2, z);
        this._euler.set(0, seed, 0);
        this._quaternion.setFromEuler(this._euler);
        this._scale.set(scale, scale, scale);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.props.setMatrixAt(index, this._matrix);

        this._position.set(x * 0.8, 1.1, z + 14);
        this._scale.set(scale * 0.8, scale * 0.8, scale * 0.8);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.blocks.setMatrixAt(index, this._matrix);
        index++;
      }
    }
    this.props.count = index;
    this.blocks.count = index;
    this.props.instanceMatrix.needsUpdate = true;
    this.blocks.instanceMatrix.needsUpdate = true;

    // Smooth theme cross-fade.
    this._applyColors(Math.min(1, dt * 1.2));
  }
}

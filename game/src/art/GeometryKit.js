/**
 * GeometryKit.js -- small mesh-building helpers for the cartoon art style.
 *
 * Characters are built by merging a handful of primitives into ONE geometry
 * with baked vertex colours, so an entire squad or enemy wave can be drawn
 * with a single InstancedMesh draw call.  That is the main reason hundreds of
 * characters stay cheap on a phone.
 */
import * as THREE from '../../vendor/three.module.min.js';

/**
 * Merges geometries that share the attributes position/normal/color.
 * (three's BufferGeometryUtils lives in the examples bundle, which we do not
 * ship, and we only need this narrow case.)
 */
export function mergeGeometries (geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    const count = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array, vertexOffset * 3);
    normal.set(geometry.attributes.normal.array, vertexOffset * 3);
    if (geometry.attributes.color) {
      color.set(geometry.attributes.color.array, vertexOffset * 3);
    } else {
      for (let i = 0; i < count * 3; i++) color[vertexOffset * 3 + i] = 1;
    }
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
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

/** Paints a geometry with a flat vertex colour. */
export function paint (geometry, hex) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color(hex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Box part placed by its centre. */
export function box (width, height, depth, hex, position = [0, 0, 0], rotation = null) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  paint(geometry, hex);
  if (rotation) geometry.rotateX(rotation[0]), geometry.rotateY(rotation[1]), geometry.rotateZ(rotation[2]);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

/** Low-poly sphere part (cartoon heads, domes). */
export function ball (radius, hex, position = [0, 0, 0], segments = 6) {
  const geometry = new THREE.SphereGeometry(radius, segments, Math.max(3, Math.round(segments / 2)));
  paint(geometry, hex);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

export function cylinder (radiusTop, radiusBottom, height, hex, position = [0, 0, 0], rotation = null, segments = 8) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  paint(geometry, hex);
  if (rotation) geometry.rotateX(rotation[0]), geometry.rotateY(rotation[1]), geometry.rotateZ(rotation[2]);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

export function cone (radius, height, hex, position = [0, 0, 0], segments = 7) {
  const geometry = new THREE.ConeGeometry(radius, height, segments);
  paint(geometry, hex);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

/** Bright, unlit-looking cartoon material that still takes simple lighting. */
export function toonMaterial (options = {}) {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    ...options
  });
}

/** Draws text onto a canvas texture -- used for gate labels and boss names. */
export function makeLabelTexture (text, {
  width = 256, height = 128, background = 'rgba(0,0,0,0)',
  color = '#ffffff', stroke = '#11202e', font = 'bold 92px system-ui, sans-serif'
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, width / 2, height / 2 + 4);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 2;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

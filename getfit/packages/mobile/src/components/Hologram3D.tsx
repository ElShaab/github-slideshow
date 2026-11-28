import React, { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import type { HologramData } from '@getfit/shared';
import { buildBody3D } from './hologram/mesh3dBody';
import type { MeshData } from './hologram/mesh';

export interface Hologram3DProps {
  data: HologramData;
  size: number;
  width: number;
  style?: StyleProp<ViewStyle>;
  rotate: boolean;
  /** Called if the GL context cannot be set up, so the flat figure can run. */
  onFailure: (error: unknown) => void;
}

/**
 * The hologram as a real scene: a perspective camera orbiting two meshes.
 *
 * The look comes from one idea — a hologram is bright where you see it edge-on
 * and dim where it faces you, because that is where the most glowing material
 * lies along your line of sight. That is the fresnel term below, and it does
 * more work than any other part of this file. Everything else is colour.
 *
 * Both meshes are additive and depth-write off, so the far side of the body
 * shows through the near side the way it does in the reference renders. The
 * fat shell wraps the muscle and is fainter, so the muscle reads through it.
 */

const VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-viewPosition.xyz);
    vHeight = position.y;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT = `
  precision highp float;

  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uOpacity;
  uniform float uRimPower;
  uniform float uStipple;
  uniform float uTop;

  varying vec3 vNormal;
  varying vec3 vView;
  varying float vHeight;

  // A cheap hash, used to scatter the surface speckle the reference renders
  // have. It is a function of position, so the speckle sits on the body and
  // turns with it instead of swimming across the screen.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    // Bright at the silhouette, dim face-on: the whole hologram effect.
    float rim = pow(1.0 - facing, uRimPower);

    vec3 colour = mix(uCore, uEdge, rim);

    float speckle = step(0.982, hash(floor(gl_FragCoord.xyz * 0.0) + vHeight * 8.0 + vNormal * 24.0));
    colour += speckle * uStipple;

    // The head reads brightest in both references, so brightness rises with
    // height rather than being uniform.
    float lift = smoothstep(uTop * 0.62, uTop, vHeight) * 0.35;

    float alpha = uOpacity * (0.24 + rim * 0.9 + lift);
    gl_FragColor = vec4(colour * (0.7 + rim + lift), alpha);
  }
`;

function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices as unknown as Uint32Array, 1));
  return geometry;
}

function hologramMaterial(options: {
  core: string;
  edge: string;
  opacity: number;
  rimPower: number;
  stipple: number;
  top: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uCore: { value: new THREE.Color(options.core) },
      uEdge: { value: new THREE.Color(options.edge) },
      uOpacity: { value: options.opacity },
      uRimPower: { value: options.rimPower },
      uStipple: { value: options.stipple },
      uTop: { value: options.top },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    // Additive and depth-tested would hide the far side of the body. Off, so
    // the figure reads as something light passes through.
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export const Hologram3D = memo(function Hologram3D({
  data,
  size,
  width,
  style,
  rotate,
  onFailure,
}: Hologram3DProps): React.ReactElement {
  const frame = useRef<number | null>(null);
  const spinning = useRef(rotate);
  spinning.current = rotate;

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      try {
        const body = buildBody3D(data);
        const [core, , bright, fat] = data.accentPalette;

        const renderer = new THREE.WebGLRenderer({
          context: gl as unknown as WebGLRenderingContext,
          antialias: true,
          alpha: true,
        });
        renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          32,
          gl.drawingBufferWidth / gl.drawingBufferHeight,
          1,
          4000,
        );
        // Framed so the whole figure fits with a little air, looking slightly
        // down at it the way both references are composed.
        camera.position.set(0, body.height * 0.52, body.height * 1.95);
        camera.lookAt(0, body.height * 0.48, 0);

        const pivot = new THREE.Group();
        scene.add(pivot);

        const muscle = new THREE.Mesh(
          toGeometry(body.muscle),
          hologramMaterial({
            core,
            edge: bright,
            opacity: 0.55,
            rimPower: 2.1,
            stipple: 0.5,
            top: body.height,
          }),
        );
        const shell = new THREE.Mesh(
          toGeometry(body.fat),
          hologramMaterial({
            core: fat ?? core,
            edge: fat ?? bright,
            // The shell is faint on a lean figure and stronger on a heavy one,
            // which is the same ramp the flat renderer uses.
            opacity: 0.14 + (data.adiposity ?? data.bodyFatNormalized) * 0.4,
            rimPower: 2.8,
            stipple: 0.2,
            top: body.height,
          }),
        );
        pivot.add(muscle, shell);

        const render = (): void => {
          if (spinning.current) pivot.rotation.y += 0.006;
          renderer.render(scene, camera);
          gl.endFrameEXP();
          frame.current = requestAnimationFrame(render);
        };
        render();
      } catch (error) {
        onFailure(error);
      }
    },
    [data, onFailure],
  );

  return (
    <View style={[{ width, height: size }, style]} pointerEvents="none">
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
    </View>
  );
});

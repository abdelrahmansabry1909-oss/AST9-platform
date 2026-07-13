import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { GLBSkeleton } from '../../src/neucore/skeleton/GLBSkeleton.js';
import { MovementSimulator } from '../../src/neucore/simulation/MovementSimulator.js';

async function loadSkeleton() {
  const bytes = await readFile(new URL('../../public/models/ecorche_humanoid.glb', import.meta.url));
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
  const skeleton = new GLBSkeleton(new THREE.Scene());
  skeleton._onLoaded(gltf);
  return skeleton;
}

test('real GLB gait pivots and foot contacts move without frame pops', async () => {
  const skeleton = await loadSkeleton();
  const bones = skeleton.getGaitBones();
  assert.ok(bones.L.contact, 'left foot-center node is required');
  assert.ok(bones.R.contact, 'right foot-center node is required');

  const callbacks = new Set();
  const frameSource = {
    addFrameCallback(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  const simulator = new MovementSimulator(skeleton, [], frameSource);
  simulator.start();

  const previous = { L: null, R: null, femurL: null, femurR: null };
  const maxDelta = { L: 0, R: 0, femurL: 0, femurR: 0 };
  const world = new THREE.Vector3();
  for (let frame = 0; frame < 360; frame += 1) {
    callbacks.forEach((callback) => callback(1 / 60));
    const probes = {
      L: bones.L.contact,
      R: bones.R.contact,
      femurL: bones.L.thigh,
      femurR: bones.R.thigh,
    };
    Object.entries(probes).forEach(([key, node]) => {
      const current = node.getWorldPosition(world).clone();
      if (previous[key]) maxDelta[key] = Math.max(maxDelta[key], current.distanceTo(previous[key]));
      previous[key] = current;
    });
  }

  assert.ok(maxDelta.L <= 0.04, `left foot frame delta ${(maxDelta.L * 1000).toFixed(1)} mm`);
  assert.ok(maxDelta.R <= 0.04, `right foot frame delta ${(maxDelta.R * 1000).toFixed(1)} mm`);
  assert.ok(maxDelta.femurL <= 0.015, `left hip pivot frame delta ${(maxDelta.femurL * 1000).toFixed(1)} mm`);
  assert.ok(maxDelta.femurR <= 0.015, `right hip pivot frame delta ${(maxDelta.femurR * 1000).toFixed(1)} mm`);
  simulator.stop();
  skeleton.destroy();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GAIT_PHASES } from '../../src/neucore/simulation/MuscleActivationDB.js';
import {
  GAIT_PHASE_STARTS,
  createPeriodicGaitCurve,
  getGaitPhaseSample,
  getPhasePosePosition,
  samplePeriodicGaitCurve,
} from '../../src/neucore/simulation/GaitTiming.js';
import {
  MovementSimulator,
  NORMATIVE_KINEMATICS,
  getAxialMotion,
  getRootTrajectory,
} from '../../src/neucore/simulation/MovementSimulator.js';

const CYCLE_SECONDS = 2;

test('physiological gait timing uses the documented stance/swing boundaries', () => {
  assert.deepEqual(GAIT_PHASE_STARTS, [0, 0.10, 0.30, 0.50, 0.60, 0.73, 0.87]);

  GAIT_PHASES.forEach((phaseName, index) => {
    const sample = getGaitPhaseSample(GAIT_PHASE_STARTS[index] + 1e-8);
    assert.equal(sample.name, phaseName);
    assert.equal(sample.index, index);
    assert.ok(getPhasePosePosition(phaseName) >= sample.start);
    assert.ok(getPhasePosePosition(phaseName) < sample.end);
  });
});

test('periodic gait curves pass through every clinical keyframe without overshoot', () => {
  Object.values(NORMATIVE_KINEMATICS).forEach((valuesByPhase) => {
    const curve = createPeriodicGaitCurve(valuesByPhase);

    GAIT_PHASES.forEach((phaseName, index) => {
      const actual = samplePeriodicGaitCurve(curve, GAIT_PHASE_STARTS[index]);
      assert.ok(Math.abs(actual - valuesByPhase[phaseName]) < 1e-9);

      const next = (index + 1) % GAIT_PHASES.length;
      const low = Math.min(curve.values[index], curve.values[next]);
      const high = Math.max(curve.values[index], curve.values[next]);
      const start = GAIT_PHASE_STARTS[index];
      const end = index === GAIT_PHASES.length - 1 ? 1 : GAIT_PHASE_STARTS[index + 1];

      for (let step = 0; step <= 40; step += 1) {
        const phase = start + ((end - start) * step / 40);
        const value = samplePeriodicGaitCurve(curve, phase % 1);
        assert.ok(value >= low - 1e-9 && value <= high + 1e-9);
      }
    });
  });
});

test('joint angular velocity stays continuous across every phase boundary', () => {
  const epsilon = 1e-5;

  Object.entries(NORMATIVE_KINEMATICS).forEach(([joint, valuesByPhase]) => {
    const curve = createPeriodicGaitCurve(valuesByPhase);

    GAIT_PHASE_STARTS.forEach((boundary) => {
      const center = samplePeriodicGaitCurve(curve, boundary);
      const before = samplePeriodicGaitCurve(curve, boundary - epsilon);
      const after = samplePeriodicGaitCurve(curve, boundary + epsilon);
      const velocityBefore = (center - before) / (epsilon * CYCLE_SECONDS);
      const velocityAfter = (after - center) / (epsilon * CYCLE_SECONDS);
      const jump = Math.abs(velocityAfter - velocityBefore);
      assert.ok(jump < 0.1, `${joint} velocity jump ${jump.toFixed(4)} deg/s at ${boundary}`);
    });
  });
});

test('60 fps motion stays below the measured acceleration-jump threshold', () => {
  const fps = 60;
  const frameCount = fps * CYCLE_SECONDS;

  Object.entries(NORMATIVE_KINEMATICS).forEach(([joint, valuesByPhase]) => {
    const curve = createPeriodicGaitCurve(valuesByPhase);
    const angles = Array.from(
      { length: frameCount + 2 },
      (_, frame) => samplePeriodicGaitCurve(curve, (frame / frameCount) % 1),
    );
    const velocities = angles.slice(1).map((angle, index) => (angle - angles[index]) * fps);
    const maxVelocityDelta = velocities.slice(1).reduce(
      (max, velocity, index) => Math.max(max, Math.abs(velocity - velocities[index])),
      0,
    );
    assert.ok(
      maxVelocityDelta <= 40,
      `${joint} frame-to-frame velocity delta ${maxVelocityDelta.toFixed(2)} deg/s`,
    );
  });
});

test('right-side sampling remains exactly half a cycle contralateral', () => {
  const curve = createPeriodicGaitCurve(NORMATIVE_KINEMATICS.hip_flexion);
  for (let frame = 0; frame < 240; frame += 1) {
    const phase = frame / 240;
    const right = samplePeriodicGaitCurve(curve, (phase + 0.5) % 1);
    const mirroredReference = samplePeriodicGaitCurve(curve, phase + 0.5);
    assert.ok(Math.abs(right - mirroredReference) < 1e-12);
  }
});

test('root and axial trajectories are periodic, centered, and clinically bounded', () => {
  const atStart = getRootTrajectory(0);
  const atEnd = getRootTrajectory(1);
  assert.deepEqual(atEnd, atStart);

  for (let frame = 0; frame <= 240; frame += 1) {
    const phase = frame / 240;
    const root = getRootTrajectory(phase);
    const axial = getAxialMotion(phase);
    assert.ok(Math.abs(root.x) <= 0.012 + 1e-12);
    assert.ok(root.y >= -1e-12 && root.y <= 0.012 + 1e-12);
    assert.equal(root.z, 0);
    assert.ok(Math.abs(axial.pelvisRotation) <= THREE.MathUtils.degToRad(4) + 1e-12);
    assert.ok(Math.abs(axial.trunkCounterRotation) <= THREE.MathUtils.degToRad(2.4) + 1e-12);
  }
});

function createFakeRig() {
  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  const trunk = new THREE.Group();
  root.add(pelvis, trunk);

  const makeSide = (x) => {
    const thigh = new THREE.Group();
    const shank = new THREE.Group();
    const foot = new THREE.Group();
    const contact = new THREE.Group();
    const arm = new THREE.Group();
    thigh.position.set(x, 0.85, 0);
    shank.position.set(0, -0.42, 0);
    foot.position.set(0, -0.40, 0);
    contact.position.set(0, -0.06, 0.10);
    pelvis.add(thigh);
    thigh.add(shank);
    shank.add(foot);
    foot.add(contact);
    root.add(arm);
    return { thigh, shank, foot, contact, arm };
  };

  const L = makeSide(-0.09);
  const R = makeSide(0.09);
  return {
    root,
    bones: { pelvis, trunk, L, R },
  };
}

test('MovementSimulator uses one canvas frame subscription and releases it on stop', () => {
  const { root, bones } = createFakeRig();
  const callbacks = new Set();
  const frameSource = {
    addFrameCallback(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  const skeleton = {
    _root: root,
    _idleFloat: true,
    getGaitBones: () => bones,
  };

  const simulator = new MovementSimulator(skeleton, [], frameSource);
  simulator.start();
  simulator.start();
  assert.equal(callbacks.size, 1);
  assert.equal(skeleton._idleFloat, false);

  for (let frame = 0; frame < 360; frame += 1) {
    callbacks.forEach((callback) => callback(1 / 60));
    assert.ok(Number.isFinite(root.position.x));
    assert.ok(Number.isFinite(root.position.y));
    assert.ok(Number.isFinite(root.position.z));
    assert.ok(Math.abs(root.position.z) <= 0.08 + 1e-9);
  }

  simulator.stop();
  assert.equal(callbacks.size, 0);
  assert.equal(skeleton._idleFloat, true);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});

test('MovementSimulator falls back to an owned RAF loop without a frame source', () => {
  const hadRequestAnimationFrame = Object.hasOwn(globalThis, 'requestAnimationFrame');
  const hadCancelAnimationFrame = Object.hasOwn(globalThis, 'cancelAnimationFrame');
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const pendingFrames = new Map();
  const cancelledFrames = [];
  let nextFrameId = 1;

  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    pendingFrames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelledFrames.push(id);
    pendingFrames.delete(id);
  };

  try {
    const { root, bones } = createFakeRig();
    const skeleton = {
      _root: root,
      _idleFloat: true,
      getGaitBones: () => bones,
    };
    const simulator = new MovementSimulator(skeleton, []);
    simulator._clock.getDelta = () => 1 / 60;

    simulator.start();
    const positionAfterStart = root.position.clone();

    for (let frame = 0; frame < 5; frame += 1) {
      assert.equal(pendingFrames.size, 1);
      const [[id, callback]] = pendingFrames;
      pendingFrames.delete(id);
      callback();
      assert.ok(Number.isFinite(root.position.x));
      assert.ok(Number.isFinite(root.position.y));
      assert.ok(Number.isFinite(root.position.z));
    }

    assert.notDeepEqual(root.position.toArray(), positionAfterStart.toArray());
    assert.equal(pendingFrames.size, 1);
    const [pendingId] = pendingFrames.keys();

    simulator.stop();

    assert.deepEqual(cancelledFrames, [pendingId]);
    assert.equal(pendingFrames.size, 0);
    assert.deepEqual(root.position.toArray(), [0, 0, 0]);
    assert.equal(skeleton._idleFloat, true);
  } finally {
    if (hadRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
    if (hadCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as ActualThree from '../dist/vendor/three.module.js';

// Exercise the production scene with actual Three geometry/math and a renderer
// boundary stub: a DOM/WebGL context cannot be supplied by a plain Node process.
const renderers = [];
let rendererMustFail = false;
class TrackedTarget extends EventTarget {
  trackedListeners = new Map();
  addEventListener(type, fn, opts) {
    const entry = this.trackedListeners.get(type) || new Set();
    entry.add(fn);
    this.trackedListeners.set(type, entry);
    super.addEventListener(type, fn, opts);
  }
  removeEventListener(type, fn, opts) {
    this.trackedListeners.get(type)?.delete(fn);
    super.removeEventListener(type, fn, opts);
  }
  get listenerCount() { return [...this.trackedListeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

class MockElement extends TrackedTarget {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.textContent = '';
    this.hidden = false;
    this.rect = { left: 0, top: 0, width: 640, height: 430 };
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classes.has(name) : !!force;
        if (on) this.classes.add(name); else this.classes.delete(name);
        return on;
      }
    };
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get isConnected() { return !!this.connectedRoot || !!this.parentElement?.isConnected; }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); }
  }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll(selector) {
    const nodes = [];
    for (const child of this.children) {
      if (selector === 'button' && child.tagName === 'BUTTON') nodes.push(child);
      nodes.push(...child.querySelectorAll(selector));
    }
    return nodes;
  }
  setPointerCapture() {}
}

class FakeRenderer {
  constructor() {
    if (rendererMustFail) throw new Error('Intentional WebGL2 unavailable');
    this.domElement = document.createElement('canvas');
    this.loop = null;
    this.renderCount = 0;
    this.disposed = 0;
    this.contextLosses = 0;
    this.renderLists = { disposed: 0, dispose() { this.disposed++; } };
    renderers.push(this);
  }
  setClearColor() {}
  setPixelRatio(value) { this.pixelRatio = value; }
  setSize(width, height) { this.size = { width, height }; }
  setAnimationLoop(callback) { this.loop = callback; }
  render(scene, camera) {
    this.renderCount++;
    this.scene = scene;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
  }
  tick(time) { if (this.loop) this.loop(time); }
  dispose() { this.disposed++; }
  forceContextLoss() { this.contextLosses++; }
}

globalThis.__sceneTHREE = { ...ActualThree, WebGLRenderer: FakeRenderer };
const source = await readFile(new URL('../dist/workbench-scene.js', import.meta.url), 'utf8');
assert(source.startsWith("import * as THREE from './vendor/three.module.js';"));
const testSource = source.replace("import * as THREE from './vendor/three.module.js';", 'const THREE = globalThis.__sceneTHREE;');
const { mountWorkbenchScene } = await import(`data:text/javascript;base64,${Buffer.from(testSource).toString('base64')}`);

function event(target, type, properties = {}) {
  const value = new Event(type, { cancelable: true });
  Object.assign(value, properties);
  target.dispatchEvent(value);
  return value;
}

function find(root, className) {
  if (root.classList.contains(className)) return root;
  for (const child of root.children) { const found = find(child, className); if (found) return found; }
  return null;
}

function installDOM({ reducedMotion = false } = {}) {
  const body = new MockElement('body');
  body.connectedRoot = true;
  const documentTarget = new TrackedTarget();
  documentTarget.body = body;
  documentTarget.hidden = false;
  documentTarget.createElement = tag => new MockElement(tag);
  const media = new TrackedTarget();
  media.matches = reducedMotion;
  const windowTarget = new TrackedTarget();
  windowTarget.devicePixelRatio = 3;
  windowTarget.matchMedia = () => media;
  const resizers = [];
  const intersections = [];
  class ResizeObserverMock {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger(width, height) {
      this.target.rect = { ...this.target.rect, width, height };
      this.callback([{ target: this.target }]);
    }
  }
  class IntersectionObserverMock {
    constructor(callback) { this.callback = callback; this.disconnected = false; intersections.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger(isIntersecting) { this.callback([{ isIntersecting }]); }
  }
  globalThis.window = windowTarget;
  globalThis.document = documentTarget;
  globalThis.ResizeObserver = ResizeObserverMock;
  globalThis.IntersectionObserver = IntersectionObserverMock;
  const container = new MockElement('div');
  body.append(container);
  return { document: documentTarget, window: windowTarget, media, container, resizers, intersections };
}

const sample = {
  basis: 'grams', stage: 'structure', progress: 0,
  rows: [{ id: 'a', name: '桂枝', grams: 6, ratio: 1, natureGroup: 'warm', processingLabel: '原典未詳炮製' },
    { id: 'b', name: '芍藥', grams: null, ratio: 1, natureGroup: 'cool', processingLabel: '生品' }],
  processSteps: [{ id: 'cut', label: '切製', kind: 'cut' }, { id: 'combine', label: '合方', kind: 'combine' }]
};

// Pause/play/seek, source replacement, selections and complete cleanup.
rendererMustFail = false;
const env = installDOM();
const selected = [];
const progresses = [];
const playingChanges = [];
const scene = mountWorkbenchScene(env.container, { snapshot: sample,
  onSelect: id => selected.push(id), onProgress: value => progresses.push(value),
  onPlayingChange: value => playingChanges.push(value), durationMs: 5000 });
const renderer = renderers.at(-1);
const root = env.container.children[0];
assert.equal(root.dataset.renderer, `three-${ActualThree.REVISION}`);
assert.equal(renderer.pixelRatio, 1.5, 'Device-pixel rendering budget is capped.');
assert.equal(renderer.loop, null, 'Mount does not start continuous animation.');
assert.match(find(root, 'wb-scene-size-note').textContent, /尚未齊/);

const list = find(root, 'wb-scene-accessible-list');
event(list.children[0], 'click');
assert.deepEqual(selected, ['a']);
assert.equal(list.children[0].getAttribute('aria-pressed'), 'true');
scene.setPlaying(true);
assert.equal(root.dataset.playing, 'true');
assert.equal(typeof renderer.loop, 'function');
renderer.tick(0);
renderer.tick(100);
assert(progresses.at(-1) > 0);
scene.setPlaying(false);
assert.equal(renderer.loop, null, 'Pause removes the continuous render loop.');
const pausedFrames = renderer.renderCount;
renderer.tick(200);
assert.equal(renderer.renderCount, pausedFrames, 'Paused time cannot render another frame.');
scene.seek(.75);
assert.equal(progresses.at(-1), .75);
assert.match(find(root, 'wb-scene-center').children[1].textContent, /75%/);

scene.setPlaying(true);
env.document.hidden = true;
event(env.document, 'visibilitychange');
assert.equal(renderer.loop, null, 'Hidden documents stop GPU updates.');
env.document.hidden = false;
event(env.document, 'visibilitychange');
assert.equal(typeof renderer.loop, 'function', 'Playback resumes when the document returns.');
env.intersections[0].trigger(false);
assert.equal(renderer.loop, null, 'Off-screen diagrams stop GPU updates.');
env.intersections[0].trigger(true);
assert.equal(typeof renderer.loop, 'function');
event(env.window, 'pagehide');
assert.equal(renderer.loop, null);
event(env.window, 'pageshow');
assert.equal(typeof renderer.loop, 'function');

env.media.matches = true;
event(env.media, 'change', { matches: true });
assert.equal(renderer.loop, null);
assert.equal(root.dataset.playing, 'false');
scene.setPlaying(true);
assert.equal(renderer.loop, null, 'Reduced-motion prevents autoplay even if explicitly requested.');
scene.seek(.2);
assert.equal(progresses.at(-1), .2, 'Reduced-motion preserves manual timeline exploration.');
assert.match(find(root, 'wb-scene-motion-note').textContent, /減少動態/);
env.media.matches = false;
event(env.media, 'change', { matches: false });
assert.equal(renderer.loop, null, 'Changing preference does not unexpectedly resume animation.');

env.resizers[0].trigger(390, 340);
assert.deepEqual(renderer.size, { width: 390, height: 340 });
const oldGeometries = new Set();
const oldMaterials = new Set();
renderer.scene.traverse(object => {
  if (object.geometry) oldGeometries.add(object.geometry);
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) oldMaterials.add(material);
});
let freedGeometries = 0;
let freedMaterials = 0;
for (const geometry of oldGeometries) geometry.addEventListener('dispose', () => freedGeometries++);
for (const material of oldMaterials) material.addEventListener('dispose', () => freedMaterials++);
scene.update({ ...sample, progress: .3, selectedId: 'b', rows: [{ ...sample.rows[0], grams: 6 }, { ...sample.rows[1], grams: 12 }] });
assert.equal(freedGeometries, oldGeometries.size, 'Rebuilding a formula releases the previous GPU geometry.');
assert.equal(freedMaterials, oldMaterials.size);
assert.equal(list.children[1].getAttribute('aria-pressed'), 'true');
assert.match(find(root, 'wb-scene-size-note').textContent, /實錄克數.*相對佔比/);
scene.setPlaying(true);
scene.update({ ...sample, rows: [] });
assert.equal(renderer.loop, null, 'An empty selection ends playback.');
assert.equal(list.children.length, 0);

scene.dispose();
scene.dispose();
assert.equal(renderer.loop, null);
assert.equal(renderer.disposed, 1, 'Dispose is safe to call twice.');
assert.equal(renderer.contextLosses, 1);
assert.equal(renderer.renderLists.disposed, 1);
assert(env.resizers.every(observer => observer.disconnected));
assert(env.intersections.every(observer => observer.disconnected));
assert.equal(env.document.listenerCount, 0);
assert.equal(env.window.listenerCount, 0);
assert.equal(env.media.listenerCount, 0);
assert.equal(renderer.domElement.listenerCount, 0);
assert.equal(env.container.children.length, 0);

// Initial preference and later WebGL context loss preserve usable text records.
const motionEnv = installDOM({ reducedMotion: true });
const motionScene = mountWorkbenchScene(motionEnv.container, { snapshot: sample });
const motionRenderer = renderers.at(-1);
motionScene.setPlaying(true);
assert.equal(motionRenderer.loop, null);
motionScene.seek(.6);
assert.match(find(motionEnv.container, 'wb-scene-center').children[1].textContent, /60%/);
motionScene.dispose();

const lostEnv = installDOM();
const lostScene = mountWorkbenchScene(lostEnv.container, { snapshot: sample });
const lostRenderer = renderers.at(-1);
lostScene.setPlaying(true);
const lostEvent = event(lostRenderer.domElement, 'webglcontextlost');
assert.equal(lostEvent.defaultPrevented, true);
assert.equal(lostRenderer.loop, null);
assert(find(lostEnv.container, 'wb-scene').classList.contains('is-fallback'));
assert.equal(find(lostEnv.container, 'wb-scene-accessible-list').children.length, 2);
event(lostRenderer.domElement, 'webglcontextrestored');
assert.equal(find(lostEnv.container, 'wb-scene').classList.contains('is-fallback'), false);
assert.equal(lostRenderer.loop, null, 'Recovery requires an intentional new play action.');
lostScene.dispose();

// An unavailable WebGL2 constructor leaves all 60 materials selectable, not just the GPU budget.
rendererMustFail = true;
const fallbackEnv = installDOM();
const fallbackPicks = [];
const fallbackMessages = [];
const many = Array.from({ length: 60 }, (_, index) => ({ id: `herb-${index}`, name: `藥材 ${index + 1}`, grams: null, ratio: 1 }));
const fallback = mountWorkbenchScene(fallbackEnv.container, { snapshot: { ...sample, rows: many },
  onSelect: id => fallbackPicks.push(id), onFallback: message => fallbackMessages.push(message) });
const fallbackRoot = fallbackEnv.container.children[0];
assert.equal(fallbackRoot.dataset.renderer, 'fallback');
assert.equal(find(fallbackRoot, 'wb-scene-viewport').hidden, true);
const fallbackList = find(fallbackRoot, 'wb-scene-accessible-list');
assert.equal(fallbackList.children.length, 60);
event(fallbackList.children[59], 'click');
assert.deepEqual(fallbackPicks, ['herb-59']);
assert.equal(fallbackList.children[59].getAttribute('aria-pressed'), 'true');
assert.equal(fallbackMessages.length, 1);
fallback.setPlaying(true);
assert.equal(fallbackRoot.dataset.playing, 'false');
fallback.seek(.4);
assert.match(find(fallbackRoot, 'wb-scene-stage').textContent, /60 味/);
fallback.update({ ...sample, rows: [] });
assert.equal(fallbackList.children.length, 0);
fallback.dispose();
assert.equal(fallbackEnv.container.children.length, 0);

console.log('Scene lifecycle checks passed: pause/play/seek, hidden/off-screen/page lifecycle, reduced-motion, resize, selection, GPU rebuild/disposal, context recovery, and 60-material no-WebGL fallback. Renderer is stubbed; real GPU appearance remains a browser integration check.');

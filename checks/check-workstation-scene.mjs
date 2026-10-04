import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const modulePath = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../dist/workstation-scene.js', import.meta.url));
const ActualThree = await import(pathToFileURL(resolve(dirname(modulePath), 'vendor/three.module.js')));

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
  querySelector(selector) {
    for (const child of this.children) { if (child.tagName.toLowerCase() === selector) return child; const match = child.querySelector(selector); if (match) return match; }
    return null;
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
    this.shadowMap = {};
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
const source = await readFile(modulePath, 'utf8');
assert(source.startsWith("import * as THREE from './vendor/three.module.js';"));
const testSource = source.replace("import * as THREE from './vendor/three.module.js';", 'const THREE = globalThis.__sceneTHREE;');
const { mountWorkstationScene, describeWorkstation, normalizeWorkstationSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(testSource).toString('base64')}`);

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

let checks = 0;
function check(name, fn) { fn(); checks++; }
const rows = [
  { id: 'pre', name: '先煎材料', grams: 2.5, ratio: 1, preparationInstruction: 'preboil' },
  { id: 'normal', name: '一般材料', grams: null, ratio: 2, preparationInstruction: 'ordinary' },
  { id: 'bag', name: '包煎材料', grams: 3, ratio: 1, preparationInstruction: 'wrapped' },
  { id: 'late', name: '後下材料', grams: 1, ratio: 1, preparationInstruction: 'late_add' },
  { id: 'sep', name: '另煎材料', grams: 1, ratio: 1, preparationInstruction: 'separate' },
  { id: 'diss', name: '烊化材料', grams: 1, ratio: 1, preparationInstruction: 'dissolve' },
  { id: 'u', name: '未知指令', grams: null, ratio: 1 }
];
const operations = [
  { id:'inspect',label:'核對',stationId:'materials',rowIds:rows.map(row=>row.id) },
  { id:'process',label:'飲片規格核對',stationId:'processing',rowIds:rows.map(row=>row.id) },
  { id:'measure',label:'飲片稱量',stationId:'weighing',rowIds:rows.map(row=>row.id) },
  { id:'assemble',label:'分組',stationId:'assembly',rowIds:rows.map(row=>row.id) },
  { id:'prepare_vessel',label:'准备器具',stationId:'decoction',rowIds:[],equipmentId:'main_vessel' },
  { id:'soak',label:'獨立浸泡',stationId:'assembly',rowIds:['normal','bag'],equipmentId:'soaking_basin',parameters:{durationMinutes:null} },
  { id:'preboil',label:'先煎分支',stationId:'decoction',rowIds:['pre'],equipmentId:'main_vessel',parameters:{durationMinutes:null} },
  { id:'first_decoction',label:'合入第一煎',stationId:'decoction',rowIds:['pre','normal','bag'],equipmentId:'main_vessel',parameters:{durationMinutes:null,recordedFirstMinutes:20} },
  { id:'late_add',label:'後下',stationId:'decoction',rowIds:['late'],equipmentId:'main_vessel' },
  { id:'filter',label:'濾取',stationId:'filtration',rowIds:['pre','normal','bag','late'],equipmentId:'filter_station' },
  { id:'separate',label:'另煎',stationId:'decoction',rowIds:['sep'],equipmentId:'separate_vessel' },
  { id:'dissolve',label:'濾後烊化',stationId:'filtration',rowIds:['diss'],equipmentId:'dissolve_vessel' },
  { id:'pending',label:'指令待核',stationId:'assembly',rowIds:['u'],equipmentId:'holding_tray' },
  { id:'record',label:'記錄',stationId:'record',rowIds:rows.map(row=>row.id) }
];
const sample = { basis:'grams',station:'materials',preparation:'decoction',rows,operationTimeline:operations,
  operationalScene:{equipment:['soaking_basin','wrap_packet','main_vessel','filter_station','separate_vessel','separate_filter','dissolve_vessel'],rowRoutes:rows.map(row=>({id:row.id,instruction:row.preparationInstruction||'unrecorded'}))},
  liquidRecord:{waterMl:null,temperatureC:0,durationMinutes:0},massContext:{stage:'processed_dry'} };

check('Unknown mass stays null, never zero',()=>{const d=describeWorkstation(sample);assert.equal(d.totalGrams,null);assert.equal(d.knownGrams,8.5);assert.equal(d.rows[1].grams,null);assert.equal(d.rows[1].amountText,'克數未錄');});
check('No rows and no recorded masses stay null',()=>{const d=describeWorkstation({rows:[{id:'a',grams:null}]});assert.equal(d.knownGrams,null);assert.equal(d.totalGrams,null);});
check('Positive complete masses can sum recorded grams',()=>{assert.equal(describeWorkstation({rows:[{id:'a',grams:.25},{id:'b',grams:1.5}]}).totalGrams,1.75);});
check('Preparation uses pill, not invented aliases',()=>{assert.equal(describeWorkstation({preparation:'pill'}).preparationText,'丸劑流程');assert.equal(normalizeWorkstationSnapshot({preparation:'pills'}).preparation,'unrecorded');});
check('The supplied operation sequence stays ordered including repeated stations',()=>{assert.deepEqual(describeWorkstation(sample).path,operations.map(op=>op.stationId));});
check('No operations do not fabricate an SOP',()=>{assert.deepEqual(describeWorkstation({rows,preparation:'decoction'}).path,[]);});
check('Unknown inputs stay unknown and do not auto-route',()=>{assert.equal(normalizeWorkstationSnapshot({rows:[{id:'a',preparationInstruction:'炙炒'}]}).rows[0].preparationInstruction,'unrecorded');});
check('Missing or illegal quantities do not become a dose',()=>{for(const grams of [0,-1,Infinity,NaN,'3'])assert.equal(normalizeWorkstationSnapshot({rows:[{id:'a',grams}]}).rows[0].grams,null);});
check('Zero Celsius and zero minute records survive',()=>{assert.deepEqual(normalizeWorkstationSnapshot(sample).liquidRecord,{waterMl:null,temperatureC:0,durationMinutes:0});});
check('An operation never becomes physically complete',()=>{assert.equal(normalizeWorkstationSnapshot({operations:[{station:'weighing',completed:true}]}).operations[0].completed,false);});
check('Snapshot does not mutate source fields',()=>{const before=JSON.stringify(sample);describeWorkstation(sample);assert.equal(JSON.stringify(sample),before);});

const env=installDOM();
const selection=[];const stations=[];const progresses=[];
const mounted=mountWorkstationScene(env.container,{snapshot:sample,onSelectMaterial:id=>selection.push(id),onSelectStation:id=>stations.push(id),onProgress:p=>progresses.push(p)});
const renderer=renderers.at(-1);const root=env.container.children[0];
const object=name=>renderer.scene.getObjectByName(name);
const phase=i=>mounted.seek((i+.15)/operations.length);
check('Production geometry mounts with the actual Three math classes',()=>{assert.equal(root.dataset.renderer,`three-${ActualThree.REVISION}`);assert(renderer.scene.isScene);assert(object('station-weighing'));assert(object('equipment-soaking_basin'));});
check('Initial mount is paused and rendering budget is capped',()=>{assert.equal(renderer.loop,null);assert.equal(renderer.pixelRatio,1.5);});
check('Materials can be selected through the equivalent accessible controls',()=>{event(find(root,'ws-material-list').children[1],'click');assert.deepEqual(selection,['normal']);assert.equal(find(root,'ws-scale-readout').children[2].textContent,'克數未錄');});
check('Equipment can be selected through station controls',()=>{event(find(root,'ws-station-nav').children[2],'click');assert.deepEqual(stations,['processing']);});
check('Source station order controls animation, not the bench arrangement',()=>{phase(1);assert.match(find(root,'ws-scene-heading').children[0].textContent,/炮製/);assert.equal(object('ws-transfer-dish').userData.operationId,'process');});
check('A vessel setup with empty row IDs moves no ingredient',()=>{phase(4);assert.equal(object('ws-transfer-dish').visible,false);});
check('Ordinary and wrapped ingredients use the separate soaking basin',()=>{phase(5);assert.equal(object('ws-transfer-dish').userData.equipmentId,'soaking_basin');assert.equal(object('ws-transfer-dish').userData.materialId,'normal');});
check('Only the preboil ingredient appears in the preboil operation',()=>{phase(6);assert.equal(object('ws-transfer-dish').userData.materialId,'pre');assert.equal(object('ws-transfer-dish').userData.equipmentId,'main_vessel');});
check('A repeated station retains the specific selected operation after focus',()=>{phase(8);mounted.focusStation('decoction');assert.equal(object('ws-transfer-dish').userData.operationId,'late_add');assert.equal(object('ws-transfer-dish').userData.materialId,'late');});
check('Recorded whole-stage minutes do not turn into child-step times',()=>{phase(7);assert.match(find(root,'ws-process-readout').textContent,/時間 未錄/);});
check('Separate and dissolve branches target their own vessels',()=>{phase(10);assert.equal(object('ws-transfer-dish').userData.equipmentId,'separate_vessel');phase(11);assert.equal(object('ws-transfer-dish').userData.equipmentId,'dissolve_vessel');});
check('Unknown instructions remain at the holding tray',()=>{phase(12);assert.equal(object('ws-transfer-dish').userData.materialId,'u');assert.equal(object('ws-transfer-dish').userData.equipmentId,'holding_tray');});
check('Play advances; pause removes the continuous render loop',()=>{mounted.setPlaying(true);assert.equal(typeof renderer.loop,'function');renderer.tick(0);renderer.tick(100);assert(progresses.at(-1)>0);mounted.setPlaying(false);assert.equal(renderer.loop,null);});
check('Hidden and offscreen views stop rendering',()=>{mounted.setPlaying(true);env.document.hidden=true;event(env.document,'visibilitychange');assert.equal(renderer.loop,null);env.document.hidden=false;event(env.document,'visibilitychange');assert.equal(typeof renderer.loop,'function');env.intersections[0].trigger(false);assert.equal(renderer.loop,null);env.intersections[0].trigger(true);assert.equal(typeof renderer.loop,'function');});
check('Reduced motion stops playback',()=>{env.media.matches=true;event(env.media,'change',{matches:true});assert.equal(renderer.loop,null);assert.equal(root.dataset.playing,'false');});
check('Pills and powder do not show a pot, funnel or branch vessels',()=>{for(const preparation of ['pill','powder','other','unrecorded']){mounted.update({...sample,preparation});assert.equal(object('equipment-separate_vessel').visible,false);assert.equal(object('station-decoction').children[2].visible,false);assert.equal(object('station-filtration').children[2].visible,false);}});
check('Updating rows refreshes readings without fabricating mass',()=>{mounted.update({...sample,rows:[{id:'a',name:'A',grams:null}],selectedId:'a'});assert.equal(find(root,'ws-scale-readout').children[2].textContent,'克數未錄');assert.equal(find(root,'ws-material-list').children.length,1);});
const geometries=[];renderer.scene.traverse(o=>{if(o.geometry)geometries.push(o.geometry);});let disposedGeometries=0;geometries.forEach(g=>g.addEventListener('dispose',()=>disposedGeometries++));
check('Dispose releases GPU resources and removes observers/listeners',()=>{mounted.dispose();mounted.dispose();assert.equal(renderer.disposed,1);assert.equal(renderer.contextLosses,1);assert.equal(renderer.loop,null);assert.equal(env.container.children.length,0);assert(env.resizers[0].disconnected);assert(env.intersections[0].disconnected);assert.equal(env.document.listenerCount,0);assert.equal(env.window.listenerCount,0);assert(disposedGeometries>0);});
rendererMustFail=true;
const fallbackEnv=installDOM();let fallbackCount=0;
const fallback=mountWorkstationScene(fallbackEnv.container,{snapshot:sample,onFallback:()=>fallbackCount++});
check('No WebGL still gives the same station and all-material controls',()=>{const r=fallbackEnv.container.children[0];assert.equal(r.dataset.renderer,'fallback');assert.equal(find(r,'ws-material-list').children.length,rows.length);assert.equal(find(r,'ws-station-nav').children.length,7);assert.equal(fallbackCount,1);});
fallback.dispose();
console.log(JSON.stringify({passed:checks,scope:'Actual Three geometry/math with mocked renderer boundary; source-routing, unknown mass, special vessels, pause/reduced-motion/fallback and resource disposal'}));

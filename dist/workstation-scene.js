import * as THREE from './vendor/three.module.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const STATIONS = [
  { id: 'materials', label: '原料核對', tool: '原料托盤', x: -5.1, z: 1.65 },
  { id: 'weighing', label: '稱量', tool: '電子秤', x: -1.7, z: 1.65 },
  { id: 'processing', label: '炮製', tool: '處理器皿', x: 1.7, z: 1.65 },
  { id: 'assembly', label: '組方', tool: '配伍容器', x: 5.1, z: 1.65 },
  { id: 'record', label: '批次記錄', tool: '記錄板', x: -3.4, z: -1.85 },
  { id: 'decoction', label: '煎煮', tool: '帶蓋煎煮鍋', x: 1.7, z: -1.85 },
  { id: 'filtration', label: '濾取', tool: '漏斗與接液器', x: 5.1, z: -1.85 }
];
const IDS = new Set(STATIONS.map(station => station.id));
const MAX_TRAYS = 12;
const GOLD = 0xcab37a;

/** Source and recorded values stay separate from illustrative apparatus geometry. */
export function normalizeWorkstationSnapshot(input = {}) {
  const preparation = typeof input.preparation === 'object' ? input.preparation?.method : input.preparation;
  const operations = Array.isArray(input.operationTimeline) ? input.operationTimeline : input.operations;
  const rowRoutes = input.rowRoutes || input.operationalScene?.rowRoutes;
  return {
    rows: Array.isArray(input.rows) ? input.rows.map(row => ({
      ...row,
      id: String(row.id),
      name: String(row.name || row.id),
      grams: positive(row.grams) ? row.grams : null,
      ratio: positive(row.ratio) ? row.ratio : null,
      processingLabel: String(row.processingLabel || '炮製未錄'),
      preparationInstruction: ['ordinary', 'preboil', 'late_add', 'wrapped', 'dissolve', 'separate'].includes(row.preparationInstruction) ? row.preparationInstruction : 'unrecorded'
    })) : [],
    basis: input.basis === 'grams' ? 'grams' : 'research',
    station: IDS.has(input.station) ? input.station : 'materials',
    preparation: ['unrecorded', 'decoction', 'pill', 'powder', 'other'].includes(preparation) ? preparation : 'unrecorded',
    operations: Array.isArray(operations) ? operations.filter(operation => IDS.has(operation.station || operation.stationId)).map(operation => ({
      ...operation,
      station: operation.station || operation.stationId,
      rowIds: Array.isArray(operation.rowIds) ? operation.rowIds.map(String) : [],
      parameters: { ...(operation.parameters || {}) },
      completed: false
    })) : [],
    rowRoutes: Array.isArray(rowRoutes) ? rowRoutes.map(route => ({ ...route, id: String(route.id), operationIds: Array.isArray(route.operationIds) ? route.operationIds.slice() : [] })) : [],
    equipment: Array.isArray(input.operationalScene?.equipment) ? input.operationalScene.equipment.slice() : [],
    massStage: input.massContext?.stage || input.massStage || 'unrecorded',
    progress: finite(input.progress) ? clamp(input.progress, 0, 1) : 0,
    selectedId: input.selectedId == null ? null : String(input.selectedId),
    liquidRecord: {
      waterMl: positive(input.liquidRecord?.waterMl) ? input.liquidRecord.waterMl : null,
      temperatureC: finite(input.liquidRecord?.temperatureC) ? input.liquidRecord.temperatureC : null,
      durationMinutes: finite(input.liquidRecord?.durationMinutes) && input.liquidRecord.durationMinutes >= 0 ? input.liquidRecord.durationMinutes : null
    }
  };
}

export function describeWorkstation(input = {}) {
  const snapshot = normalizeWorkstationSnapshot(input);
  const complete = snapshot.rows.length > 0 && snapshot.rows.every(row => positive(row.grams));
  const recorded = snapshot.rows.filter(row => positive(row.grams));
  const knownGrams = recorded.length ? recorded.reduce((total, row) => total + row.grams, 0) : null;
  const allowed = new Set(snapshot.preparation === 'decoction'
    ? ['materials', 'weighing', 'processing', 'assembly', 'decoction', 'filtration', 'record']
    : ['materials', 'weighing', 'processing', 'assembly', 'record']);
  const recordedPath = snapshot.operations.map(operation => operation.station);
  const path = recordedPath;
  return {
    snapshot,
    complete,
    knownGrams,
    totalGrams: complete ? knownGrams : null,
    path,
    stations: STATIONS.map(station => ({ ...station, available: allowed.has(station.id) })),
    rows: snapshot.rows.map(row => ({ ...row, amountText: positive(row.grams) ? `${row.grams} g` : '克數未錄' })),
    preparationText: ({ unrecorded: '製法未錄', decoction: '湯劑流程', pill: '丸劑流程', powder: '散劑流程', other: '其他製法' })[snapshot.preparation]
  };
}

function element(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

/** A spatial apparatus map. It never derives process settings, yield, toxicity or drug strength. */
export function mountWorkstationScene(container, options = {}) {
  if (!container || typeof container.append !== 'function') throw new TypeError('A workstation container is required.');
  const root = element('div', 'ws-scene', container);
  const heading = element('div', 'ws-scene-heading', root);
  const title = element('strong', '', heading, '工序操作台');
  const preparationTag = element('span', 'ws-preparation-tag', heading);
  const viewport = element('div', 'ws-scene-viewport', root);
  const overlays = element('div', 'ws-scene-overlays', viewport);
  const readout = element('div', 'ws-scale-readout', overlays);
  element('span', 'ws-scale-title', readout, '電子秤 · 實錄');
  const readoutName = element('span', 'ws-scale-name', readout);
  const readoutValue = element('strong', '', readout);
  const stationTags = new Map();
  const stationsNav = element('div', 'ws-station-nav', root);
  stationsNav.setAttribute('aria-label', '操作台工序分區');
  const navButtons = new Map();
  for (const station of STATIONS) {
    const tag = element('button', 'ws-station-tag', overlays, station.tool);
    tag.type = 'button';
    tag.dataset.stationId = station.id;
    tag.addEventListener('click', () => selectStation(station.id));
    stationTags.set(station.id, tag);
    const button = element('button', 'ws-station-button', stationsNav);
    button.type = 'button';
    button.dataset.stationId = station.id;
    element('span', '', button, station.label);
    const note = element('small', '', button, station.id === 'decoction' || station.id === 'filtration' ? '湯劑分支' : station.tool);
    button.addEventListener('click', () => selectStation(station.id));
    navButtons.set(station.id, { button, note });
  }
  const operationReadout = element('p', 'ws-operation-readout', root);
  operationReadout.setAttribute('aria-live', 'off');
  const processReadout = element('p', 'ws-process-readout', root);
  const hint = element('p', 'ws-scene-hint', root, '拖曳旋轉 · 滾輪／雙指縮放 · 點選器具或原料');
  const caution = element('p', 'ws-scene-caution', root, '器具與移動是工序示意；實際工藝依來源與批次記錄。液面不代表煎出量，動畫不表示工藝完成或藥性變化。');
  const materials = element('details', 'ws-materials', root);
  const materialsSummary = element('summary', '', materials);
  const list = element('div', 'ws-material-list', materials);
  list.setAttribute('aria-label', '操作台全部原料');
  const overflow = element('p', 'ws-overflow-note', root);

  let description = describeWorkstation(options.snapshot);
  let snapshot = description.snapshot;
  let progress = snapshot.progress;
  let selectedId = snapshot.selectedId;
  let focusedStation = snapshot.station;
  let seekMode = false;
  let playing = false;
  let disposed = false;
  let visible = true;
  let contextLost = false;
  let renderer = null;
  let scene = null;
  let camera = null;
  let bench = null;
  let carryingDish = null;
  let lastTime = null;
  let lastCallback = 0;
  let rendering = false;
  let resizeObserver = null;
  let intersectionObserver = null;
  let materialObjects = [];
  const stationObjects = new Map();
  const equipmentObjects = new Map();
  const pickables = [];
  const cleanups = [];
  const pointers = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const cameraState = { theta: .22, phi: .88, distance: 21, target: new THREE.Vector3(0, .2, 0) };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = !!media?.matches;
  const durationMs = clamp(Number(options.durationMs) || 20000, 8000, 60000);

  function listen(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    cleanups.push(() => target.removeEventListener(event, handler, opts));
  }

  function releaseObject(object) {
    const geometries = new Set();
    const materials = new Set();
    object.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    object.removeFromParent();
  }

  function mesh(parent, geometry, color, position, materialOptions = {}) {
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .64, metalness: .08, ...materialOptions }));
    if (position) object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const box = (parent, width, height, depth, color, position, opts) => mesh(parent, new THREE.BoxGeometry(width, height, depth), color, position, opts);
  const cylinder = (parent, top, bottom, height, color, position, opts) => mesh(parent, new THREE.CylinderGeometry(top, bottom, height, 36), color, position, opts);
  const ring = (parent, radius, thickness, color, position) => {
    const object = mesh(parent, new THREE.TorusGeometry(radius, thickness, 8, 48), color, position, { metalness: .62, roughness: .35 });
    object.rotation.x = Math.PI / 2;
    return object;
  };

  function dish(parent, radius, height, color, y = .15, transparent = false) {
    const group = new THREE.Group();
    parent.add(group);
    const body = mesh(group, new THREE.CylinderGeometry(radius, radius * .78, height, 40, 1, true), color, [0, y + height / 2, 0], {
      side: THREE.DoubleSide, transparent, opacity: transparent ? .34 : 1, metalness: transparent ? .05 : .2, roughness: transparent ? .1 : .6
    });
    cylinder(group, radius * .78, radius * .78, .055, color, [0, y, 0], { transparent, opacity: transparent ? .38 : 1 });
    ring(group, radius, .035, color, [0, y + height, 0]);
    return { group, body };
  }

  function herbPieces(parent, seed = 0, count = 8, spread = .42) {
    const group = new THREE.Group();
    parent.add(group);
    for (let index = 0; index < count; index++) {
      const angle = index * 2.399 + seed;
      const distance = spread * Math.sqrt((index + 1) / count);
      const color = [0xbaa17a, 0xa88457, 0x80654a, 0xc6b084][(index + seed) % 4];
      const piece = index % 3 === 0
        ? cylinder(group, .09, .12, .055, color, [Math.cos(angle) * distance, .065 + index % 3 * .015, Math.sin(angle) * distance])
        : box(group, .16, .055, .1, color, [Math.cos(angle) * distance, .065 + index % 3 * .015, Math.sin(angle) * distance]);
      piece.rotation.y = angle;
    }
    return group;
  }

  function addStation(station) {
    const group = new THREE.Group();
    group.name = `station-${station.id}`;
    group.position.set(station.x, 0, station.z);
    bench.add(group);
    const mat = box(group, 3.05, .035, 2.9, 0xcbd7cb, [0, .055, 0], { roughness: .95 });
    const edge = box(group, 2.9, .03, .085, GOLD, [0, .09, 1.4], { roughness: .42 });
    const entry = { station, group, mat, edge, highlight: null, stream: null, lid: null, liquid: null, herbs: null, apparatus: [], review: null };
    if (station.id === 'materials') {
      box(group, 2.77, .12, 2.58, 0x526a58, [0, .16, 0]);
      box(group, 2.55, .035, 2.38, 0xe1ddca, [0, .245, 0]);
    } else if (station.id === 'weighing') {
      box(group, 1.95, .26, 1.88, 0x304744, [0, .21, .02], { metalness: .44, roughness: .35 });
      cylinder(group, .73, .73, .07, 0xbcc8c3, [0, .39, -.21], { metalness: .75, roughness: .25 });
      box(group, 1.15, .09, .36, 0xadd7b4, [0, .36, .68], { emissive: 0x2b573b, emissiveIntensity: .3, roughness: .24 });
      const bowl = dish(group, .51, .2, 0xf0eede, .45);
      bowl.group.position.z = -.21;
      entry.herbs = herbPieces(bowl.group, 1, 6, .32);
      entry.herbs.position.y = .45;
    } else if (station.id === 'processing') {
      box(group, 1.57, .24, 1.45, 0x374343, [0, .22, -.27], { metalness: .45 });
      cylinder(group, .6, .6, .06, 0x6d746a, [0, .39, -.27], { metalness: .55 });
      const pan = dish(group, .65, .24, 0x73745f, .43);
      pan.group.position.z = -.27;
      box(group, .17, .11, .81, 0x635343, [.78, .64, -.26]);
      box(group, 1.55, .09, .68, 0xc7af80, [0, .15, .87]);
      const blade = box(group, .66, .05, .22, 0xd5d7cb, [-.15, .23, .87], { metalness: .8, roughness: .25 });
      blade.rotation.y = -.25;
      const handle = box(group, .4, .07, .14, 0x675447, [.36, .23, .73]);
      handle.rotation.y = -.25;
      entry.herbs = herbPieces(pan.group, 2, 7, .42);
      entry.herbs.position.y = .47;
    } else if (station.id === 'assembly') {
      const bowl = dish(group, .9, .62, 0xf0e8ce, .14);
      entry.herbs = herbPieces(bowl.group, 3, 12, .62);
      entry.herbs.position.y = .18;
      box(group, .16, .11, 1.39, 0x8d765a, [1.08, .2, -.18]);
    } else if (station.id === 'decoction') {
      box(group, 1.8, .26, 1.78, 0x344b48, [0, .22, 0], { metalness: .36 });
      cylinder(group, .72, .7, 1.06, 0x627f6d, [0, .93, 0], { metalness: .25, roughness: .3 });
      ring(group, .73, .05, 0xd0c7a2, [0, 1.48, 0]);
      for (const x of [-.92, .92]) {
        const handle = mesh(group, new THREE.TorusGeometry(.22, .06, 8, 30, Math.PI * 1.5), 0xc5ba92, [x, 1.14, 0], { metalness: .45 });
        handle.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      entry.liquid = cylinder(group, .64, .64, .018, 0xa08250, [0, 1.43, 0], { transparent: true, opacity: .85, roughness: .19 });
      entry.lid = new THREE.Group();
      group.add(entry.lid);
      cylinder(entry.lid, .67, .78, .15, 0x8aa08a, [0, 1.58, 0], { metalness: .3, roughness: .38 });
      cylinder(entry.lid, .14, .2, .2, 0x506857, [0, 1.75, 0]);
    } else if (station.id === 'filtration') {
      cylinder(group, .72, .72, .09, 0x586d66, [0, .15, 0]);
      for (const x of [-.6, .6]) cylinder(group, .04, .04, 2.08, 0xabb9b0, [x, 1.22, -.48], { metalness: .73 });
      const flask = dish(group, .49, .94, 0xc4e4db, .21, true);
      entry.liquid = cylinder(group, .36, .36, .045, 0xa58d58, [0, .3, 0], { transparent: true, opacity: .78 });
      mesh(group, new THREE.CylinderGeometry(.62, .075, .66, 40, 1, true), 0xe5e9d6, [0, 1.82, 0], { side: THREE.DoubleSide, roughness: .38 });
      ring(group, .62, .035, 0xbacdbd, [0, 2.15, 0]);
      cylinder(group, .075, .06, .4, 0xccd8c8, [0, 1.29, 0], { roughness: .34 });
      entry.stream = cylinder(group, .018, .018, .25, 0xa88a53, [0, 1.04, 0], { transparent: true, opacity: .75 });
      entry.stream.visible = false;
      box(group, 1.34, .07, .11, 0xa4b6ad, [0, 2.17, -.48], { metalness: .62 });
    } else if (station.id === 'record') {
      const board = new THREE.Group();
      board.rotation.y = -.13;
      board.rotation.x = -.05;
      group.add(board);
      box(board, 1.92, .09, 2.2, 0x765f45, [0, .18, 0]);
      box(board, 1.64, .025, 1.95, 0xf0ede0, [0, .242, .02]);
      box(board, .67, .075, .21, 0xaeb7a9, [0, .29, -.98], { metalness: .55 });
      for (let index = 0; index < 6; index++) box(board, index % 2 ? .88 : 1.23, .011, .025, 0x9aa58b, [-.05, .259, -.6 + index * .22]);
      const pen = cylinder(group, .038, .038, 1.35, 0x344b42, [1.14, .25, .16], { metalness: .45 });
      pen.rotation.x = Math.PI / 2;
      pen.rotation.z = -.17;
    }
    entry.apparatus = group.children.filter(child => child !== mat && child !== edge);
    if (station.id === 'decoction') {
      entry.review = new THREE.Group();
      group.add(entry.review);
      box(entry.review, 1.95, .07, 2, 0xc2b894, [0, .16, 0]);
      box(entry.review, 1.72, .025, 1.75, 0xeeead7, [0, .21, 0]);
      for (let index = 0; index < 5; index++) box(entry.review, 1.15, .012, .03, 0x859676, [0, .23, -.55 + index * .22]);
    }
    group.traverse(object => {
      if (object.isMesh) {
        object.userData.stationId = station.id;
        pickables.push(object);
      }
    });
    stationObjects.set(station.id, entry);
    const anchors = {
      materials: ['material_tray', 'holding_tray'], weighing: ['scale'], processing: ['processing_area'],
      assembly: ['assembly_tray', 'wrap_packet'], decoction: ['main_vessel', 'preparation_review'], filtration: ['filter_station', 'collection_vessel'], record: ['record_board']
    };
    for (const id of anchors[station.id] || []) equipmentObjects.set(id, { anchor: new THREE.Vector3(station.x, station.id === 'filtration' ? 1.8 : station.id === 'decoction' ? 1.8 : 1.1, station.z), group: null });
  }

  function buildWorkbench() {
    bench = new THREE.Group();
    scene.add(bench);
    box(bench, 16.2, .35, 7.85, 0xe0dfcf, [0, -.2, 0], { roughness: .83 });
    box(bench, 15.9, .45, 7.6, 0x536651, [0, -.59, 0]);
    for (const x of [-7.05, 7.05]) for (const z of [-2.95, 2.95]) box(bench, .32, 1.95, .32, 0x586856, [x, -1.56, z], { metalness: .29 });
    box(bench, 14.55, .18, 5.96, 0x465d4f, [0, -2.2, 0]);
    for (const station of STATIONS) addStation(station);
    buildBranchEquipment();
    carryingDish = new THREE.Group();
    carryingDish.name = 'ws-transfer-dish';
    bench.add(carryingDish);
    const smallDish = dish(carryingDish, .33, .12, 0xf5edcf, 0);
    herbPieces(smallDish.group, 3, 4, .2);
    carryingDish.visible = false;
    rebuildMaterials();
  }

  function buildBranchEquipment() {
    const decoction = stationObjects.get('decoction').group;
    const filtration = stationObjects.get('filtration').group;
    const assembly = stationObjects.get('assembly').group;
    const separate = new THREE.Group();
    separate.position.set(-1.05, 0, .8);
    decoction.add(separate);
    cylinder(separate, .34, .32, .63, 0xb3c3a2, [0, .44, 0]);
    cylinder(separate, .35, .38, .07, 0xd4dac3, [0, .78, 0]);
    cylinder(separate, .07, .09, .09, 0x829c79, [0, .86, 0]);
    const spout = cylinder(separate, .09, .09, .3, 0xb3c3a2, [.33, .56, 0]);
    spout.rotation.z = -Math.PI / 3;
    equipmentObjects.set('separate_vessel', { group: separate, anchor: new THREE.Vector3(.65, 1.1, -1.05), instruction: 'separate' });

    const separateFilter = new THREE.Group();
    separateFilter.position.set(-1.02, 0, -.56);
    filtration.add(separateFilter);
    dish(separateFilter, .27, .44, 0xd0e1d1, .16, true);
    mesh(separateFilter, new THREE.CylinderGeometry(.32, .04, .36, 28, 1, true), 0xe8eddb, [0, .82, 0], { side: THREE.DoubleSide });
    equipmentObjects.set('separate_filter', { group: separateFilter, anchor: new THREE.Vector3(4.08, 1.1, -2.41), instruction: 'separate' });

    const dissolve = new THREE.Group();
    dissolve.position.set(1.05, 0, -.75);
    filtration.add(dissolve);
    dish(dissolve, .29, .68, 0xd4e7d9, .15, true);
    const stirrer = cylinder(dissolve, .025, .025, 1.08, 0xd6ccb0, [.15, .69, 0]);
    stirrer.rotation.z = -.2;
    equipmentObjects.set('dissolve_vessel', { group: dissolve, anchor: new THREE.Vector3(6.15, 1.2, -2.6), instruction: 'dissolve' });

    const bag = new THREE.Group();
    bag.position.set(-1.08, .22, .8);
    assembly.add(bag);
    cylinder(bag, .16, .28, .4, 0xd7c99f, [0, .24, 0], { roughness: 1 });
    ring(bag, .16, .02, 0x7d8975, [0, .44, 0]);
    cylinder(bag, .11, .16, .12, 0xdfd4ac, [0, .5, 0], { roughness: 1 });
    equipmentObjects.set('wrap_packet', { group: bag, anchor: new THREE.Vector3(4.02, 1.1, 2.45), instruction: 'wrapped' });
    const soak = new THREE.Group();
    soak.position.set(-1.04, 0, -.81);
    assembly.add(soak);
    const soakBowl = dish(soak, .37, .34, 0xe4dfc8, .16);
    soakBowl.group.scale.x = 1.35;
    cylinder(soak, .31, .31, .014, 0xbab084, [0, .43, 0], { transparent: true, opacity: .6 }).scale.x = 1.35;
    equipmentObjects.set('soaking_basin', { group: soak, anchor: new THREE.Vector3(4.06, 1, .84), equipmentOnly: true });
    const holding = new THREE.Group();
    holding.position.set(1.05, .19, .98);
    assembly.add(holding);
    box(holding, .67, .045, .47, 0xe3d9bb, [0, .03, 0]);
    box(holding, .48, .026, .09, 0x9da58a, [0, .08, .18]);
    herbPieces(holding, 1, 4, .17);
    equipmentObjects.set('holding_tray', { group: holding, anchor: new THREE.Vector3(6.15, .95, 2.63) });
    for (const [id, item] of equipmentObjects) {
      if (item.group) item.group.name = `equipment-${id}`;
      item.group?.traverse(object => {
        if (!object.isMesh) return;
        object.userData.stationId = id === 'wrap_packet' || id === 'soaking_basin' || id === 'holding_tray' ? 'assembly' : id === 'separate_vessel' ? 'decoction' : 'filtration';
        pickables.push(object);
      });
    }
  }

  function rebuildMaterials() {
    materialObjects.forEach(entry => releaseObject(entry.group));
    materialObjects = [];
    for (let index = pickables.length - 1; index >= 0; index--) if (pickables[index].userData.materialId !== undefined) pickables.splice(index, 1);
    const host = stationObjects.get('materials')?.group;
    if (!host) return;
    description.rows.slice(0, MAX_TRAYS).forEach((row, index, visibleRows) => {
      const columns = visibleRows.length > 6 ? 4 : visibleRows.length > 2 ? 3 : 2;
      const rows = Math.ceil(visibleRows.length / columns);
      const spacingX = 2.3 / columns;
      const spacingZ = 2.1 / Math.max(rows, 2);
      const tray = new THREE.Group();
      tray.position.set((index % columns - (columns - 1) / 2) * spacingX, .28, (Math.floor(index / columns) - (rows - 1) / 2) * spacingZ);
      host.add(tray);
      const pad = box(tray, spacingX * .88, .045, spacingZ * .8, 0xf4efd9, [0, 0, 0], { roughness: .92 });
      const label = box(tray, spacingX * .7, .025, .11, 0xd7cfaa, [0, .03, spacingZ * .29]);
      const herbs = herbPieces(tray, index, 5, Math.min(spacingX, spacingZ) * .22);
      herbs.position.y = .025;
      tray.traverse(object => {
        if (object.isMesh) {
          object.userData.materialId = row.id;
          object.userData.stationId = 'materials';
          pickables.push(object);
        }
      });
      materialObjects.push({ row, group: tray, pad, label });
    });
  }

  function stationAtProgress() {
    const path = description.path;
    return path[Math.min(path.length - 1, Math.floor(progress * path.length))] || focusedStation;
  }
  function currentOperation() {
    const operations = snapshot.operations;
    if (!operations.length) return null;
    if (playing || seekMode) return operations[Math.min(operations.length - 1, Math.floor(progress * operations.length))];
    return operations.find(operation => operation.station === focusedStation) || null;
  }
  function activeStation() {
    return playing || seekMode ? stationAtProgress() : focusedStation;
  }

  function refreshLabels() {
    const active = activeStation();
    const station = STATIONS.find(item => item.id === active);
    title.textContent = `${station?.label || '工序'} · 操作台`;
    preparationTag.textContent = description.preparationText;
    const selected = description.rows.find(row => row.id === selectedId) || description.rows[0];
    readoutName.textContent = selected?.name || '等待原料';
    readoutValue.textContent = selected ? selected.amountText : '克數未錄';
    readout.classList.toggle('is-active', active === 'weighing');
    materialsSummary.textContent = `全部原料 · ${description.rows.length} 味`;
    for (const item of description.stations) {
      const { button, note } = navButtons.get(item.id);
      const tag = stationTags.get(item.id);
      button.classList.toggle('is-active', item.id === active);
      button.classList.toggle('is-optional', !item.available);
      button.setAttribute('aria-pressed', item.id === active ? 'true' : 'false');
      tag.classList.toggle('is-active', item.id === active);
      tag.classList.toggle('is-optional', !item.available);
      tag.setAttribute('aria-pressed', item.id === active ? 'true' : 'false');
      const isPreparationReview = item.id === 'decoction' && snapshot.preparation !== 'decoction';
      button.querySelector('span').textContent = isPreparationReview ? '製法核對' : item.label;
      tag.textContent = isPreparationReview ? '製法與來源核對' : item.tool;
      note.textContent = isPreparationReview ? '製備工藝待錄' : item.available ? item.tool : '湯劑分支';
    }
    const operation = currentOperation();
    operationReadout.textContent = operation ? `${operation.label} · ${operation.status === 'record_complete' ? '記錄已填' : operation.status === 'record_partial' ? '部分記錄' : '記錄待核'}`
      : `${station?.tool || '工序器具'} · ${active === 'decoction' || active === 'filtration' ? '湯劑分支器具示意' : '查看來源與批次記錄'}`;
    const liquid = playing || seekMode ? {
      waterMl: positive(operation?.parameters.waterMl) ? operation.parameters.waterMl : null,
      temperatureC: finite(operation?.parameters.temperatureC) ? operation.parameters.temperatureC : null,
      durationMinutes: finite(operation?.parameters.durationMinutes) ? operation.parameters.durationMinutes : null
    } : snapshot.liquidRecord;
    if (active === 'decoction' || active === 'filtration') {
      processReadout.textContent = `加水 ${liquid.waterMl === null ? '未錄' : `${liquid.waterMl} mL`} · 溫度 ${liquid.temperatureC === null ? '未錄' : `${liquid.temperatureC} °C`} · 時間 ${liquid.durationMinutes === null ? '未錄' : `${liquid.durationMinutes} 分`}；液面僅示意。`;
    } else if (active === 'processing') {
      processReadout.textContent = selected ? `${selected.name} · ${selected.processingLabel}；設備僅示意，以記錄中的實際工藝為準。` : '先選取原料，再查看其炮製來源與流程。';
    } else if (snapshot.massStage === 'raw_dry') {
      processReadout.textContent = description.knownGrams === null ? '炮製前原料克數未錄 · 炮製後投入量待另外記錄'
        : `炮製前原料實錄 ${description.knownGrams} g${description.complete ? '' : '（部分）'} · 炮製後投入量未知，未推算損耗率`;
    } else {
      processReadout.textContent = description.complete ? `實錄原料合計 ${description.totalGrams} g · 依所填克數記錄`
        : description.knownGrams !== null ? `已錄 ${description.knownGrams} g · 部分克數未錄，尚無總克數`
          : '克數未錄 · 托盤與器具大小不表示原料用量';
    }
    if (reducedMotion) hint.textContent = '減少動態已啟用 · 可點工序、拖動進度或旋轉查看';
    overflow.textContent = description.rows.length > MAX_TRAYS ? `台面示意前 ${MAX_TRAYS} 味；下方清單保留全部 ${description.rows.length} 味。` : '';
    overflow.hidden = !overflow.textContent;
  }

  function updateList() {
    list.replaceChildren();
    for (const row of description.rows) {
      const button = element('button', 'ws-material-button', list);
      button.type = 'button';
      button.dataset.materialId = row.id;
      element('strong', '', button, row.name);
      element('span', '', button, row.amountText);
      element('small', '', button, row.processingLabel);
      button.addEventListener('click', () => selectMaterial(row.id));
    }
    refreshSelected();
  }

  function refreshSelected() {
    materialObjects.forEach(entry => {
      const selected = entry.row.id === selectedId;
      entry.pad.material.color.setHex(selected ? 0xf8d78f : 0xf4efd9);
      entry.label.material.color.setHex(selected ? GOLD : 0xd7cfaa);
    });
    for (const button of list.querySelectorAll('button')) {
      const selected = button.dataset.materialId === selectedId;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  function selectMaterial(id) {
    if (disposed || !description.rows.some(row => row.id === String(id))) return;
    selectedId = String(id);
    refreshSelected();
    refreshLabels();
    options.onSelectMaterial?.(selectedId);
    draw();
  }

  function focusStation(id) {
    if (disposed || !IDS.has(id)) return;
    focusedStation = id;
    if (id !== stationAtProgress()) seekMode = false;
    const station = STATIONS.find(item => item.id === id);
    cameraState.target.set(station.x * .22, .2, station.z * .15);
    if (playing) setPlaying(false);
    refreshLabels();
    draw();
  }

  function selectStation(id) {
    focusStation(id);
    options.onSelectStation?.(id);
  }

  function positionCamera() {
    if (!camera) return;
    const { theta, phi, target } = cameraState;
    const distance = cameraState.distance * Math.max(1, 1.35 / camera.aspect);
    camera.position.set(target.x + distance * Math.sin(phi) * Math.sin(theta), target.y + distance * Math.cos(phi), target.z + distance * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function layoutWorkbench() {
    const active = activeStation();
    for (const [id, entry] of stationObjects) {
      const enabled = description.stations.find(station => station.id === id)?.available;
      entry.mat.material.color.setHex(id === active ? 0xe8d49f : enabled ? 0xcbd7cb : 0xc0c8bc);
      entry.edge.material.color.setHex(id === active ? 0xd8b969 : enabled ? 0x9da98c : 0xa8aea0);
      entry.mat.material.emissive.setHex(id === active ? 0x332500 : 0x000000);
      entry.mat.material.emissiveIntensity = .2;
      if (id === 'decoction' || id === 'filtration') {
        entry.apparatus.forEach(object => { object.visible = snapshot.preparation === 'decoction'; });
        if (entry.review) entry.review.visible = snapshot.preparation !== 'decoction';
      }
      if (entry.herbs) entry.herbs.visible = description.rows.length > 0;
      if (entry.lid) entry.lid.position.y = id === active && snapshot.preparation === 'decoction' ? .55 : 0;
      if (entry.liquid) entry.liquid.visible = snapshot.preparation === 'decoction';
      if (entry.stream) entry.stream.visible = playing && !reducedMotion && id === active && snapshot.preparation === 'decoction';
    }
    const equipmentInPlan = new Set(snapshot.equipment.length ? snapshot.equipment : snapshot.operations.map(operation => operation.equipmentId));
    for (const [id, equipment] of equipmentObjects) {
      if (equipment.group) equipment.group.visible = id === 'holding_tray' ? description.rows.some(row => row.preparationInstruction === 'unrecorded') : snapshot.preparation === 'decoction' && equipmentInPlan.has(id);
    }
    if (!carryingDish) return;
    const operation = currentOperation();
    const row = operation && (description.rows.find(item => item.id === selectedId && operation.rowIds.includes(item.id)) || description.rows.find(item => operation.rowIds.includes(item.id)));
    const destinationIsVessel = operation && ['main_vessel', 'soaking_basin', 'separate_vessel', 'dissolve_vessel', 'filter_station', 'separate_filter', 'collection_vessel'].includes(operation.equipmentId);
    const explicitVesselInstruction = row && row.preparationInstruction !== 'unrecorded';
    carryingDish.visible = (playing || seekMode) && !!row && description.path.length > 1 && (!destinationIsVessel || explicitVesselInstruction && snapshot.preparation === 'decoction');
    if (carryingDish.visible) {
      carryingDish.userData.materialId = row.id;
      carryingDish.userData.operationId = operation.id;
      carryingDish.userData.equipmentId = operation.equipmentId || null;
      const scaled = progress * snapshot.operations.length;
      const index = Math.min(snapshot.operations.length - 1, Math.floor(scaled));
      const previous = snapshot.operations.slice(0, index).reverse().find(item => item.rowIds.includes(row.id));
      const startStation = STATIONS.find(station => station.id === (previous?.station || 'materials'));
      const endStation = STATIONS.find(station => station.id === operation.station);
      const start = previous?.equipmentId && equipmentObjects.get(previous.equipmentId)?.anchor || new THREE.Vector3(startStation.x, 1.2, startStation.z);
      const end = operation.equipmentId && equipmentObjects.get(operation.equipmentId)?.anchor || new THREE.Vector3(endStation.x, 1.2, endStation.z);
      const t = progress === 1 ? 1 : scaled - index;
      carryingDish.position.set(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * .6, start.z + (end.z - start.z) * t);
      carryingDish.rotation.y = t * .45;
    }
  }

  function placeOverlay(node, position, width, height, yOffset = 0) {
    projected.copy(position).project(camera);
    const inView = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
    node.hidden = !inView;
    if (!inView) return;
    const x = clamp((projected.x + 1) * .5 * width, 70, Math.max(70, width - 70));
    const y = clamp((-projected.y + 1) * .5 * height + yOffset, 24, Math.max(24, height - 24));
    node.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
  }

  function projectLabels() {
    if (!renderer || !camera) return;
    const rect = viewport.getBoundingClientRect();
    const active = activeStation();
    for (const station of STATIONS) {
      const node = stationTags.get(station.id);
      if (rect.width < 580 && station.id !== active) {
        node.hidden = true;
        continue;
      }
      placeOverlay(node, new THREE.Vector3(station.x, station.id === 'filtration' ? 2.4 : station.id === 'decoction' ? 2 : .8, station.z), rect.width, rect.height, -12);
    }
    placeOverlay(readout, new THREE.Vector3(-1.7, .5, 2.46), rect.width, rect.height, 30);
    readout.hidden ||= rect.width < 580 && active !== 'weighing';
  }

  function draw() {
    if (disposed || contextLost || !renderer || !container.isConnected) return;
    positionCamera();
    layoutWorkbench();
    renderer.render(scene, camera);
    projectLabels();
    refreshLabels();
  }

  function resized() {
    if (!renderer || disposed) return;
    const rect = viewport.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw();
  }

  function stopLoop() {
    renderer?.setAnimationLoop(null);
    rendering = false;
    lastTime = null;
  }
  function syncLoop() {
    const shouldRun = renderer && playing && visible && !document.hidden && !reducedMotion && !contextLost && !disposed && container.isConnected;
    if (shouldRun && !rendering) {
      rendering = true;
      lastTime = null;
      renderer.setAnimationLoop(loop);
    } else if (!shouldRun && rendering) stopLoop();
  }
  function loop(time) {
    if (disposed || !container.isConnected) return stopLoop();
    if (lastTime !== null) progress = clamp(progress + Math.min(time - lastTime, 100) / durationMs, 0, 1);
    lastTime = time;
    draw();
    if (time - lastCallback > 90 || progress === 1) {
      lastCallback = time;
      options.onProgress?.(progress);
    }
    if (progress === 1) setPlaying(false);
  }
  function setPlaying(next) {
    if (disposed) return;
    const requested = !!next;
    const result = requested && !reducedMotion && !!renderer && !contextLost && description.rows.length > 0 && snapshot.operations.length > 0;
    const changed = result !== playing;
    playing = result;
    if (playing) {
      seekMode = true;
      if (progress === 1) progress = 0;
    }
    root.dataset.playing = String(playing);
    syncLoop();
    draw();
    if (changed || requested !== result) options.onPlayingChange?.(playing);
  }
  function seek(next) {
    if (disposed || !finite(Number(next))) return;
    progress = clamp(Number(next), 0, 1);
    seekMode = true;
    lastTime = null;
    draw();
    refreshLabels();
    options.onProgress?.(progress);
    if (progress === 1 && playing) setPlaying(false);
  }

  function update(next = {}) {
    if (disposed) return;
    const previous = snapshot;
    const previousProgress = progress;
    description = describeWorkstation(next);
    snapshot = description.snapshot;
    if (Object.hasOwn(next, 'selectedId')) selectedId = snapshot.selectedId;
    if (!description.rows.some(row => row.id === selectedId)) selectedId = null;
    progress = Object.hasOwn(next, 'progress') ? snapshot.progress : previousProgress;
    if (snapshot.station !== previous.station) {
      focusedStation = snapshot.station;
      seekMode = false;
    }
    const rowsChanged = JSON.stringify(previous.rows) !== JSON.stringify(snapshot.rows);
    if (rowsChanged) {
      rebuildMaterials();
      updateList();
    }
    refreshSelected();
    refreshLabels();
    draw();
    if (!description.rows.length) setPlaying(false);
    syncLoop();
  }
  function resetCamera() {
    if (disposed) return;
    cameraState.theta = .22;
    cameraState.phi = .88;
    cameraState.distance = 21;
    cameraState.target.set(0, .2, 0);
    draw();
  }
  function showFallback(message) {
    stopLoop();
    playing = false;
    root.dataset.playing = 'false';
    root.classList.add('is-fallback');
    viewport.hidden = true;
    materials.open = true;
    hint.textContent = message || '此裝置無法顯示 3D，工序與原料仍可由清單操作。';
    refreshLabels();
    options.onPlayingChange?.(false);
    options.onFallback?.(hint.textContent);
  }

  function pick(clientX, clientY) {
    if (!renderer || contextLost) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const visibleObjects = pickables.filter(object => {
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
      return true;
    });
    const hit = raycaster.intersectObjects(visibleObjects, false)[0]?.object;
    if (hit?.userData.materialId !== undefined) selectMaterial(hit.userData.materialId);
    else if (hit?.userData.stationId) selectStation(hit.userData.stationId);
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setClearColor(0x17392f);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'ws-scene-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '草藥工序操作台；可用方向鍵旋轉、加減鍵縮放、R 鍵重設視角。下方工序與原料清單提供同一操作。');
    renderer.domElement.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - r');
    renderer.domElement.style.touchAction = 'none';
    viewport.prepend(renderer.domElement);
    root.dataset.renderer = `three-${THREE.REVISION}`;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, .1, 90);
    scene.add(new THREE.HemisphereLight(0xf5f4dc, 0x21483c, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-5, 13, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.normalBias = .04;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd7e8d8, 1.2);
    fill.position.set(9, 7, -6);
    scene.add(fill);
    const floor = mesh(scene, new THREE.PlaneGeometry(80, 80), 0x17392f, [0, -2.42, 0], { roughness: 1 });
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    buildWorkbench();

    const canvas = renderer.domElement;
    let drag = null;
    let pinchDistance = null;
    listen(canvas, 'pointerdown', event => {
      if (event.button && event.pointerType === 'mouse') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture?.(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
      if (pointers.size === 2) {
        const pair = [...pointers.values()];
        pinchDistance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      }
    });
    listen(canvas, 'pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const pair = [...pointers.values()];
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (pinchDistance > 0 && distance > 0) cameraState.distance = clamp(cameraState.distance * pinchDistance / distance, 11, 34);
        pinchDistance = distance;
        if (drag) drag.moved = true;
      } else if (drag) {
        cameraState.theta -= (event.clientX - drag.x) * .006;
        cameraState.phi = clamp(cameraState.phi - (event.clientY - drag.y) * .006, .34, 1.38);
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5;
        drag.x = event.clientX;
        drag.y = event.clientY;
      }
      draw();
    });
    const releasePointer = event => {
      const solo = pointers.size === 1;
      pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && solo && drag && !drag.moved) pick(event.clientX, event.clientY);
      if (!pointers.size) drag = null;
      pinchDistance = null;
    };
    listen(canvas, 'pointerup', releasePointer);
    listen(canvas, 'pointercancel', releasePointer);
    listen(canvas, 'lostpointercapture', releasePointer);
    listen(canvas, 'wheel', event => {
      event.preventDefault();
      cameraState.distance = clamp(cameraState.distance * Math.exp(clamp(event.deltaY, -200, 200) * .0018), 11, 34);
      draw();
    }, { passive: false });
    listen(canvas, 'keydown', event => {
      let handled = true;
      if (event.key === 'ArrowLeft') cameraState.theta += .1;
      else if (event.key === 'ArrowRight') cameraState.theta -= .1;
      else if (event.key === 'ArrowUp') cameraState.phi = clamp(cameraState.phi - .07, .34, 1.38);
      else if (event.key === 'ArrowDown') cameraState.phi = clamp(cameraState.phi + .07, .34, 1.38);
      else if (event.key === '+' || event.key === '=') cameraState.distance = clamp(cameraState.distance - 1, 11, 34);
      else if (event.key === '-') cameraState.distance = clamp(cameraState.distance + 1, 11, 34);
      else if (event.key.toLowerCase() === 'r') resetCamera();
      else handled = false;
      if (handled) {
        event.preventDefault();
        draw();
      }
    });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      showFallback('3D 暫時中斷；工序與原料清單仍可操作。');
    });
    listen(canvas, 'webglcontextrestored', () => {
      contextLost = false;
      root.classList.remove('is-fallback');
      viewport.hidden = false;
      hint.textContent = '拖曳旋轉 · 滾輪／雙指縮放 · 點選器具或原料';
      resized();
    });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resized);
      resizeObserver.observe(viewport);
    } else listen(window, 'resize', resized);
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(entries => {
        visible = entries[0]?.isIntersecting !== false;
        syncLoop();
      }, { threshold: .01 });
      intersectionObserver.observe(root);
    }
    listen(document, 'visibilitychange', syncLoop);
    listen(window, 'pagehide', () => { visible = false; syncLoop(); });
    listen(window, 'pageshow', () => { visible = true; syncLoop(); });
    if (media) {
      const changed = event => {
        reducedMotion = event.matches;
        if (reducedMotion) setPlaying(false);
        syncLoop();
        refreshLabels();
      };
      if (media.addEventListener) listen(media, 'change', changed);
      else {
        media.addListener(changed);
        cleanups.push(() => media.removeListener(changed));
      }
    }
    resized();
  } catch (error) {
    renderer?.setAnimationLoop(null);
    renderer?.dispose();
    renderer?.domElement.remove();
    renderer = null;
    root.dataset.renderer = 'fallback';
    showFallback('此裝置無法顯示 3D；可由工序與原料清單操作同一工作台。');
  }
  updateList();
  refreshLabels();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    cleanups.forEach(cleanup => cleanup());
    pointers.clear();
    if (scene) releaseObject(scene);
    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    materialObjects = [];
    stationObjects.clear();
    equipmentObjects.clear();
    pickables.length = 0;
    root.remove();
  }
  return { update, setPlaying, seek, resetCamera, focusStation, dispose };
}

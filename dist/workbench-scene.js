import * as THREE from './vendor/three.module.js';

const GOLD = 0xcab37a;
const MAX_VISIBLE_NODES = 48;
const STAGES = { select: '選取原料', quantity: '確定量', process: '安排流程', structure: '動態結構' };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Amounts and unknowns use one declared basis; gram gaps are never treated as zero. */
export function describeSceneAmounts(snapshot = {}) {
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const basis = snapshot.basis === 'grams' ? 'grams' : 'research';
  const key = basis === 'grams' ? 'grams' : 'ratio';
  const complete = rows.length > 0 && rows.every(row => validAmount(row[key]));
  const total = complete ? rows.reduce((sum, row) => sum + row[key], 0) : null;
  return {
    basis, complete, total,
    label: basis === 'grams' ? '實錄克數' : '研究份數',
    note: !rows.length ? '先選取原料，建立你的配伍結構。' : complete
      ? `節點大小對應${basis === 'grams' ? '實錄克數' : '研究份數'}的相對佔比；極小節點保留可見大小。`
      : basis === 'grams' ? '克數尚未齊，所有節點暫以等大空心呈現。' : '份數尚未齊，所有節點暫以等大空心呈現。',
    rows: rows.map(row => ({
      ...row,
      value: validAmount(row[key]) ? row[key] : null,
      share: complete ? row[key] / total : null,
      radius: complete ? clamp(1.1 * Math.cbrt(row[key] / total), .22, .82) : .36,
      unknownSize: !complete,
      amountText: validAmount(row[key]) ? `${row[key]} ${basis === 'grams' ? 'g' : '份'}` : '量待填'
    }))
  };
}

function natureColor(group) {
  const text = String(group || '').toLowerCase();
  if (/hot|warm|溫|温|熱|热/.test(text)) return 0xda9863;
  if (/cold|cool|涼|凉|寒/.test(text)) return 0x8eb8ca;
  if (/neutral|平/.test(text)) return 0xc4c78b;
  return 0x9da99e;
}

function element(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

function normalizedSnapshot(snapshot = {}) {
  return {
    rows: Array.isArray(snapshot.rows) ? snapshot.rows.map(row => ({ ...row })) : [],
    basis: snapshot.basis === 'grams' ? 'grams' : 'research',
    stage: Object.hasOwn(STAGES, snapshot.stage) ? snapshot.stage : 'select',
    processSteps: Array.isArray(snapshot.processSteps) ? snapshot.processSteps.map(step => ({ ...step })) : [],
    progress: Number.isFinite(snapshot.progress) ? clamp(snapshot.progress, 0, 1) : 0,
    selectedId: snapshot.selectedId == null ? null : String(snapshot.selectedId)
  };
}

/** A bounded diagram: connector lines encode membership in this formula, not chemical interactions. */
export function mountWorkbenchScene(container, options = {}) {
  if (!container || typeof container.append !== 'function') throw new TypeError('A scene container is required.');
  const root = element('div', 'wb-scene', container);
  const stageHost = element('div', 'wb-scene-viewport', root);
  const overlay = element('div', 'wb-scene-labels', stageHost);
  const centerLabel = element('div', 'wb-scene-center', overlay);
  element('span', '', centerLabel, '配伍核心');
  const centerCount = element('small', '', centerLabel, '等待選材');
  const header = element('div', 'wb-scene-readout', root);
  const title = element('span', 'wb-scene-stage', header);
  const stepLabel = element('span', 'wb-scene-step', header);
  const sizeNote = element('p', 'wb-scene-size-note', root);
  const legend = element('div', 'wb-scene-legend', root);
  legend.setAttribute('aria-label', '顏色表示來源記載的寒熱分類，並非實測');
  for (const [name, color] of [['溫熱', '#da9863'], ['寒涼', '#8eb8ca'], ['平', '#c4c78b'], ['未知', '#9da99e']]) {
    const item = element('span', '', legend);
    element('i', '', item).style.background = color;
    element('span', '', item, name);
  }
  const staticNote = element('span', 'wb-scene-motion-note', legend);
  const overflowNote = element('p', 'wb-scene-overflow', root);
  const controlsHint = element('p', 'wb-scene-hint', root, '拖曳旋轉 · 滾輪／雙指縮放 · 點選節點查看原料');
  const caution = element('p', 'wb-scene-caution', root, '線條表示同方結構；動畫是流程示意，並非化學結構或煎出實測。');
  const materialDetails = element('details', 'wb-scene-materials', root);
  const materialSummary = element('summary', '', materialDetails, '全部原料');
  const accessibleList = element('div', 'wb-scene-accessible-list', materialDetails);
  accessibleList.setAttribute('aria-label', '結構中的全部原料');

  let snapshot = normalizedSnapshot(options.snapshot);
  let selectedId = options.selectedId == null ? snapshot.selectedId : String(options.selectedId);
  let amounts = describeSceneAmounts(snapshot);
  let progress = snapshot.progress;
  let playing = false;
  let disposed = false;
  let visible = true;
  let rendering = false;
  let lastTime = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let diagram = null;
  let resizeObserver = null;
  let intersectionObserver = null;
  let contextLost = false;
  let nodeEntries = [];
  let processEntries = [];
  const cleanups = [];
  const reusablePosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Map();
  const cameraState = { theta: .13, phi: 1.02, distance: 11.5 };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = !!media?.matches;
  const durationMs = clamp(Number(options.durationMs) || 16000, 5000, 45000);
  let lastCallback = 0;

  function listen(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  }

  function select(id) {
    selectedId = String(id);
    refreshSelected();
    if (typeof options.onSelect === 'function') options.onSelect(id);
    draw();
  }

  function refreshSelected() {
    for (const entry of nodeEntries) {
      const active = String(entry.row.id) === selectedId;
      entry.label.classList.toggle('is-selected', active);
      entry.label.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (entry.halo) entry.halo.visible = active;
      if (entry.line) entry.line.material.opacity = active ? .85 : .3;
    }
    for (const button of accessibleList.querySelectorAll('button')) {
      const active = button.dataset.sceneId === selectedId;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function releaseObject(object) {
    const geometries = new Set();
    const materials = new Set();
    object.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    object.removeFromParent();
  }

  function createLine(start, end, color = GOLD, opacity = .3, dashed = false) {
    const positions = new Float32Array(24 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: .16, gapSize: .12 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.Line(geometry, material);
    updateLine(line, start, end);
    return line;
  }

  function updateLine(line, start, end) {
    const attr = line.geometry.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      const t = i / (attr.count - 1);
      attr.setXYZ(i, start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * .2,
        start.z + (end.z - start.z) * t);
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    if (line.material.isLineDashedMaterial) line.computeLineDistances();
  }

  function buildDiagram() {
    for (const entry of nodeEntries) entry.label.remove();
    nodeEntries = [];
    processEntries = [];
    if (diagram) releaseObject(diagram);
    if (!scene) return;
    diagram = new THREE.Group();
    scene.add(diagram);

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.57, 1), new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: .84 }));
    core.position.y = .12;
    diagram.add(core);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(.35, 16, 10), new THREE.MeshStandardMaterial({ color: 0x4b8070, emissive: 0x204235, roughness: .35, metalness: .3 }));
    inner.position.y = .12;
    diagram.add(inner);
    for (const radius of [1.15, 2.45, 3.65]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .008, 4, 96), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: radius === 2.45 ? .34 : .15 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -.6;
      diagram.add(ring);
    }

    const visibleRows = amounts.rows.slice(0, MAX_VISIBLE_NODES);
    visibleRows.forEach((row, index) => {
      const label = element('button', 'wb-scene-label', overlay);
      label.type = 'button';
      label.setAttribute('aria-label', `${row.name}，${row.amountText}，${row.processingLabel || '炮製未選'}`);
      element('span', 'wb-scene-node-name', label, row.name || row.id);
      element('small', '', label, row.amountText);
      label.addEventListener('click', () => select(row.id));
      const color = natureColor(row.natureGroup);
      const group = new THREE.Group();
      diagram.add(group);
      const geometry = new THREE.IcosahedronGeometry(row.radius, 1);
      const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .34, metalness: .18, transparent: true, opacity: row.unknownSize ? .1 : .92 }));
      body.userData.sceneId = row.id;
      group.add(body);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: row.unknownSize ? .92 : .45 }));
      group.add(edges);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(row.radius * 1.3, .023, 5, 40), new THREE.MeshBasicMaterial({ color: 0xf6dd99 }));
      halo.rotation.x = Math.PI / 2;
      halo.visible = String(row.id) === selectedId;
      group.add(halo);
      const origin = new THREE.Vector3(0, .12, 0);
      const line = createLine(origin, origin, color, .3, row.unknownSize);
      diagram.add(line);
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(.047, 6, 4), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: .8 }));
      diagram.add(pulse);
      nodeEntries.push({ row, index, group, body, halo, line, pulse, label, color });
    });

    // A small process path encodes order only; arbitrary recorded minutes never alter quantities.
    const steps = snapshot.processSteps.slice(0, 12);
    steps.forEach((step, index) => {
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.1, 0), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: .25 }));
      const x = (index - (steps.length - 1) / 2) * .32;
      orb.position.set(x, -1.02, 1.6);
      diagram.add(orb);
      processEntries.push({ step, orb, index });
    });
    refreshSelected();
  }

  function updateText() {
    materialSummary.textContent = `全部原料 · ${amounts.rows.length} 味`;
    title.textContent = `${STAGES[snapshot.stage]} · ${amounts.rows.length} 味`;
    const steps = snapshot.processSteps;
    const index = steps.length ? Math.min(steps.length - 1, Math.floor(progress * steps.length)) : -1;
    const current = index >= 0 ? steps[index] : null;
    stepLabel.textContent = current ? `${index + 1}/${steps.length} ${current.label}${validAmount(current.durationMinutes) ? ` · 實錄 ${current.durationMinutes} 分` : ''}` : '等待安排流程';
    centerCount.textContent = amounts.rows.length ? `${amounts.rows.length} 味 · ${Math.round(progress * 100)}%` : '等待選材';
    sizeNote.textContent = amounts.note;
    staticNote.textContent = reducedMotion ? '減少動態：拖動進度查看' : '';
    overflowNote.textContent = amounts.rows.length > MAX_VISIBLE_NODES ? `3D 顯示前 ${MAX_VISIBLE_NODES} 味；全部 ${amounts.rows.length} 味可由下方清單選取。` : '';
    overflowNote.hidden = !overflowNote.textContent;
  }

  function updateAccessibleList() {
    accessibleList.replaceChildren();
    for (const row of amounts.rows) {
      const button = element('button', '', accessibleList, `${row.name || row.id} · ${row.amountText} · ${row.processingLabel || '炮製未選'}`);
      button.type = 'button';
      button.dataset.sceneId = String(row.id);
      button.addEventListener('click', () => select(row.id));
    }
    refreshSelected();
  }

  function positionCamera() {
    if (!camera) return;
    const { theta, phi, distance } = cameraState;
    camera.position.set(distance * Math.sin(phi) * Math.sin(theta), distance * Math.cos(phi), distance * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(0, -.08, 0);
    camera.updateMatrixWorld();
  }

  function layoutDiagram() {
    const count = Math.max(1, nodeEntries.length);
    const evolution = progress * Math.PI * .38;
    for (const entry of nodeEntries) {
      const { index, group, row } = entry;
      const entryProgress = clamp(progress * 1.4 - index / count * .4, 0, 1);
      const eased = entryProgress * entryProgress * (3 - 2 * entryProgress);
      const angle = index / count * Math.PI * 2 - Math.PI / 2 + evolution;
      const layer = count > 12 ? index % 2 : 0;
      const radius = 3.55 - eased * .7 + layer * .45;
      const height = .36 + Math.sin(angle * 2) * .35 + (layer ? .85 : 0);
      group.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      group.rotation.y = angle * .35;
      updateLine(entry.line, new THREE.Vector3(0, .12, 0), group.position);
      const pulseT = reducedMotion ? .5 : (progress * 3 + index * .21) % 1;
      entry.pulse.position.copy(group.position).multiplyScalar(pulseT);
      entry.pulse.position.y += .12 * (1 - pulseT);
      entry.pulse.visible = playing && !reducedMotion && entryProgress > 0;
      entry.halo.rotation.z = progress * Math.PI * 2;
      entry.body.userData.sceneId = row.id;
    }
    for (const entry of processEntries) {
      const current = Math.min(processEntries.length - 1, Math.floor(progress * processEntries.length));
      entry.orb.material.opacity = entry.index <= current ? .95 : .25;
      entry.orb.scale.setScalar(entry.index === current ? 1.35 : 1);
    }
  }

  function projectLabels() {
    if (!camera || !renderer) return;
    const rect = stageHost.getBoundingClientRect();
    const labelOffsets = [];
    for (const entry of nodeEntries) {
      reusablePosition.copy(entry.group.position);
      reusablePosition.y += entry.row.radius + .18;
      reusablePosition.project(camera);
      const onScreen = reusablePosition.z >= -1 && reusablePosition.z <= 1 && Math.abs(reusablePosition.x) < 1.2 && Math.abs(reusablePosition.y) < 1.2;
      entry.label.hidden = !onScreen;
      if (!onScreen) continue;
      const x = clamp((reusablePosition.x + 1) * .5 * rect.width, 78, Math.max(78, rect.width - 78));
      let y = clamp((-reusablePosition.y + 1) * .5 * rect.height, 30, Math.max(30, rect.height - 50));
      // Keep projected labels legible without continuously changing DOM dimensions.
      for (const offset of labelOffsets) if (Math.abs(offset.x - x) < 144 && Math.abs(offset.y - y) < 46) y = clamp(y + 48, 30, Math.max(30, rect.height - 30));
      labelOffsets.push({ x, y });
      entry.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
      entry.label.style.zIndex = String(Math.round((1 - reusablePosition.z) * 1000) + (String(entry.row.id) === selectedId ? 100 : 0));
    }
    reusablePosition.set(0, .12, 0).project(camera);
    centerLabel.style.left = `${((reusablePosition.x + 1) * .5 * rect.width).toFixed(1)}px`;
    centerLabel.style.top = `${((-reusablePosition.y + 1) * .5 * rect.height + 35).toFixed(1)}px`;
  }

  function draw() {
    if (disposed || contextLost || !renderer || !container.isConnected) return;
    positionCamera();
    layoutDiagram();
    renderer.render(scene, camera);
    projectLabels();
    updateText();
  }

  function resized() {
    if (disposed || !renderer) return;
    const rect = stageHost.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw();
  }

  function emitProgress() {
    if (typeof options.onProgress === 'function') options.onProgress(progress);
  }

  function loop(time) {
    if (disposed || !container.isConnected) {
      stopLoop();
      return;
    }
    if (lastTime !== null) progress = clamp(progress + Math.min(time - lastTime, 100) / durationMs, 0, 1);
    lastTime = time;
    draw();
    if (time - lastCallback > 90 || progress === 1) {
      lastCallback = time;
      emitProgress();
    }
    if (progress === 1) setPlaying(false);
  }

  function stopLoop() {
    if (renderer) renderer.setAnimationLoop(null);
    rendering = false;
    lastTime = null;
  }

  function syncLoop() {
    const shouldRun = !!renderer && playing && visible && !document.hidden && !reducedMotion && !contextLost && !disposed && container.isConnected;
    if (shouldRun && !rendering) {
      rendering = true;
      lastTime = null;
      renderer.setAnimationLoop(loop);
    } else if (!shouldRun && rendering) stopLoop();
  }

  function setPlaying(next) {
    if (disposed) return;
    const requested = !!next;
    const changed = playing !== (requested && !reducedMotion && !!renderer && amounts.rows.length > 0);
    playing = requested && !reducedMotion && !!renderer && amounts.rows.length > 0;
    if (playing && progress >= 1) progress = 0;
    root.dataset.playing = playing ? 'true' : 'false';
    syncLoop();
    draw();
    if (changed || requested !== playing) options.onPlayingChange?.(playing);
  }

  function seek(value) {
    if (disposed) return;
    const next = Number(value);
    progress = Number.isFinite(next) ? clamp(next, 0, 1) : progress;
    lastTime = null;
    draw();
    updateText();
    emitProgress();
    if (progress === 1 && playing) setPlaying(false);
  }

  function update(next = {}) {
    if (disposed) return;
    const previous = snapshot;
    const previousProgress = progress;
    snapshot = normalizedSnapshot(next);
    amounts = describeSceneAmounts(snapshot);
    if (Object.hasOwn(next, 'selectedId')) selectedId = snapshot.selectedId;
    progress = Object.hasOwn(next, 'progress') ? snapshot.progress : previousProgress;
    const structuralChanged = JSON.stringify(previous.rows) !== JSON.stringify(snapshot.rows) || previous.basis !== snapshot.basis || JSON.stringify(previous.processSteps) !== JSON.stringify(snapshot.processSteps);
    if (structuralChanged) {
      buildDiagram();
      updateAccessibleList();
    }
    refreshSelected();
    updateText();
    draw();
    if (!amounts.rows.length) setPlaying(false);
    syncLoop();
  }

  function resetCamera() {
    cameraState.theta = .13;
    cameraState.phi = 1.02;
    cameraState.distance = 11.5;
    draw();
  }

  function showFallback(message) {
    stopLoop();
    playing = false;
    root.dataset.playing = 'false';
    root.classList.add('is-fallback');
    stageHost.hidden = true;
    materialDetails.open = true;
    controlsHint.textContent = message || '此裝置無法顯示 3D；可從原料清單查看同一結構。';
    updateText();
    options.onPlayingChange?.(false);
    options.onFallback?.(message);
  }

  function pick(clientX, clientY) {
    if (!renderer || contextLost) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(nodeEntries.map(entry => entry.body), false)[0];
    if (hit) select(hit.object.userData.sceneId);
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setClearColor(0x122f29, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'wb-scene-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.touchAction = 'none';
    stageHost.prepend(renderer.domElement);
    root.dataset.renderer = `three-${THREE.REVISION}`;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(43, 1, .1, 40);
    scene.add(new THREE.AmbientLight(0xf7ecd4, 1.75));
    const light = new THREE.DirectionalLight(0xffffff, 2.6);
    light.position.set(3, 6, 4);
    scene.add(light);
    const goldLight = new THREE.PointLight(0xcbb879, 8, 10);
    goldLight.position.set(0, 2, 0);
    scene.add(goldLight);

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
        if (pinchDistance > 0 && distance > 0) cameraState.distance = clamp(cameraState.distance * pinchDistance / distance, 6.5, 17);
        pinchDistance = distance;
        if (drag) drag.moved = true;
      } else if (drag) {
        cameraState.theta -= (event.clientX - drag.x) * .006;
        cameraState.phi = clamp(cameraState.phi - (event.clientY - drag.y) * .006, .38, 1.52);
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5;
        drag.x = event.clientX;
        drag.y = event.clientY;
      }
      draw();
    });
    const releasePointer = event => {
      const wasSolo = pointers.size === 1;
      pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && wasSolo && drag && !drag.moved) pick(event.clientX, event.clientY);
      if (pointers.size === 0) drag = null;
      pinchDistance = null;
    };
    listen(canvas, 'pointerup', releasePointer);
    listen(canvas, 'pointercancel', releasePointer);
    listen(canvas, 'lostpointercapture', releasePointer);
    listen(canvas, 'wheel', event => {
      event.preventDefault();
      cameraState.distance = clamp(cameraState.distance * Math.exp(clamp(event.deltaY, -200, 200) * .0018), 6.5, 17);
      draw();
    }, { passive: false });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      showFallback('3D 顯示暫時中斷；原料清單與流程記錄仍可使用。');
    });
    listen(canvas, 'webglcontextrestored', () => {
      contextLost = false;
      root.classList.remove('is-fallback');
      stageHost.hidden = false;
      controlsHint.textContent = '拖曳旋轉 · 滾輪／雙指縮放 · 點選節點查看原料';
      resized();
    });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resized);
      resizeObserver.observe(stageHost);
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
        updateText();
      };
      if (media.addEventListener) listen(media, 'change', changed);
      else {
        media.addListener(changed);
        cleanups.push(() => media.removeListener(changed));
      }
    }
    buildDiagram();
    resized();
  } catch (error) {
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
      renderer = null;
    }
    root.dataset.renderer = 'fallback';
    showFallback('此裝置無法顯示 3D；可從原料清單查看同一結構。');
  }
  updateAccessibleList();
  updateText();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    for (const cleanup of cleanups) cleanup();
    pointers.clear();
    if (scene) releaseObject(scene);
    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    nodeEntries = [];
    processEntries = [];
    root.remove();
  }

  return { update, setPlaying, seek, resetCamera, dispose };
}

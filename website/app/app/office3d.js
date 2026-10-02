/* AGENT 0 — office3d.js : the 3D office, the station seen as a glass tower at night.

   Every room of the station is a floor (the spawn room is the ground floor, HQ), and every agent sits at a desk
   on the floor of the room their desk is in. A desk's screen is ON while that agent is really running (the same
   truth the CREW rail uses, StationUI.isAgentRunning) and OFF when it is idle. Clicking a person opens their
   AGENT DOSSIER, exactly as clicking them in the classic view does.

   Two halves, like livewatch.js:
     • a PURE core (Office3D.plan / titleOf / tintFor) that turns rooms + roster + seating into floors. No DOM,
       no THREE, so it is unit-testable under node.
     • a browser shell (Office3D.mount) that draws the tower with three.js on its own canvas laid over #stage.

   The classic World keeps running underneath, untouched: it still owns the event stream, the routing plan and
   every hit-test the rest of the app reads. This view only reads, and the 3D / CLASSIC switch hides one or the
   other. Nothing here emits on the bus or writes app state. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Office3D = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VIEW_KEY = 'agent0.view';            // '3d' | 'classic' — a per-viewer convenience
  const PALETTE = ['#5B8CFF', '#FF8A3D', '#FF5A5F', '#2DD4BF', '#A78BFA', '#F5C451', '#4ADE95', '#F472B6'];
  const KEYWORD_TINTS = [
    [/e-?commerce|shop|store/i, '#FF8A3D'],
    [/youtube|video|channel/i, '#FF5A5F'],
    [/real ?estate|property/i, '#2DD4BF'],
    [/design|studio/i, '#A78BFA']
  ];

  function str(s, max) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return max && s.length > max ? s.slice(0, max - 1) + '…' : s; }

  // The agent's title: the preset writes "You are ORION, E-Commerce Director in the E-Commerce Lab at …" into
  // its identity doc; otherwise the class name; otherwise its role.
  function titleOf(agent, classes) {
    agent = agent || {};
    const docs = agent.docs || {};
    const m = /^\s*You are [^,]{1,40},\s*([^.]{2,60}?)\s+(?:in|at|for)\s+the\b/i.exec(String(docs.identity || ''));
    if (m) return str(m[1], 40);
    const cls = agent.specialtyId && classes ? classes(agent.specialtyId) : null;
    if (cls && cls.name) return str(cls.name, 40);
    return agent.role === 'orchestrator' || agent.id === 'agent' ? 'Overseer' : 'Specialist';
  }

  function tintFor(name, index) {
    for (const [re, c] of KEYWORD_TINTS) if (re.test(String(name || ''))) return c;
    return PALETTE[Math.abs(index | 0) % PALETTE.length];
  }

  /* rooms: [{id, kind, name}] in station order. agents: roster entries. roomOf(agentId) -> room id or null.
     Returns floors bottom-up: the spawn room first (HQ), then the others in station order; corridors are not
     floors. An agent with no room sits on the ground floor. Empty non-ground floors are kept (a lab you have
     not staffed yet is still a floor of the building). */
  function plan(rooms, agents, roomOf, opts) {
    opts = opts || {};
    const list = (rooms || []).filter(r => r && r.id && r.kind !== 'corridor');
    if (!list.length) list.push({ id: '_hq', kind: 'hab', name: 'HQ' });
    const spawn = list.find(r => r.id === opts.spawnRoomId) || list[0];
    const ordered = [spawn].concat(list.filter(r => r !== spawn));
    const floors = ordered.map((r, i) => ({
      id: r.id, index: i, name: str(String(r.name || (i ? 'FLOOR ' + i : 'HQ')).replace(/\s+LAB$/i, ''), 32), ground: i === 0,
      tint: i === 0 ? '#5B8CFF' : tintFor(r.name, i), agents: []
    }));
    const byId = new Map(floors.map(f => [f.id, f]));
    for (const a of agents || []) {
      if (!a || !a.id) continue;
      const rid = roomOf ? roomOf(a.id) : null;
      const f = (rid != null && byId.get(rid)) || floors[0];
      f.agents.push({ id: a.id, name: str(a.name || a.id, 18), title: titleOf(a, opts.classes) });
    }
    return floors;
  }

  // a stable signature, so the shell rebuilds the tower only when the floors or the people on them change
  function signature(floors) {
    return floors.map(f => f.id + ':' + f.name + '[' + f.agents.map(a => a.id + '/' + a.name + '/' + a.title).join(',') + ']').join('|');
  }

  /* ---------------- browser shell ---------------- */
  let mounted = null;

  function readView() { try { return localStorage.getItem(VIEW_KEY) === 'classic' ? 'classic' : '3d'; } catch (e) { return '3d'; } }
  function writeView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* private window: the choice lasts this session */ } }

  function mount(host) {
    if (mounted || typeof document === 'undefined') return mounted;
    const THREE = (typeof window !== 'undefined') ? window.THREE : null;
    const wrap = host && host.wrap;
    if (!THREE || !THREE.OrbitControls || !wrap) return null;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { return null; }   // no WebGL: stay classic

    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const cv = renderer.domElement;
    cv.id = 'stage3d';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'The office in 3D: each floor is a room, a lit screen means that agent is working');
    wrap.insertBefore(cv, wrap.querySelector('#stage-summary') || null);

    const ui = document.createElement('div');
    ui.className = 'o3d-ui';
    ui.innerHTML =
      '<div class="o3d-switch" role="group" aria-label="Station view">' +
        '<button type="button" data-view="3d">3D</button><button type="button" data-view="classic">CLASSIC</button></div>' +
      '<button type="button" class="o3d-back" hidden>← Whole building</button>' +
      '<div class="o3d-floors" role="group" aria-label="Floors"></div>' +
      '<div class="o3d-legend"><span><i class="on"></i>Screen on: working</span><span><i></i>Screen off: idle</span></div>' +
      '<div class="o3d-labels" aria-hidden="true"></div>' +
      '<div class="o3d-tip" hidden></div>';
    wrap.appendChild(ui);
    const $ = s => ui.querySelector(s);
    const floorsEl = $('.o3d-floors'), labelsEl = $('.o3d-labels'), tip = $('.o3d-tip'), backBtn = $('.o3d-back');

    /* ---- scene, camera, lights ---- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0B0E14);
    scene.fog = new THREE.Fog(0x1A2140, 90, 330);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 900);
    const controls = new THREE.OrbitControls(camera, cv);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 6; controls.maxDistance = 160;
    scene.add(new THREE.HemisphereLight(0x8EA2C8, 0x0B0E14, 0.55));
    const moon = new THREE.DirectionalLight(0xBFD0FF, 0.55);
    moon.position.set(18, 40, 24); moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.bias = -0.0006;
    scene.add(moon);
    const warm = new THREE.PointLight(0xFFC890, 0.35, 70); warm.position.set(-14, 8, 14); scene.add(warm);

    const std = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.8 : r, metalness: m || 0 });
    const box = (w, h, d, mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.castShadow = true; o.receiveShadow = true; return o; };
    const M = {
      slab: std(0xE6C998, 0.85), carpet: std(0xD9BA86, 1), core: std(0xD8BE8E, 0.9),
      desk: std(0x3A4250, 0.6), leg: std(0x5A6372, 0.4, 0.4), dark: std(0x0E1117, 0.4),
      chair: std(0x2A303C, 0.8), kb: std(0x4A5363, 0.6), pot: std(0x2E3542, 0.9), leaf: std(0x3F8F5E, 0.9),
      frame: std(0x3A4456, 0.5, 0.5), gold: new THREE.MeshStandardMaterial({ color: 0xC9A86A, roughness: 0.3, metalness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9DB7E8, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.3, depthWrite: false }),
      rail: new THREE.MeshStandardMaterial({ color: 0x9DB7E8, transparent: true, opacity: 0.25, depthWrite: false }),
      win: new THREE.MeshBasicMaterial({ color: 0xFFD7A1 }), lamp: new THREE.MeshBasicMaterial({ color: 0xFFD08A })
    };
    const screenOff = new THREE.MeshStandardMaterial({ color: 0x12151C, roughness: 0.25, metalness: 0.2 });
    const GLOW = (function () {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
    })();
    function screenTexture(css) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#0A1418'; g.fillRect(0, 0, 256, 256);
      for (let y = 8; y < 256; y += 14) {
        const ind = (y * 7 % 5) * 10, w = 40 + ((y * 37) % 150);
        g.fillStyle = css; g.fillRect(12 + ind, y, w * 0.35, 6);
        g.fillStyle = '#BDF5DA'; g.globalAlpha = 0.85; g.fillRect(16 + ind + w * 0.35, y, w * 0.6, 6); g.globalAlpha = 1;
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 0.55); t.encoding = THREE.sRGBEncoding; return t;
    }
    const SKIN = [0xF1C9A5, 0xD9A27A, 0xA86B47, 0x7A4A2E, 0xE8B894];
    const HAIR = [0x2B2420, 0x5A3A24, 0x1C1C1C, 0x8C6239, 0xC9A36B, 0x3E2F2A];
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    /* ---- the city around the tower (built once) ---- */
    const world = { shimmer: [], blinkers: [] };
    (function buildWorld() {
      const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x060A16) }, mid: { value: new THREE.Color(0x15224A) }, low: { value: new THREE.Color(0x3B3557) } },
        vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform vec3 top;uniform vec3 mid;uniform vec3 low;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.18?mix(mid,top,smoothstep(0.18,0.8,h)):mix(low,mid,smoothstep(-0.02,0.18,h));gl_FragColor=vec4(c,1.0);}'
      }));
      scene.add(sky);
      const sp = []; for (let i = 0; i < 700; i++) { const t = rnd() * Math.PI * 2, u = 0.25 + rnd() * 0.75, r = 360; sp.push(r * Math.cos(t) * Math.sqrt(1 - u * u), r * u, r * Math.sin(t) * Math.sqrt(1 - u * u)); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xDDE6FF, size: 1.3, sizeAttenuation: false, fog: false })));
      const moonBall = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xF3EFDF, fog: false }));
      moonBall.position.set(-150, 140, -260); scene.add(moonBall);
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), std(0x142019, 1)); grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass);
      const plaza = new THREE.Mesh(new THREE.BoxGeometry(60, 0.1, 34), std(0x1C222C, 0.95)); plaza.position.set(0, 0.05, 2); plaza.receiveShadow = true; scene.add(plaza);
      const riverZ = -46, riverW = 18;
      const riverMat = new THREE.MeshStandardMaterial({ color: 0x1A3F6B, roughness: 0.15, metalness: 0.6, emissive: 0x0A1A33, emissiveIntensity: 0.6 });
      const river = new THREE.Mesh(new THREE.PlaneGeometry(700, riverW), riverMat); river.rotation.x = -Math.PI / 2; river.position.set(0, 0.04, riverZ); scene.add(river);
      const bridge = box(6, 0.6, riverW + 4, std(0x2B3340, 0.7)); bridge.position.set(0, 1.2, riverZ); scene.add(bridge);
      for (let k = 0; k < 6; k++) [-2.8, 2.8].forEach(x => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), M.lamp); l.position.set(x, 2.4, riverZ - riverW / 2 - 1 + k * (riverW + 2) / 5); scene.add(l); });
      for (let i = 0; i < 50; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rnd() * 4, 0.12), new THREE.MeshBasicMaterial({ color: i % 3 ? 0xFFD7A1 : 0xBFD0FF, transparent: true, opacity: 0.3, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set((rnd() - 0.5) * 220, 0.06, riverZ + (rnd() - 0.5) * (riverW - 2)); scene.add(m); world.shimmer.push(m);
      }
      function winTex(s) {
        const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
        g.fillStyle = '#121722'; g.fillRect(0, 0, 64, 128); let r = s; const rr = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
        for (let y = 4; y < 128; y += 8) for (let x = 4; x < 64; x += 10) { const v = rr(); g.fillStyle = v > 0.72 ? (v > 0.92 ? '#BFD7FF' : '#FFCF8A') : '#1B2230'; g.fillRect(x, y, 6, 4); }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; return t;
      }
      const texes = [winTex(7), winTex(91), winTex(433), winTex(1201)], roofMat = std(0x161B25, 0.9);
      for (let i = 0; i < 150; i++) {
        const ang = rnd() * Math.PI * 2, dist = 52 + rnd() * 115;
        const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
        if (Math.abs(z - riverZ) < riverW / 2 + 5) continue;
        if (z > -8 && x > -34) continue;
        const h = z < riverZ ? 10 + rnd() * (dist > 110 ? 38 : 24) : 5 + rnd() * 14, w = 4 + rnd() * 7, d = 4 + rnd() * 7;
        const t = texes[i % texes.length].clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 6)));
        const side = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.8 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, side, side]); b.position.set(x, h / 2, z); scene.add(b);
        if (h > 40) { const bl = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xFF4D4D })); bl.position.set(x, h + 0.6, z); scene.add(bl); world.blinkers.push(bl); }
      }
      const mtn = std(0x1D2638, 1), snow = std(0xC9D3E6, 0.8);
      for (let i = 0; i < 22; i++) {
        const ang = -Math.PI * 0.95 + (i / 21) * Math.PI * 1.1, dist = 200 + rnd() * 50, h = 70 + rnd() * 80, r = 40 + rnd() * 35;
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mtn); m.position.set(Math.cos(ang) * dist, h / 2 - 2, Math.sin(ang) * dist); scene.add(m);
        if (h > 105) { const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, h * 0.28, 7), snow); s.position.set(m.position.x, h - 2 - h * 0.14 + 0.5, m.position.z); scene.add(s); }
      }
      const trunk = std(0x3A2A20, 1), leaves = [std(0x24533A, 0.9), std(0x2E6B45, 0.9)];
      const cone = new THREE.ConeGeometry(1, 2.4, 7), stem = new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6);
      const tree = (x, z, s) => { const t = new THREE.Mesh(stem, trunk); t.position.set(x, 0.4 * s, z); t.scale.setScalar(s); scene.add(t);
        const c = new THREE.Mesh(cone, leaves[(rnd() * 2) | 0]); c.position.set(x, 2 * s, z); c.scale.setScalar(s); c.castShadow = true; scene.add(c); };
      for (let i = 0; i < 70; i++) { const x = (rnd() - 0.5) * 240; if (Math.abs(x) < 5) continue; tree(x, riverZ + (rnd() < 0.5 ? -1 : 1) * (riverW / 2 + 2.5 + rnd() * 5), 0.7 + rnd() * 0.7); }
      world.tree = tree;
    })();

    /* ---- the tower (rebuilt when floors or people change) ---- */
    const FH = 4.6, BASE = 0.6, D = 11;
    let tower = null, floors = [], people = [], floorHits = [], peopleHits = [], labels = [], sig = '';
    let focus = null, hoverFloor = null, hovered = null, fly = null;
    const home = { c: new THREE.Vector3(), t: new THREE.Vector3() };

    function disposeTree(o) {
      o.traverse(n => { if (n.geometry) n.geometry.dispose(); const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
        ms.forEach(m => { if (m && !Object.values(M).includes(m) && m !== screenOff) { if (m.map && m.map !== GLOW) m.map.dispose(); m.dispose(); } }); });
    }

    function label(text, cls) { const d = document.createElement('div'); d.className = cls; d.textContent = text; labelsEl.appendChild(d); return d; }

    function build(plan) {
      if (tower) { scene.remove(tower); disposeTree(tower); }
      labelsEl.textContent = ''; labels = []; people = []; floorHits = []; peopleHits = [];
      tower = new THREE.Group(); scene.add(tower);
      floors = plan;
      const most = Math.max(3, ...plan.map(f => f.agents.length));
      const perRow = Math.ceil(most / 2);
      const W = Math.max(20, perRow * 4.4 + 9.5), HW = (W + 1) / 2;
      const SX = -HW + 2.7, SZ = -1, HH = 2.25;
      const n = plan.length, roofY = BASE + FH * n;

      const lobby = box(W + 1, BASE, D + 1, M.core); lobby.position.y = BASE / 2; tower.add(lobby);
      const core = box(2.2, roofY + 0.6, 3.2, M.core); core.position.set(HW + 1.1, (roofY + 0.6) / 2, -D / 2 + 2); tower.add(core);
      for (let i = 0; i < n; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.2), M.win); w.position.set(HW + 2.21, BASE + i * FH + 1.6, -D / 2 + 2); w.rotation.y = Math.PI / 2; tower.add(w); }

      function slab(parent, th, y, hole) {
        const x0 = -HW, x1 = HW, z0 = -(D + 1) / 2, z1 = (D + 1) / 2;
        if (!hole) { const m = box(W + 1, th, D + 1, M.slab); m.position.y = y; parent.add(m); return; }
        const hx0 = SX - HH, hx1 = SX + HH, hz0 = SZ - HH, hz1 = SZ + HH;
        [[x0, hx0, z0, z1], [hx1, x1, z0, z1], [hx0, hx1, z0, hz0], [hx0, hx1, hz1, z1]].forEach(([a, b, c, d]) => {
          const m = box(b - a, th, d - c, M.slab); m.position.set((a + b) / 2, y, (c + d) / 2); parent.add(m); });
        [[SX, hz0, 2 * HH, 0.06], [SX, hz1, 2 * HH, 0.06]].forEach(([x, z, w, d]) => {
          const g = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.04), M.rail); g.position.set(x, y + th / 2 + 0.5, z); parent.add(g);
          const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.07), M.gold); t.position.set(x, y + th / 2 + 0.95, z); parent.add(t); });
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 2 * HH), M.rail); g.position.set(hx0, y + th / 2 + 0.5, SZ); parent.add(g);
      }

      plan.forEach((fl, li) => {
        const fy = BASE + li * FH, tint = new THREE.Color(fl.tint);
        const f = new THREE.Group(); f.position.y = fy; tower.add(f);
        slab(f, 0.25, 0.125, li > 0);
        const cx0 = SX + HH + 0.3, cx1 = HW - 0.5;
        const carpet = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0, 0.04, D - 1.5), M.carpet); carpet.position.set((cx0 + cx1) / 2, 0.27, 0.2); carpet.receiveShadow = true; f.add(carpet);
        const GH = FH - 0.25, gy = 0.25 + GH / 2;
        [[0, -(D + 1) / 2, W + 1, 0.05], [0, (D + 1) / 2, W + 1, 0.05]].forEach(([x, z, w, d]) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, GH, d), M.glass); g.position.set(x, gy, z); f.add(g); });
        [-HW, HW].forEach(x => { const g = new THREE.Mesh(new THREE.BoxGeometry(0.05, GH, D + 1), M.glass); g.position.set(x, gy, 0); f.add(g); });
        for (let k = 0; k <= 6; k++) { const x = -HW + k * (W + 1) / 6; (k % 6 ? [-(D + 1) / 2] : [-(D + 1) / 2, (D + 1) / 2]).forEach(z => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, GH, 0.08), M.frame); m.position.set(x, gy, z); f.add(m); }); }
        const edgeMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.8) });
        const e1 = new THREE.Mesh(new THREE.BoxGeometry(W + 1.02, 0.07, 0.07), edgeMat); e1.position.set(0, 0.26, (D + 1) / 2 + 0.01); f.add(e1);
        const e2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, D + 1.02), edgeMat); e2.position.set(HW + 0.01, 0.26, 0); f.add(e2);
        // the room's name on a banner hung from the ceiling
        const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 128; const bg = bc.getContext('2d');
        bg.fillStyle = '#171C26'; bg.fillRect(0, 0, 1024, 128); bg.fillStyle = fl.tint; bg.fillRect(0, 0, 12, 128);
        bg.fillStyle = '#E9ECF2'; bg.font = '800 60px "Segoe UI", system-ui, sans-serif'; bg.textBaseline = 'middle'; bg.fillText(fl.name.toUpperCase(), 44, 66);
        const bt = new THREE.CanvasTexture(bc); bt.encoding = THREE.sRGBEncoding;
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.75), new THREE.MeshBasicMaterial({ map: bt })); banner.position.set((cx0 + cx1) / 2, FH - 0.9, -(D + 1) / 2 + 0.15); f.add(banner);
        [[cx1 - 0.6, -D / 2 + 0.9]].forEach(([x, z]) => { const p = box(0.6, 0.6, 0.6, M.pot); p.position.set(x, 0.57, z); f.add(p);
          const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), M.leaf); l.position.set(x, 1.3, z); l.castShadow = true; f.add(l); });
        const hit = new THREE.Mesh(new THREE.BoxGeometry(W + 1, FH, D + 1), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = FH / 2; hit.userData.floor = fl; f.add(hit); floorHits.push(hit);
        fl.y = fy; fl.edgeMat = edgeMat; fl.tintColor = tint;

        const tex = screenTexture(fl.tint); fl.tex = tex;
        const screenOn = new THREE.MeshBasicMaterial({ map: tex });
        const shirt = std(tint, 0.85);
        const cnt = fl.agents.length, front = Math.ceil(cnt / 2), back = cnt - front, slots = [], mid = (cx0 + cx1) / 2;
        const row = (c, z) => { for (let i = 0; i < c; i++) slots.push([mid + (i - (c - 1) / 2) * 4.4, z]); };
        row(back, -1.9); row(front, 2.6);
        fl.agents.forEach((a, i) => {
          const [x, z] = slots[i];
          const g = new THREE.Group(); g.position.set(x, 0.29, z); f.add(g);
          const top = box(2.4, 0.08, 1.1, M.desk); top.position.set(0, 0.78, 0); g.add(top);
          [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]].forEach(([lx, lz]) => { const l = box(0.06, 0.76, 0.06, M.leg); l.position.set(lx, 0.38, lz); g.add(l); });
          const stand = box(0.08, 0.32, 0.08, M.dark); stand.position.set(0, 0.98, -0.3); g.add(stand);
          const frame = box(1.15, 0.7, 0.06, M.dark); frame.position.set(0, 1.42, -0.32); g.add(frame);
          const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.6), screenOff); scr.position.set(0, 1.42, -0.285); g.add(scr);
          const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), new THREE.MeshBasicMaterial({ map: GLOW, color: tint, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
          glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.83, 0.15); g.add(glow);
          const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.3), new THREE.MeshBasicMaterial({ map: GLOW, color: 0xBDF5DA, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
          halo.position.set(0, 1.42, -0.25); g.add(halo);
          const kb = box(0.7, 0.03, 0.22, M.kb); kb.position.set(0, 0.835, 0.1); g.add(kb);
          const seat = box(0.62, 0.08, 0.6, M.chair); seat.position.set(0, 0.5, 0.95); g.add(seat);
          const bk = box(0.62, 0.7, 0.08, M.chair); bk.position.set(0, 0.9, 1.27); g.add(bk);
          const p = new THREE.Group(); p.position.set(0, 0, 0.9); g.add(p);
          const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.62, 16), shirt); torso.position.y = 0.86; torso.castShadow = true; p.add(torso);
          const skin = std(SKIN[(li * 5 + i) % SKIN.length], 0.8);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), skin); head.position.y = 1.37; head.castShadow = true; p.add(head);
          const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), std(HAIR[(li * 3 + i * 2) % HAIR.length], 0.9)); hair.position.y = 1.39; hair.rotation.x = 0.35; p.add(hair);
          const hands = [];
          [-1, 1].forEach(s => { const arm = box(0.1, 0.1, 0.5, shirt); arm.position.set(s * 0.24, 0.98, -0.32); arm.rotation.x = 0.25; p.add(arm);
            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin); hand.position.set(s * 0.2, 0.9, -0.6); p.add(hand); hands.push(hand); });
          const hit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.6), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, 1, 0.4); g.add(hit);
          const person = { a, fl, p, head, hands, scr, glow, halo, screenOn, working: false, phase: rnd() * 6, anchor: head, pos: new THREE.Vector3() };
          person.tag = label('', 'o3d-tag'); person.tag.innerHTML = '<b></b><small></small>';
          person.tag.firstChild.textContent = a.name; person.tag.lastChild.textContent = a.title; person.tag.hidden = true;
          hit.userData.person = person; peopleHits.push(hit); people.push(person);
        });
        fl.label = label(fl.ground ? 'GROUND · ' + fl.name : li + 'F · ' + fl.name, 'o3d-flabel');
        fl.label.style.setProperty('--tint', fl.tint);
        fl.labelPos = new THREE.Vector3(HW + 3.4, fy + FH / 2, (D + 1) / 2);
      });

      // spiral stair inside the left end, through an opening in every floor, up to the roof garden
      const R = 1.9, rise = 0.23, turn = 0.36, y0 = BASE + 0.25, steps = Math.ceil((roofY + 0.3 - y0) / rise);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, roofY + 1.4, 16), std(0x2A303C, 0.4, 0.6)); col.position.set(SX, (roofY + 1.4) / 2, SZ); tower.add(col);
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(R, 0.07, 0.75), M.slab, steps); inst.castShadow = true;
      const dm = new THREE.Object3D(), pts = [];
      for (let i = 0; i < steps; i++) { const a = i * turn, y = y0 + (i + 1) * rise;
        dm.position.set(SX + Math.cos(a) * R / 2, y, SZ + Math.sin(a) * R / 2); dm.rotation.set(0, -a, 0); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix);
        pts.push(new THREE.Vector3(SX + Math.cos(a) * (R + 0.05), y + 0.95, SZ + Math.sin(a) * (R + 0.05))); }
      tower.add(inst);
      tower.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 3, 0.05, 6, false), M.gold));

      // roof garden and the company sign
      const roof = new THREE.Group(); roof.position.y = roofY; tower.add(roof);
      slab(roof, 0.3, 0.15, true);
      const tx0 = SX + HH + 0.4, tx1 = HW - 0.75;
      const turf = new THREE.Mesh(new THREE.BoxGeometry(tx1 - tx0, 0.12, D - 1.5), std(0x2F5A38, 1)); turf.position.set((tx0 + tx1) / 2, 0.36, 0); roof.add(turf);
      for (let k = 0; k < 4; k++) { const x = tx0 + 1.5 + k * (tx1 - tx0 - 3) / 3; const t = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), M.leaf); t.position.set(x, 1.5, -3); t.castShadow = true; roof.add(t);
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.9, 6), std(0x3A2A20, 1)); s.position.set(x, 0.85, -3); roof.add(s); }
      const company = String((host.company && host.company()) || 'AGENT 0').toUpperCase().slice(0, 28);
      const sc = document.createElement('canvas'); sc.width = 2048; sc.height = 300; const sgc = sc.getContext('2d');
      sgc.font = '800 200px "Segoe UI", system-ui, sans-serif'; sgc.textAlign = 'center'; sgc.textBaseline = 'middle';
      sgc.shadowColor = 'rgba(255,214,150,0.95)'; sgc.shadowBlur = 40; sgc.fillStyle = '#FFF4DE'; sgc.fillText(company, 1024, 160); sgc.shadowBlur = 0; sgc.fillText(company, 1024, 160);
      const st = new THREE.CanvasTexture(sc); st.encoding = THREE.sRGBEncoding;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W - 2, 18), 2.6), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
      sign.position.set(0, 3.2, (D + 1) / 2 - 0.2); roof.add(sign);

      moon.shadow.camera.left = -W; moon.shadow.camera.right = W; moon.shadow.camera.top = roofY + 6; moon.shadow.camera.bottom = -6; moon.shadow.camera.far = 140; moon.shadow.camera.updateProjectionMatrix();
      const span = Math.max(W, roofY);
      home.t.set(0, roofY * 0.45, -2);
      home.c.set(span * 1.25, roofY * 0.55 + span * 0.45, span * 1.75 + 10);

      floorsEl.textContent = '';
      const mk = (txt, tint, fn, fl) => { const b = document.createElement('button'); b.type = 'button';
        const lv = document.createElement('span'); lv.className = 'lvl'; lv.textContent = txt; if (tint) lv.style.background = tint; b.appendChild(lv);
        b.appendChild(document.createTextNode(fl ? fl.name : 'Whole building'));
        if (fl) { const c = document.createElement('span'); c.className = 'cnt'; b.appendChild(c); fl.btnCnt = c; fl.btn = b; }
        b.addEventListener('click', fn); floorsEl.appendChild(b); return b; };
      floorsEl.allBtn = mk('⌂', '', () => enter(null));
      plan.forEach((fl, i) => mk(fl.ground ? 'HQ' : i + 'F', fl.tint, () => enter(fl), fl));
      enter(focus ? plan.find(f => f.id === focus.id) || null : null, true);
    }

    function enter(fl, instant) {
      focus = fl || null;
      floorsEl.allBtn && floorsEl.allBtn.setAttribute('aria-pressed', focus ? 'false' : 'true');
      floors.forEach(f => { f.btn && f.btn.setAttribute('aria-pressed', f === focus ? 'true' : 'false'); f.label.hidden = !!focus; });
      people.forEach(p => { p.tag.hidden = p.fl !== focus; });
      backBtn.hidden = !focus;
      const t = focus ? new THREE.Vector3(2, focus.y + 1.1, -1) : home.t.clone();
      const c = focus ? new THREE.Vector3(5, focus.y + 3.6, 22) : home.c.clone();
      if (instant || reduce) { controls.target.copy(t); camera.position.copy(c); fly = null; }
      else fly = { t0: performance.now(), dur: 1000, fromT: controls.target.clone(), fromC: camera.position.clone(), t, c };
    }
    backBtn.addEventListener('click', () => enter(null));

    /* ---- reading the app: floors, people, who is working, what on ---- */
    const watch = (typeof LiveWatch !== 'undefined' && LiveWatch.create) ? LiveWatch.create() : null;
    if (watch && typeof U !== 'undefined' && U.bus) LiveWatch.EVENTS.forEach(ev => U.bus.on(ev, p => { try { watch.onEvent(ev, p, Date.now()); } catch (e) { /* read-only view: never break the bus */ } }));
    function nowDoing(id) {
      if (!watch) return '';
      const r = watch.snapshot(Date.now()).active.filter(x => x.agentId === id).pop();
      return r ? (r.tool ? r.tool + (r.toolArgs ? ' · ' + r.toolArgs : '') : 'thinking') : '';
    }
    function currentPlan() {
      const st = host.station && host.station();
      const rooms = st && st.rooms ? st.rooms() : [];
      const roomOf = id => {
        if (!st) return null;
        const props = st.propsByAgent ? st.propsByAgent(id) : [];
        for (const p of props) { const r = st.roomAt(p.x, p.y); if (r != null) return r; }
        return st.agentRoomId ? st.agentRoomId(id) : null;
      };
      return plan(rooms, host.agents ? host.agents() : [], roomOf, {
        spawnRoomId: st && st.spawnRoomId ? st.spawnRoomId() : null,
        classes: id => (typeof Specialties !== 'undefined' && Specialties.get) ? Specialties.get(id) : null
      });
    }
    function sync() {
      let p; try { p = currentPlan(); } catch (e) { return; }
      const s = signature(p);
      if (s !== sig) { sig = s; build(p); }
      for (const pe of people) {
        const on = !!(host.isRunning && host.isRunning(pe.a.id));
        if (on !== pe.working) { pe.working = on; pe.scr.material = on ? pe.screenOn : screenOff; }
      }
      for (const f of floors) if (f.btnCnt) {
        const w = people.filter(pe => pe.fl === f && pe.working).length;
        f.btnCnt.textContent = w + '/' + f.agents.length;
        const sm = f.label.querySelector('small') || f.label.appendChild(document.createElement('small'));
        sm.textContent = ' ' + w + ' of ' + f.agents.length + ' working';
      }
    }

    /* ---- input ---- */
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let downAt = null;
    function cast(ev, list) {
      const r = cv.getBoundingClientRect();
      mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, camera); return ray.intersectObjects(list, false)[0];
    }
    cv.addEventListener('pointermove', ev => {
      hovered = null; hoverFloor = null;
      if (focus) { const h = cast(ev, peopleHits.filter(x => x.userData.person.fl === focus)); hovered = h ? h.object.userData.person : null; }
      else { const h = cast(ev, floorHits); hoverFloor = h ? h.object.userData.floor : null; }
      cv.style.cursor = (hovered || hoverFloor) ? 'pointer' : '';
      let text = '';
      if (hovered) { const d = hovered.working ? nowDoing(hovered.a.id) : ''; text = hovered.a.name + ' · ' + hovered.a.title + (hovered.working ? ' — working' + (d ? ': ' + d : '') : ' — idle'); }
      else if (hoverFloor) text = 'Enter ' + hoverFloor.name;
      tip.hidden = !text;
      if (text) { const r = wrap.getBoundingClientRect(); tip.textContent = str(text, 120); tip.style.left = (ev.clientX - r.left) + 'px'; tip.style.top = (ev.clientY - r.top) + 'px'; }
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; hovered = null; hoverFloor = null; });
    cv.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; });
    cv.addEventListener('pointerup', ev => {
      if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6) return;
      if (focus) { const h = cast(ev, peopleHits.filter(x => x.userData.person.fl === focus)); if (h && host.openAgent) host.openAgent(h.object.userData.person.a.id); }
      else { const h = cast(ev, floorHits); if (h) { tip.hidden = true; enter(h.object.userData.floor); } }
    });
    cv.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { enter(null); return; }
      const k = parseInt(ev.key, 10); if (k >= 0 && k < floors.length) enter(floors[k]);
    });
    cv.tabIndex = 0;

    /* ---- view switch ---- */
    let view = readView();
    function applyView(v) {
      view = v === 'classic' ? 'classic' : '3d';
      wrap.classList.toggle('o3d-on', view === '3d');
      ui.querySelectorAll('.o3d-switch button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false'));
      if (view === '3d') { resize(); sync(); }
      else { tip.hidden = true; }
    }
    ui.querySelectorAll('.o3d-switch button').forEach(b => b.addEventListener('click', () => { writeView(b.dataset.view); applyView(b.dataset.view); }));

    // the canvas may be the wrap's size or (glass mode) the whole window behind every panel: size to the canvas itself
    function resize() {
      const w = cv.clientWidth || wrap.clientWidth, h = cv.clientHeight || wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // full-window canvas: centre the shot on the stage's own box, not on the window, so the tower sits between the panels
      const cr = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const dx = (wr.left + wr.width / 2) - (cr.left + cr.width / 2), dy = (wr.top + wr.height / 2) - (cr.top + cr.height / 2);
      if (Math.abs(dx) + Math.abs(dy) > 1) camera.setViewOffset(w, h, -dx, -dy, w, h); else camera.clearViewOffset(); camera.fov = w < 700 ? 50 : 36; camera.updateProjectionMatrix();
    }
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(resize); ro.observe(wrap); ro.observe(cv); } else window.addEventListener('resize', resize);

    /* ---- loop: draws only while the 3D view is showing, at most ~30 fps ---- */
    const v3 = new THREE.Vector3();
    let last = 0, lastSync = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      if (view !== '3d' || document.hidden || !wrap.offsetParent) return;
      if (now - last < 33) return;
      last = now;
      if (now - lastSync > 600) { lastSync = now; sync(); }
      if (fly) { const k = Math.min(1, (now - fly.t0) / fly.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        controls.target.lerpVectors(fly.fromT, fly.t, e); camera.position.lerpVectors(fly.fromC, fly.c, e); if (k >= 1) fly = null; }
      controls.update();
      const t = now / 1000;
      if (!reduce) {
        world.shimmer.forEach((m, i) => { m.material.opacity = 0.16 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.5 + i)); });
        world.blinkers.forEach((b, i) => { b.visible = Math.sin(t * 2 + i) > 0.2; });
      }
      floors.forEach(f => { if (!reduce && f.tex) f.tex.offset.y = (t * 0.08) % 1;
        f.edgeMat.color.copy(f.tintColor).multiplyScalar(hoverFloor === f || focus === f ? 1.35 : 0.8); });
      people.forEach(pe => {
        pe.p.scale.setScalar(hovered === pe ? 1.05 : 1);
        const flick = reduce ? 1 : 0.85 + 0.15 * Math.sin(t * 9 + pe.phase);
        pe.glow.material.opacity += ((pe.working ? 0.55 * flick : 0) - pe.glow.material.opacity) * 0.15;
        pe.halo.material.opacity += ((pe.working ? 0.35 * flick : 0) - pe.halo.material.opacity) * 0.15;
        if (pe.working && !reduce) { pe.hands.forEach((h, i) => { h.position.y = 0.9 + Math.max(0, Math.sin(t * 14 + pe.phase + i * Math.PI)) * 0.04; }); pe.head.rotation.y = Math.sin(t * 0.7 + pe.phase) * 0.12; pe.p.rotation.x = 0; }
        else { pe.hands.forEach(h => { h.position.y = 0.9; }); pe.head.rotation.y = 0.4 * Math.sin(pe.phase); pe.p.rotation.x = pe.working ? 0 : -0.08; }
      });
      const cr = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const w = cr.width, h = cr.height, ox = cr.left - wr.left, oy = cr.top - wr.top;
      people.forEach(pe => { if (pe.tag.hidden) return; pe.anchor.getWorldPosition(pe.pos); pe.pos.y += 0.45; v3.copy(pe.pos).project(camera);
        pe.tag.style.left = (ox + (v3.x + 1) / 2 * w) + 'px'; pe.tag.style.top = (oy + (1 - v3.y) / 2 * h) + 'px'; });
      floors.forEach(f => { if (f.label.hidden) return; v3.copy(f.labelPos).project(camera);
        f.label.style.display = v3.z < 1 ? '' : 'none'; f.label.style.left = (ox + (v3.x + 1) / 2 * w) + 'px'; f.label.style.top = (oy + (1 - v3.y) / 2 * h) + 'px'; });
      renderer.render(scene, camera);
    }

    cv.addEventListener('webglcontextlost', ev => { ev.preventDefault(); applyView('classic'); });
    sync();
    applyView(view);
    requestAnimationFrame(loop);
    mounted = { applyView, sync, view: () => view };
    return mounted;
  }

  return { plan: plan, titleOf: titleOf, tintFor: tintFor, signature: signature, mount: mount, VIEW_KEY: VIEW_KEY, _mounted: () => mounted };
});

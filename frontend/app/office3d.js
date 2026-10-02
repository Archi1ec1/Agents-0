/* THE LAB — same-level production rooms. Classic World retains ownership of agents and tools. */
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
     Returns saved rooms, HQ first, retaining empty rooms. Corridors are rendered as bridges.
     Unassigned agents stay in HQ; optional workflow rooms add no agents or persistent station data. */
  function plan(rooms, agents, roomOf, opts) {
    opts = opts || {};
    const list = (rooms || []).filter(r => r && r.id && r.kind !== 'corridor');
    if (!list.length) list.push({ id: '_hq', kind: 'hab', name: 'HQ' });
    // View-only workspaces: showing a pipeline never hires agents or changes the classic station.
    if (opts.workflows) for (const [kind,name] of [['youtube','YOUTUBE'],['commerce','E-COMMERCE']]) {
      if (!list.some(r=>workflowKind(r.name)===kind)) list.push({id:'_production_'+kind,kind:'production',name});
    }
    const spawn = list.find(r => r.id === opts.spawnRoomId) || list[0];
    const ordered = [spawn].concat(list.filter(r => r !== spawn));
    const floors = ordered.map((r, i) => ({
      id: r.id, index: i, name: str(String(r.name || (i ? 'ROOM ' + i : 'HQ')).replace(/\s+LAB$/i, ''), 32), ground: i === 0,
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

  // a stable signature, so the shell rebuilds the rooms only when the floors or the people on them change
  function signature(floors) {
    return floors.map(f => f.id + ':' + f.name + '[' + f.agents.map(a => a.id + '/' + a.name + '/' + a.title).join(',') + ']').join('|');
  }

  function workflowKind(name) {
    if (/youtube|video|channel/i.test(name||'')) return 'youtube';
    if (/e-?commerce|shop|store/i.test(name||'')) return 'commerce';
    return null;
  }
  function layout(rooms) {
    const priority=r=>workflowKind(r.name)==='youtube'?0:workflowKind(r.name)==='commerce'?1:2;
    const ordered=rooms.slice().sort((a,b)=>priority(a)-priority(b)||a.index-b.index);
    const depth=Math.max(18,...ordered.map(r=>12+Math.ceil(r.agents.length/5)*6));
    return ordered.map((r,i)=>({...r,workflow:workflowKind(r.name),x:(i%2)*56-28,y:0,z:Math.floor(i/2)*(depth+12),width:44,depth}));
  }
  function activate(host,target) {
    if(target.type==='agent'&&host.openAgent)host.openAgent(target.id);
    if(target.type==='tool'&&host.openTool)host.openTool(target.id);
    if(target.type==='workflow'&&host.openWorkflow)host.openWorkflow(target.kind,target.stage);
  }
  /* ---------------- browser shell ---------------- */
  let mounted=null;
  const STATUS={idle:['#9BADAE','Idle'],ready:['#288A69','Ready'],working:['#39D5C4','Working'],review:['#FFBE62','Needs you'],blocked:['#FF6574','Blocked'],unknown:['#6C7C88','Unknown']};
  const TOOLS=[['tasks','Task board'],['outbox','Finished work'],['connectors','Connections'],['automation','Routines']];
  function mount(host) {
    if(mounted||typeof document==='undefined')return mounted;
    const T=window.THREE,wrap=host&&host.wrap;
    if(!T||!T.OrbitControls||!window.ProductionRoomScene||!wrap)return null;
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false});}catch(_){return null;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
    renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    const cv=renderer.domElement;cv.id='stage3d';cv.setAttribute('aria-label','Production rooms. Use the room, station and agent buttons for keyboard access.');
    wrap.appendChild(cv);
    const ui=document.createElement('div');ui.className='o3d-ui';
    ui.innerHTML='<div class="o3d-toolbar"><div class="o3d-switch" role="group" aria-label="Station view"><button type="button" data-view="3d">3D ROOMS</button><button type="button" data-view="classic">CLASSIC</button></div><button type="button" data-overview>Production floor</button><button type="button" data-shortcuts="youtube">SHORTS</button><button type="button" class="o3d-shop" data-shortcuts="commerce">SHOP</button></div>'+
      '<div class="o3d-content"><nav class="o3d-rooms" aria-label="Production rooms"></nav><div class="o3d-heading"><strong></strong><span></span></div><div class="o3d-stations" role="group" aria-label="Workflow stations"></div><div class="o3d-labels"></div>'+
      '<aside class="o3d-inspector" hidden aria-label="Selected station"><button type="button" data-dismiss aria-label="Close station details">×</button><h3></h3><p></p><ul></ul><button type="button" data-open-workflow>Open workflow</button></aside>'+
      '<div class="o3d-bottom"><div class="o3d-crew" role="group" aria-label="Agents in this room"></div><div class="o3d-legend">Teal: working · Amber: needs you · Red: blocked · Grey: idle / unknown</div><div class="o3d-tools" role="group" aria-label="Shared tools"></div></div></div>';
    wrap.appendChild(ui);
    const $=s=>ui.querySelector(s),labels=$('.o3d-labels'),roomNav=$('.o3d-rooms'),stationNav=$('.o3d-stations'),crewNav=$('.o3d-crew');
    const scene=new T.Scene();scene.background=new T.Color('#05090F');
    const camera=new T.OrthographicCamera(-40,40,30,-30,.1,600);
    const controls=new T.OrbitControls(camera,cv);controls.enableDamping=false;controls.enablePan=true;controls.enableRotate=false;controls.minZoom=.5;controls.maxZoom=2.8;
    scene.add(new T.HemisphereLight('#bfd5e8','#263443',.65));
    const fill=new T.DirectionalLight('#9dc6ea',.45);fill.position.set(30,20,30);scene.add(fill);
    const sun=new T.DirectionalLight('#FFE0B3',1.35);sun.position.set(-40,85,40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=40;sun.shadow.camera.bottom=-40;sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;scene.add(sun);
    let group=new T.Group();scene.add(group);let art=null;
    let rooms=[],sig='',activeId=null,selected=null,view='3d',disposed=false,raf=0,width=1,height=1;
    let objects=[],anchors=[],people=[],machines=[],rollers=[],roomButtons=[],lastFrame=0;
    let unsubscribe=null;const flow=typeof ProductionFlow!=='undefined'?ProductionFlow.getStore():null;
    const projections={};
    const motion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
    const mat=(color,extra)=>new T.MeshStandardMaterial({color:new T.Color(color).convertSRGBToLinear(),roughness:.75,...extra});
    function mesh(parent,geometry,color,x,y,z){const m=new T.Mesh(geometry,mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
    const box=(p,w,h,d,c,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),c,x,y,z);
    const cylinder=(p,r,h,c,x,y,z)=>mesh(p,new T.CylinderGeometry(r,r,h,12),c,x,y,z);
    function hit(parent,w,h,d,x,y,z,target){const m=box(parent,w,h,d,'#ffffff',x,y,z);m.material.visible=false;m.userData.target=target;objects.push(m);return m;}
    function label(text,x,y,z,room,type,target){const b=document.createElement('button');b.type='button';b.className='o3d-anchor '+type;b.textContent=text;b.addEventListener('click',()=>choose(target));labels.appendChild(b);anchors.push({el:b,pos:new T.Vector3(x,y,z),room,type});return b;}
    function roomAt(id){return rooms.find(r=>r.id===id);}
    function choose(target){
      if(target.type==='room')focus(target.id);
      else if(target.type==='stage'){focus(target.room,false);selected=target;paintInspector();}
      else activate(host,target);
    }
    function button(parent,text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);parent.appendChild(b);return b;}
    function disposeGroup(){
      if(art){art.dispose();art=null;}
      group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});scene.remove(group);
      group=new T.Group();scene.add(group);objects=[];anchors=[];people=[];machines=[];rollers=[];labels.replaceChildren();
    }
    function buildDesk(parent,a,i,room){
      const col=i%5,row=Math.floor(i/5),rowSize=Math.min(5,room.agents.length-row*5);
      const x=(col-(rowSize-1)/2)*7.8,z=2.1+row*6-(room.depth-18)/2;
      const figure=art.desk(parent,a,i,room,x,z);
      const target={type:'agent',id:a.id,room:room.id};hit(parent,4.6,4.3,4.5,x,2, z+.8,target);
      const tag=label(a.name,room.x+x,.5,room.z+z+4.2,room.id,'person',target);tag.title=a.title;
      people.push({a,...figure,tag,room:room.id,running:false,phase:i*1.7});
    }
    function buildMachine(parent,stage,i,room){
      const x=(i-2.5)*7,z=-3.5-(room.depth-18)/2;
      const model=art.machine(parent,stage,i,room,x,z);
      model.rollers.forEach(mesh=>rollers.push({mesh,room:room.id,stage:stage[0]}));
      const target={type:'stage',room:room.id,stage:stage[0],kind:room.workflow};
      hit(parent,6.5,3,3,x,1.4,z,target);
      const tag=label(stage[1],room.x+x,3.8,room.z+z,room.id,'station',target);
      machines.push({room:room.id,stage:stage[0],...model,tag,status:'unknown'});
    }
    function build(p){
      disposeGroup();rooms=layout(p);roomNav.replaceChildren();roomButtons=[];art=ProductionRoomScene.create(T,group);
      rooms.forEach(room=>{
        const g=new T.Group();g.position.set(room.x,0,room.z);g.userData.roomId=room.id;group.add(g);
        art.room(g,room);
        if(room.workflow&&typeof ProductionFlow!=='undefined')ProductionFlow.STAGES[room.workflow].forEach((s,i)=>buildMachine(g,s,i,room));
        else TOOLS.forEach(([id,title],i)=>{
          const x=(i-1.5)*7,z=-4-(room.depth-18)/2;box(g,2.5,1.3,1.6,'#344655',x,.65,z);box(g,2,.9,.15,'#43878c',x,1.7,z-.5);
          const t={type:'tool',id,room:room.id};hit(g,3,3,3,x,1,z,t);label(title,room.x+x,3,room.z+z,room.id,'station',t);
        });
        room.agents.forEach((a,i)=>buildDesk(g,a,i,room));
        label(room.name,room.x,5,room.z-room.depth/2+.5,room.id,'room',{type:'room',id:room.id});
        const b=button(roomNav,room.name,()=>focus(room.id));b.style.setProperty('--room-tint',room.tint);b.dataset.room=room.id;roomButtons.push(b);
      });
      rooms.forEach((r,i)=>{if(i%2===1)art.bridge(0,r.z,12,3.4);if(i>=2)art.bridge(r.x,r.z-(r.depth+12)/2,3.4,12);});
      art.finish();
      if(activeId&&!roomAt(activeId))activeId=null;
      focus(activeId);updateFlow();
    }
    function currentPlan(){
      const st=host.station&&host.station();
      return plan(st&&st.rooms?st.rooms():[],host.agents?host.agents():[],id=>{
        if(!st)return null;
        for(const p of st.propsByAgent?st.propsByAgent(id):[]){const r=st.roomAt(p.x,p.y);if(r!=null)return r;}
        return st.agentRoomId?st.agentRoomId(id):null;
      },{workflows:true,spawnRoomId:st&&st.spawnRoomId?st.spawnRoomId():null,classes:id=>typeof Specialties!=='undefined'&&Specialties.get?Specialties.get(id):null});
    }
    function fit(){
      const r=roomAt(activeId),rows=1;
      const x=r?r.x:0,z=r?r.z:(rows-1)*((rooms[0]||{}).depth+12)/2||0;
      const depth=r?r.depth:rows*((rooms[0]||{}).depth+12),spanX=r?49:111;
      const frame=wrap.getBoundingClientRect(),scale=frame.width/width||1;
      const topSpace=(stationNav.getBoundingClientRect().bottom-frame.top)/scale+22;
      const bottomSpace=(frame.bottom-$('.o3d-bottom').getBoundingClientRect().top)/scale+20;
      const availableH=Math.max(120,height-topSpace-bottomSpace),availableW=Math.max(150,width-30);
      const spanY=Math.max(depth*.65+11,spanX*availableH/availableW);
      const worldH=spanY*height/availableH,worldW=worldH*width/height;
      const shift=(topSpace-bottomSpace)*.5*worldH/height;
      camera.left=-worldW/2;camera.right=worldW/2;camera.top=worldH/2+shift;camera.bottom=-worldH/2+shift;camera.zoom=1;camera.updateProjectionMatrix();
      // Orthographic view preserves distances; all platforms and bridges share y=0.
      controls.target.set(x,1,z);camera.position.set(x+3,56,z+70);camera.lookAt(controls.target);controls.update();
      sun.target.position.set(x,0,z);sun.target.updateMatrixWorld();sun.position.set(x-30,60,z+30);
    }
    function focus(id,reframe=true){
      const changed=activeId!==id;activeId=id;selected=null;$('.o3d-inspector').hidden=true;
      const r=roomAt(id);roomButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===id)));
      group.children.forEach(g=>{const room=roomAt(g.userData.roomId);g.visible=id?!!room&&room.id===id:room?!!room.workflow:!!g.userData.productionBridge;});
      $('.o3d-heading strong').textContent=r?r.name:'THE LAB · Production floor';
      stationNav.replaceChildren();crewNav.replaceChildren();
      if(r){
        if(r.workflow&&flow)flow.project(r.workflow).stages.forEach((s,i)=>{const b=button(stationNav,(i+1)+' '+s.label,()=>choose({type:'stage',room:r.id,kind:r.workflow,stage:s.id}));b.dataset.stage=s.id;});
        r.agents.forEach(a=>{const b=button(crewNav,a.name,()=>activate(host,{type:'agent',id:a.id}));b.title=a.title;b.dataset.agent=a.id;});
        if(!r.agents.length){const empty=document.createElement('span');empty.textContent='No agents assigned to this room';crewNav.appendChild(empty);}
      }
      anchors.forEach(a=>{const room=roomAt(a.room);a.el.hidden=id?a.room!==id:!room.workflow;});
      if(reframe||changed)fit();updateFlow();
    }
    function paintInspector(){
      const panel=$('.o3d-inspector');if(!selected||!flow){panel.hidden=true;return;}
      const p=flow.project(selected.kind),s=p.stages.find(s=>s.id===selected.stage);if(!s){panel.hidden=true;return;}
      panel.hidden=false;panel.dataset.status=s.status;panel.querySelector('h3').textContent=s.label+' · '+STATUS[s.status][1];
      panel.querySelector('p').textContent=(p.mode==='demo'?'DEMO — ':'')+s.note;
      const ul=panel.querySelector('ul');ul.replaceChildren();s.items.slice(0,10).forEach(item=>{const li=document.createElement('li');li.textContent=item.label+' — '+item.detail;ul.appendChild(li);});
      if(s.items.length>10){const li=document.createElement('li');li.textContent='+'+(s.items.length-10)+' more in the workflow';ul.appendChild(li);}
      panel.querySelector('[data-open-workflow]').textContent=selected.kind==='commerce'?'Open Shop controls':'Open Shorts controls';
    }
    function updateFlow(){
      if(flow){projections.youtube=flow.project('youtube');projections.commerce=flow.project('commerce');}
      const r=roomAt(activeId),p=r&&r.workflow?projections[r.workflow]:null;
      const overview=rooms.filter(r=>r.workflow).map(r=>{const p=projections[r.workflow];return p&&p.attention.length?r.name+': '+p.attention[0].detail:null;}).filter(Boolean).join(' · ');
      $('.o3d-heading span').textContent=p?(p.mode==='demo'?'DEMO · ':p.mode==='disconnected'?'SETUP · ':'')+p.notice:r?'Select a desk to open its agent. Tool stations open existing features.':overview||'Choose a room. Screens show agent activity; stations show saved workflow state.';
      anchors.filter(a=>a.type==='room').forEach(a=>{
        const room=roomAt(a.room),p=projections[room.workflow];
        if(p){const blocked=p.stages.some(s=>s.status==='blocked'),status=p.stale?'unknown':blocked?'blocked':p.attention.length?'review':'idle';
          a.el.textContent=room.name+' · '+(p.mode==='demo'?'DEMO · ':'')+(p.stale?'Unknown':blocked?'Blocked':p.attention.length?'Needs you':'Open');a.el.dataset.status=status;
          const b=roomButtons.find(b=>b.dataset.room===room.id);if(b){b.dataset.status=status;b.title=room.name+' · '+STATUS[status][1];}
        }
      });
      machines.forEach(m=>{const room=roomAt(m.room),s=projections[room.workflow]&&projections[room.workflow].stages.find(s=>s.id===m.stage);if(!s)return;
        m.status=s.status;const c=STATUS[s.status][0];m.beacon.material.color.set(c).convertSRGBToLinear();m.beacon.material.emissive.copy(m.beacon.material.color);m.beacon.material.emissiveIntensity=['blocked','review','working'].includes(s.status)?2:.2;
        m.glowLamp.material.color.set(c);m.glowLamp.material.opacity=['blocked','review'].includes(s.status)?.65:0;
        m.tag.dataset.status=s.status;m.tag.textContent=s.label+' · '+s.count;m.tag.title=s.label+' · '+STATUS[s.status][1]+': '+s.note;
        m.tag.setAttribute('aria-label',s.label+', '+s.count+' items, '+STATUS[s.status][1]+'. '+s.note);
        m.tokens.forEach((t,i)=>{t.visible=i<s.count;});
      });
      if(p)stationNav.querySelectorAll('button').forEach(b=>{const s=p.stages.find(s=>s.id===b.dataset.stage);b.textContent=s.label+' · '+s.count;b.dataset.status=s.status;b.title=STATUS[s.status][1]+': '+s.note;b.setAttribute('aria-label',s.label+', '+s.count+' items, '+STATUS[s.status][1]+'. '+s.note);});
      paintInspector();
    }
    function sync(){
      if(disposed)return;let p;try{p=currentPlan();}catch(_){return;}
      const next=signature(p);if(next!==sig){sig=next;build(p);}
      people.forEach(pe=>{pe.running=!!(host.isRunning&&host.isRunning(pe.a.id));pe.screen.material.color.set(pe.running?'#c4ffed':'#8195ac');pe.rig.userData.running=pe.running;pe.tag.title=pe.a.title+' · '+(pe.running?'Working':'Idle');pe.tag.dataset.running=String(pe.running);});
      crewNav.querySelectorAll('button').forEach(b=>{const pe=people.find(p=>p.a.id===b.dataset.agent);b.dataset.running=String(!!(pe&&pe.running));});
    }
    function readMode(){try{return localStorage.getItem('thelab.shop.mode')==='demo'?'demo':'disconnected';}catch(_){return 'disconnected';}}
    function refresh(){if(!flow||disposed||document.hidden||view!=='3d')return;flow.setCommerceMode(readMode());flow.refresh('youtube');flow.refresh('commerce');}
    function applyView(v){view=v==='classic'?'classic':'3d';wrap.classList.toggle('o3d-on',view==='3d');ui.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));try{localStorage.setItem(VIEW_KEY,view);}catch(_){}if(view==='3d'){resize();refresh();}}
    ui.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>applyView(b.dataset.view)));
    $('[data-overview]').onclick=()=>focus(null);
    ui.querySelectorAll('[data-shortcuts]').forEach(b=>b.onclick=()=>activate(host,{type:'workflow',kind:b.dataset.shortcuts,stage:b.dataset.shortcuts==='youtube'?'setup':'orders'}));
    $('[data-dismiss]').onclick=()=>{selected=null;$('.o3d-inspector').hidden=true;};
    $('[data-open-workflow]').onclick=()=>{if(selected)activate(host,{type:'workflow',kind:selected.kind,stage:selected.stage});};
    TOOLS.forEach(([id,title])=>button($('.o3d-tools'),title,()=>activate(host,{type:'tool',id})));
    const expand=button($('.o3d-toolbar'),'Expand view',()=>{const wide=wrap.classList.toggle('o3d-expanded');expand.textContent=wide?'Restore panels':'Expand view';expand.setAttribute('aria-pressed',String(wide));});
    expand.dataset.expand='';expand.setAttribute('aria-pressed','false');
    const ray=new T.Raycaster(),pointer=new T.Vector2();let down=null;
    cv.addEventListener('pointerdown',ev=>{down={x:ev.clientX,y:ev.clientY};});
    cv.addEventListener('pointerup',ev=>{
      if(!down||Math.hypot(ev.clientX-down.x,ev.clientY-down.y)>6)return;down=null;
      const rect=cv.getBoundingClientRect();pointer.set((ev.clientX-rect.left)/rect.width*2-1,-(ev.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
      const target=ray.intersectObjects(objects,false).find(h=>{const room=roomAt(h.object.userData.target.room);return activeId?room&&room.id===activeId:room&&room.workflow;});
      if(target)choose(target.object.userData.target);
    });
    cv.addEventListener('webglcontextlost',ev=>{ev.preventDefault();applyView('classic');});
    // Labels use local CSS pixels, including when the app's TEXT SIZE zoom scales the cabinet.
    function resize(){width=Math.max(1,wrap.clientWidth);height=Math.max(1,wrap.clientHeight);renderer.setSize(width,height,false);fit();}
    const observer=new ResizeObserver(resize);observer.observe(wrap);
    function tick(time){
      if(disposed)return;raf=requestAnimationFrame(tick);
      if(time-lastFrame<33||view!=='3d'||document.hidden||!wrap.offsetParent)return;lastFrame=time;
      const animate=!motion||!motion.matches;
      rollers.forEach(r=>{const room=roomAt(r.room),s=projections[room.workflow]&&projections[room.workflow].stages.find(s=>s.id===r.stage);if(animate&&s&&s.status==='working')r.mesh.rotation.y=time*.002;});
      people.forEach(p=>{
        // Idle breathing is decorative; typing only occurs for the actual running agent.
        const t=time*.002+p.phase;p.rig.rotation.x=animate?(p.running?-.04+Math.sin(t)*.012:Math.sin(t*.4)*.009):0;
        p.head.rotation.y=animate?Math.sin(t*.45)*.06:0;
        p.arms.forEach((arm,i)=>{arm.rotation.x=animate&&p.running?Math.sin(time*.014+i*2+p.phase)*.09:0;});
      });
      machines.forEach(m=>m.tokens.forEach((token,i)=>{token.position.x=token.userData.baseX+(animate&&m.status==='working'?Math.sin(time*.001+i)*.18:0);}));
      camera.updateMatrixWorld();
      anchors.forEach(a=>{if(a.el.hidden)return;if(!activeId&&a.type!=='room'){a.el.style.visibility='hidden';return;}const v=a.pos.clone().project(camera);a.el.style.left=((v.x+1)*width/2)+'px';a.el.style.top=((1-v.y)*height/2)+'px';a.el.style.visibility=v.z<-1||v.z>1||Math.abs(v.x)>.96||Math.abs(v.y)>.94?'hidden':'visible';});
      renderer.render(scene,camera);
    }
    if(flow)unsubscribe=flow.subscribe(updateFlow);
    const syncTimer=setInterval(sync,800),refreshTimer=setInterval(refresh,15000);
    const onVisible=()=>{if(!document.hidden){sync();refresh();}};document.addEventListener('visibilitychange',onVisible);
    sync();try{view=localStorage.getItem(VIEW_KEY)==='classic'?'classic':'3d';}catch(_){}applyView(view);raf=requestAnimationFrame(tick);
    function dispose(){disposed=true;clearInterval(syncTimer);clearInterval(refreshTimer);cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',onVisible);if(unsubscribe)unsubscribe();controls.dispose();disposeGroup();renderer.dispose();cv.remove();ui.remove();wrap.classList.remove('o3d-on');mounted=null;}
    mounted={applyView,sync,view:()=>view,focus,dispose};return mounted;
  }
  return {plan,titleOf,tintFor,signature,layout,workflowKind,activate,mount,VIEW_KEY,_mounted:()=>mounted};
});

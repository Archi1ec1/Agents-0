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
  const STATUS={idle:['#9BADAE','Idle'],ready:['#288A69','Ready'],working:['#197DA2','Working'],review:['#C08219','Needs you'],blocked:['#CE5145','Blocked'],unknown:['#6C7C88','Unknown']};
  const TOOLS=[['tasks','Task board'],['outbox','Finished work'],['connectors','Connections'],['automation','Routines']];
  function mount(host) {
    if(mounted||typeof document==='undefined')return mounted;
    const T=window.THREE,wrap=host&&host.wrap;
    if(!T||!T.OrbitControls||!wrap)return null;
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false});}catch(_){return null;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
    renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    const cv=renderer.domElement;cv.id='stage3d';cv.setAttribute('aria-label','Production rooms. Use the room, station and agent buttons for keyboard access.');
    wrap.appendChild(cv);
    const ui=document.createElement('div');ui.className='o3d-ui';
    ui.innerHTML='<div class="o3d-toolbar"><div class="o3d-switch" role="group" aria-label="Station view"><button type="button" data-view="3d">3D ROOMS</button><button type="button" data-view="classic">CLASSIC</button></div><button type="button" data-overview>All rooms</button><button type="button" data-shortcuts="youtube">SHORTS</button><button type="button" class="o3d-shop" data-shortcuts="commerce">SHOP</button></div>'+
      '<div class="o3d-content"><nav class="o3d-rooms" aria-label="Production rooms"></nav><div class="o3d-heading"><strong></strong><span></span></div><div class="o3d-stations" role="group" aria-label="Workflow stations"></div><div class="o3d-labels"></div>'+
      '<aside class="o3d-inspector" hidden aria-label="Selected station"><button type="button" data-dismiss aria-label="Close station details">×</button><h3></h3><p></p><ul></ul><button type="button" data-open-workflow>Open workflow</button></aside>'+
      '<div class="o3d-bottom"><div class="o3d-crew" role="group" aria-label="Agents in this room"></div><div class="o3d-legend">Blue: working · Amber: needs you · Red: blocked · Grey: idle / unknown</div><div class="o3d-tools" role="group" aria-label="Shared tools"></div></div></div>';
    wrap.appendChild(ui);
    const $=s=>ui.querySelector(s),labels=$('.o3d-labels'),roomNav=$('.o3d-rooms'),stationNav=$('.o3d-stations'),crewNav=$('.o3d-crew');
    const scene=new T.Scene();scene.background=new T.Color('#D9EBE5');
    const camera=new T.OrthographicCamera(-40,40,30,-30,.1,600);
    const controls=new T.OrbitControls(camera,cv);controls.enableDamping=false;controls.enablePan=true;controls.enableRotate=false;controls.minZoom=.5;controls.maxZoom=2.8;
    scene.add(new T.HemisphereLight('#F4FFFC','#799792',.75));
    const sun=new T.DirectionalLight('#FFF5E0',.65);sun.position.set(-40,85,40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-100;sun.shadow.camera.right=100;sun.shadow.camera.top=100;sun.shadow.camera.bottom=-100;sun.shadow.bias=-.001;scene.add(sun);
    let group=new T.Group();scene.add(group);
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
      group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});scene.remove(group);
      group=new T.Group();scene.add(group);objects=[];anchors=[];people=[];machines=[];rollers=[];labels.replaceChildren();
    }
    function buildDesk(parent,a,i,room){
      const col=i%5,row=Math.floor(i/5),rowSize=Math.min(5,room.agents.length-row*5);
      const x=(col-(rowSize-1)/2)*7,z=4.5+row*6-(room.depth-18)/2;
      const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(1.12);parent.add(g);
      box(g,3,.2,1.8,'#F4F3E9',0,1.5,0);[-1.2,1.2].forEach(v=>box(g,.12,1.4,1.3,'#72969A',v,.7,0));
      box(g,1.6,.95,.14,'#315861',0,2.12,-.42);
      const screen=box(g,1.4,.73,.03,'#91B7B3',0,2.12,-.33);
      box(g,.12,.35,.16,'#315861',0,1.67,-.42);box(g,1.2,.08,.4,'#90ABA9',0,1.65,.25);
      // A compact seated character. The chair and knees make the pose readable from above.
      box(g,1,.15,1,'#375F69',0,.83,1.5);box(g,1,1,.15,'#375F69',0,1.28,1.96);cylinder(g,.1,.7,'#637C80',0,.4,1.5);
      const torso=cylinder(g,.4,.65,room.tint,0,1.3,1.3);
      const skin=['#DCA886','#966649','#E9C8A5','#BA8664'][i%4];
      mesh(g,new T.SphereGeometry(.35,12,10),skin,0,1.98,1.23);mesh(g,new T.SphereGeometry(.36,12,8,0,Math.PI*2,0,Math.PI*.55),'#3E3B3B',0,2.02,1.26);
      [-.22,.22].forEach(v=>{box(g,.23,.25,.85,'#405B68',v,.98,.88);box(g,.22,.65,.22,'#405B68',v,.63,.52);box(g,.25,.16,.46,'#284651',v,.29,.4);});
      [-.4,.4].forEach(v=>{const arm=box(g,.19,.2,.85,skin,v,1.52,.78);arm.rotation.x=-.12;});
      const target={type:'agent',id:a.id};hit(g,3.4,3.2,3.2,0,1.4,.7,target);
      const tag=label(a.name,room.x+x,.5,room.z+z+3,room.id,'person',target);tag.title=a.title;
      people.push({a,screen,torso,tag,room:room.id,running:false});
    }
    function buildMachine(parent,stage,i,room){
      const x=(i-2.5)*7,z=-4-(room.depth-18)/2;
      box(parent,4.1,.5,2.2,'#ECF3EF',x,.95,z);
      [-1.7,1.7].forEach(v=>box(parent,.18,.8,1.7,'#75979A',x+v,.4,z));
      box(parent,3.7,.12,1.8,'#355E65',x,1.27,z);
      box(parent,.12,1.2,.12,'#507E82',x-1.9,1.8,z-.7);
      const beacon=cylinder(parent,.19,.38,'#A0B1AF',x-1.9,2.55,z-.7);
      // Conveyor edges and rollers bridge station islands; motion only represents current processing.
      if(i<5){box(parent,2.9,.12,1.65,'#78999B',x+3.5,1.2,z);for(let j=0;j<7;j++){const roll=cylinder(parent,.11,1.5,'#A7BEBC',x+2.25+j*.4,1.32,z);box(roll,.04,1.5,.02,'#567D80',.105,0,0);roll.rotation.x=Math.PI/2;rollers.push({mesh:roll,room:room.id,stage:stage[0]});}}
      const target={type:'stage',room:room.id,stage:stage[0],kind:room.workflow};
      hit(parent,5,3,3,x,1.4,z,target);
      const tag=label((i+1)+' · '+stage[1],room.x+x,3,room.z+z,room.id,'station',target);
      const tokens=[];for(let n=0;n<3;n++){const token=box(parent,.55,.45,.75,room.tint,x-.9+n*.9,1.6,z);token.visible=false;tokens.push(token);}
      machines.push({room:room.id,stage:stage[0],beacon,tag,tokens});
    }
    function bridge(x,z,w,d){
      box(group,w,.38,d,'#A9C2BD',x,-.08,z);
      if(w>d){[-1,1].forEach(s=>{box(group,w,.08,.08,'#5C8C8D',x,.9,z+s*(d/2-.12));for(let v=-w/2;v<=w/2;v+=2)box(group,.07,.9,.07,'#759F9C',x+v,.45,z+s*(d/2-.12));});}
      else{[-1,1].forEach(s=>{box(group,.08,.08,d,'#5C8C8D',x+s*(w/2-.12),.9,z);for(let v=-d/2;v<=d/2;v+=2)box(group,.07,.9,.07,'#759F9C',x+s*(w/2-.12),.45,z+v);});}
    }
    function build(p){
      disposeGroup();rooms=layout(p);roomNav.replaceChildren();roomButtons=[];
      rooms.forEach(room=>{
        const g=new T.Group();g.position.set(room.x,0,room.z);group.add(g);
        box(g,44,.65,room.depth,'#C3D7CE',0,-.4,0);box(g,44,.12,.3,room.tint,0,.02,-room.depth/2+.1);
        box(g,44,.9,.2,'#B7CEC4',0,.4,-room.depth/2);box(g,.2,.9,room.depth,'#B7CEC4',-22,.4,0);
        // Low partitions retain a room silhouette without hiding selectable desks.
        [-20,20].forEach(x=>{cylinder(g,.5,.7,'#A1BCAD',x,.3,-room.depth/2+1.5);mesh(g,new T.SphereGeometry(.75,8,6),'#70A18B',x,1.1,-room.depth/2+1.5);});
        if(room.workflow&&typeof ProductionFlow!=='undefined')ProductionFlow.STAGES[room.workflow].forEach((s,i)=>buildMachine(g,s,i,room));
        else TOOLS.forEach(([id,title],i)=>{
          const x=(i-1.5)*7,z=-4-(room.depth-18)/2;box(g,2.5,1.3,1.6,'#79A1A3',x,.65,z);box(g,2,.9,.15,'#275664',x,1.7,z-.5);
          const t={type:'tool',id};hit(g,3,3,3,x,1,z,t);label(title,room.x+x,3,room.z+z,room.id,'station',t);
        });
        room.agents.forEach((a,i)=>buildDesk(g,a,i,room));
        label(room.name,room.x,1,room.z-room.depth/2+1,room.id,'room',{type:'room',id:room.id});
        const b=button(roomNav,room.name,()=>focus(room.id));b.style.setProperty('--room-tint',room.tint);b.dataset.room=room.id;roomButtons.push(b);
      });
      rooms.forEach((r,i)=>{if(i%2===1)bridge(0,r.z,12,3.4);if(i>=2)bridge(r.x,r.z-(r.depth+12)/2,3.4,12);});
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
      const r=roomAt(activeId),rows=Math.ceil(rooms.length/2);
      const x=r?r.x:0,z=r?r.z:(rows-1)*((rooms[0]||{}).depth+12)/2||0;
      const depth=r?r.depth:rows*((rooms[0]||{}).depth+12),spanX=r?49:111;
      const availableH=Math.max(120,height-230),availableW=Math.max(150,width-30);
      const spanY=Math.max(depth*.75+9,spanX*availableH/availableW);
      const worldH=spanY*height/availableH,worldW=worldH*width/height;
      camera.left=-worldW/2;camera.right=worldW/2;camera.top=worldH/2;camera.bottom=-worldH/2;camera.zoom=1;camera.updateProjectionMatrix();
      // Orthographic view preserves distances; all platforms and bridges share y=0.
      controls.target.set(x,0,z);camera.position.set(x+5,65,z+58);camera.lookAt(controls.target);controls.update();
    }
    function focus(id,reframe=true){
      const changed=activeId!==id;activeId=id;selected=null;$('.o3d-inspector').hidden=true;
      const r=roomAt(id);roomButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===id)));
      $('.o3d-heading strong').textContent=r?r.name:'THE LAB · Production rooms';
      stationNav.replaceChildren();crewNav.replaceChildren();
      if(r){
        if(r.workflow&&flow)flow.project(r.workflow).stages.forEach((s,i)=>{const b=button(stationNav,(i+1)+' '+s.label,()=>choose({type:'stage',room:r.id,kind:r.workflow,stage:s.id}));b.dataset.stage=s.id;});
        r.agents.forEach(a=>{const b=button(crewNav,a.name,()=>activate(host,{type:'agent',id:a.id}));b.title=a.title;b.dataset.agent=a.id;});
        if(!r.agents.length){const empty=document.createElement('span');empty.textContent='No agents assigned to this room';crewNav.appendChild(empty);}
      }
      anchors.forEach(a=>a.el.hidden=a.type==='room'?!!id:a.room!==id);
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
      machines.forEach(m=>{const room=roomAt(m.room),s=projections[room.workflow]&&projections[room.workflow].stages.find(s=>s.id===m.stage);if(!s)return;m.beacon.material.color.set(STATUS[s.status][0]).convertSRGBToLinear();m.tag.dataset.status=s.status;m.tag.title=s.label+' · '+STATUS[s.status][1]+': '+s.note;m.tokens.forEach((t,i)=>{t.visible=i<s.count;});});
      if(p)stationNav.querySelectorAll('button').forEach(b=>{const s=p.stages.find(s=>s.id===b.dataset.stage);b.textContent=s.label+' · '+s.count;b.dataset.status=s.status;b.title=STATUS[s.status][1]+': '+s.note;b.setAttribute('aria-label',s.label+', '+s.count+' items, '+STATUS[s.status][1]+'. '+s.note);});
      paintInspector();
    }
    function sync(){
      if(disposed)return;let p;try{p=currentPlan();}catch(_){return;}
      const next=signature(p);if(next!==sig){sig=next;build(p);}
      people.forEach(pe=>{pe.running=!!(host.isRunning&&host.isRunning(pe.a.id));pe.screen.material.color.set(pe.running?'#51CEAD':'#91B7B3').convertSRGBToLinear();pe.tag.title=pe.a.title+' · '+(pe.running?'Working':'Idle');pe.tag.dataset.running=String(pe.running);});
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
    const ray=new T.Raycaster(),pointer=new T.Vector2();let down=null;
    cv.addEventListener('pointerdown',ev=>{down={x:ev.clientX,y:ev.clientY};});
    cv.addEventListener('pointerup',ev=>{
      if(!down||Math.hypot(ev.clientX-down.x,ev.clientY-down.y)>6)return;down=null;
      const rect=cv.getBoundingClientRect();pointer.set((ev.clientX-rect.left)/rect.width*2-1,-(ev.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
      const target=ray.intersectObjects(objects,false).find(h=>!activeId||h.object.userData.target.type==='tool'||h.object.userData.target.type==='agent'||h.object.userData.target.room===activeId);
      if(target)choose(target.object.userData.target);
    });
    cv.addEventListener('webglcontextlost',ev=>{ev.preventDefault();applyView('classic');});
    // Labels use local CSS pixels, including when the app's TEXT SIZE zoom scales the cabinet.
    function resize(){width=Math.max(1,wrap.clientWidth);height=Math.max(1,wrap.clientHeight);renderer.setSize(width,height,false);fit();}
    const observer=new ResizeObserver(resize);observer.observe(wrap);
    function tick(time){
      if(disposed)return;raf=requestAnimationFrame(tick);
      if(time-lastFrame<33||view!=='3d'||document.hidden||!wrap.offsetParent)return;lastFrame=time;
      if(!motion||!motion.matches)rollers.forEach(r=>{const room=roomAt(r.room),s=projections[room.workflow]&&projections[room.workflow].stages.find(s=>s.id===r.stage);if(s&&s.status==='working')r.mesh.rotation.y=time*.002;});
      camera.updateMatrixWorld();
      anchors.forEach(a=>{if(a.el.hidden)return;const v=a.pos.clone().project(camera);a.el.style.left=((v.x+1)*width/2)+'px';a.el.style.top=((1-v.y)*height/2)+'px';a.el.style.visibility=v.z<-1||v.z>1||Math.abs(v.x)>.96||Math.abs(v.y)>.94?'hidden':'visible';});
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

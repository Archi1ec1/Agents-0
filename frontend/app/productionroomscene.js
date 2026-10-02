/* THE LAB — local, procedural 3D art. No downloaded models, fonts or textures.
   The scene only renders state supplied by Office3D; it owns no business actions. */
(function (root) {
  'use strict';
  function create(T, rootGroup) {
    const geometries = {
      box: new T.BoxGeometry(1,1,1), sphere: new T.SphereGeometry(1,14,10),
      cylinder: new T.CylinderGeometry(1,1,1,12), cone: new T.ConeGeometry(1,1,7)
    };
    const materials = new Map(), textures = [], staticParts = [];
    const color = value => new T.Color(value).convertSRGBToLinear();
    function material(hex, glow=0, metal=.15) {
      const key = [hex,glow,metal].join(':');
      if (!materials.has(key)) materials.set(key,new T.MeshStandardMaterial({color:color(hex),roughness:metal>.4?.38:.68,metalness:metal,emissive:color(hex),emissiveIntensity:glow}));
      return materials.get(key);
    }
    function part(parent,shape,size,hex,pos,glow=0,metal=.15,dynamic=false) {
      const m = new T.Mesh(geometries[shape],material(hex,glow,metal));
      m.scale.set(...size);m.position.set(...pos);m.castShadow=!glow;m.receiveShadow=true;parent.add(m);
      if(!dynamic)staticParts.push(m);
      return m;
    }
    const box=(p,s,c,v,g=0,m=.15,d=false)=>part(p,'box',s,c,v,g,m,d);
    const ball=(p,s,c,v,d=false)=>part(p,'sphere',s,c,v,0,.05,d);
    const cyl=(p,s,c,v,g=0,d=false)=>part(p,'cylinder',s,c,v,g,.4,d);
    function group(parent,x=0,y=0,z=0){const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g;}
    function texture(paint,w=128,h=128){const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;textures.push(t);return t;}
    const pool=texture((c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(255,194,108,.42)');g.addColorStop(.35,'rgba(244,166,80,.15)');g.addColorStop(1,'rgba(224,132,44,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
    const screenMap=texture((c,w,h)=>{
      c.fillStyle='#071720';c.fillRect(0,0,w,h);c.fillStyle='#25404b';c.fillRect(0,0,w,14);
      c.fillStyle='#91d0d7';c.font='9px sans-serif';c.fillText('THE LAB',8,10);
      c.fillStyle='#122c36';c.fillRect(5,20,26,67);
      for(let i=0;i<5;i++){c.fillStyle=i===0?'#438e91':'#45616c';c.fillRect(9,26+i*11,17,3);}
      for(let i=0;i<7;i++){c.fillStyle=i%3===0?'#69a9b2':'#345763';c.fillRect(39,25+i*8,30+(i%3)*13,2);}
      c.fillStyle='#347278';c.fillRect(39,84,39,3);
    },128,96);
    const glowMaterial=new T.MeshBasicMaterial({map:pool,transparent:true,depthWrite:false,opacity:.8,side:T.DoubleSide});
    const plane=new T.PlaneGeometry(1,1);
    function glow(parent,x,y,z,w,h,floor=true){const m=new T.Mesh(plane,glowMaterial);m.position.set(x,y,z);m.scale.set(w,h,1);if(floor)m.rotation.x=-Math.PI/2;parent.add(m);return m;}
    function plant(p,x,z){
      cyl(p,[.42,.65,.42],'#282e32',[x,.34,z]);
      for(let n=0;n<5;n++){const a=n*2.4;const leaf=ball(p,[.22,.75,.13],n%2?'#456453':'#304a3e',[x+Math.sin(a)*.3,1.05,z+Math.cos(a)*.3]);leaf.rotation.z=Math.sin(a)*.55;}
    }
    function room(parent,r){
      const back=-r.depth/2;
      [-13,13].forEach(x=>{const light=new T.PointLight('#ffb663',2,26,1.5);light.position.set(x,4,back+2.5);parent.add(light);});
      box(parent,[44,.8,r.depth],'#171f2a',[0,-.46,0],0,.6);
      box(parent,[43.5,.12,r.depth-.5],'#353d46',[0,0,0],0,.35);
      for(let x=-20;x<=20;x+=4)box(parent,[.035,.012,r.depth-.5],'#222d37',[x,.07,0]);
      for(let z=back+2;z<r.depth/2;z+=3)box(parent,[43.5,.012,.03],'#222d37',[0,.07,z]);
      box(parent,[44,5.4,.5],'#222b36',[0,2.7,back]);
      for(let x=-21;x<=21;x+=3.5)box(parent,[.08,5.3,.1],'#35404d',[x,2.7,back+.28]);
      for(let y=1.5;y<5;y+=1.5)box(parent,[43.5,.04,.1],'#151c25',[0,y,back+.28]);
      box(parent,[44,.35,.85],'#485461',[0,5.5,back],0,.65);
      // Side cutaways and front railing frame the room without hiding a seated person.
      [-1,1].forEach(s=>{
        box(parent,[.45,2.2,r.depth],'#283440',[s*21.8,1.1,0]);
        box(parent,[.65,.18,r.depth],'#566471',[s*21.8,2.25,0],0,.65);
        box(parent,[.45,5.2,.65],'#536170',[s*21.8,2.6,back]);
        for(let z=back+2;z<r.depth/2;z+=3)box(parent,[.12,2,.12],'#62707c',[s*21.8,1,z],0,.65);
        plant(parent,s*20,back+2);plant(parent,s*20,r.depth/2-2);
      });
      box(parent,[44,.25,.3],'#5a6470',[0,-.2,r.depth/2],0,.7);
      box(parent,[43,.055,.09],'#ffc17c',[0,-.25,r.depth/2+.16],2);
      for(let x=-20;x<=20;x+=8){
        box(parent,[.08,.95,.08],'#526575',[x,.45,r.depth/2],0,.7);
        box(parent,[2.2,.13,.08],'#ffc17c',[x,-.6,r.depth/2+.16],2);
        box(parent,[1.65,.28,.6],'#111922',[x,4.65,back+.55]);
        box(parent,[1.25,.06,.45],'#ffe0a3',[x,4.48,back+.6],3);
        glow(parent,x,2.55,back+.31,4.8,5,false);
        glow(parent,x,.081,back+2.5,7,7);
      }
      box(parent,[44,.07,.08],'#71818d',[0,.95,r.depth/2],0,.7);
      // Service cabinets and cable channels at the rear add depth without invented controls.
      [-16,16].forEach(x=>{
        box(parent,[2.8,1.8,1.3],'#313d49',[x,.96,back+.9],0,.5);
        for(let y=.45;y<1.8;y+=.3)box(parent,[2.4,.055,.05],'#0f1822',[x,y,back+1.58]);
        box(parent,[.13,.13,.07],'#80b4ad',[x+.95,1.55,back+1.62],.5);
      });
    }
    function desk(parent,a,i,r,x,z){
      const g=group(parent,x,0,z);g.scale.setScalar(1.35);g.name='desk:'+a.id;
      box(g,[3.5,.2,2],'#48505a',[0,1.65,0],0,.5);
      box(g,[3.45,.035,.08],'#b08c5c',[0,1.75,1],.25);
      [-1.45,1.45].forEach(v=>{box(g,[.12,1.55,1.55],'#273540',[v,.8,0],0,.7);box(g,[.42,.08,1.85],'#475562',[v,.13,0],0,.7);});
      box(g,[.58,1.25,1.25],'#19232d',[1.02,.74,.1]);
      box(g,[.12,.08,.05],'#53c3bd',[1.05,1.2,.74],1.2);
      const display=group(g,0,2.47,-.4);display.rotation.x=-.07;
      box(display,[2.05,1.22,.15],'#121d27',[0,0,0]);
      const sm=new T.MeshBasicMaterial({map:screenMap,color:0xa6bccb});
      const screen=new T.Mesh(geometries.box,sm);screen.scale.set(1.89,1.04,.018);screen.position.set(0,0,.089);display.add(screen);
      box(g,[.16,.52,.18],'#62717f',[0,1.95,-.4],0,.7);box(g,[.8,.05,.5],'#283a46',[0,1.78,-.35]);
      box(g,[1.35,.06,.48],'#172b35',[-.14,1.8,.45]);
      for(let n=0;n<3;n++)box(g,[1.17,.015,.03],'#597b89',[-.14,1.84,.31+n*.13],.1);
      ball(g,[.13,.055,.2],'#8497a4',[.9,1.83,.4]);
      cyl(g,[.13,.32,.13],'#b9b0a0',[-1.32,1.9,.6]);
      // Adjustable chair, five spokes and casters.
      cyl(g,[.1,.65,.1],'#63737f',[0,.48,1.7]);
      for(let n=0;n<5;n++){const spoke=group(g,0,.18,1.7);spoke.rotation.y=n*Math.PI*2/5;box(spoke,[.075,.07,1.5],'#42535e',[0,0,0]);ball(spoke,[.14,.1,.14],'#15212b',[0,-.05,.7]);}
      box(g,[1.23,.22,1.12],'#263845',[0,.9,1.62]);
      const back=box(g,[1.2,1.18,.22],'#304550',[0,1.46,2.08]);back.rotation.x=.1;
      [-.68,.68].forEach(v=>{box(g,[.09,.6,.09],'#52616c',[v,1.17,1.65]);box(g,[.17,.09,.65],'#182a35',[v,1.49,1.57]);});
      const skin=['#d3a483','#93654f','#dec2a0','#b57d62','#c79c7b'][i%5];
      const cloth=['#486572','#52646b','#635b58','#426765','#5a596e'][i%5];
      const rig=group(g,0,1.15,1.52);rig.userData.motion=true;rig.name='agent:'+a.id;
      ball(rig,[.48,.58,.28],cloth,[0,.42,0]);
      cyl(rig,[.14,.24,.14],skin,[0,1.02,-.015]);
      const head=group(rig,0,1.25,-.025);head.name='head';
      ball(head,[.29,.36,.285],skin,[0,0,0]);
      ball(head,[.305,.22,.3],i%3===0?'#3a2e29':'#24272c',[0,.19,.02]);
      if(i%3===1)ball(head,[.29,.4,.15],'#302b2a',[0,-.12,.2]);
      ball(head,[.065,.085,.09],skin,[0,-.035,-.275]);
      [-.29,.29].forEach(v=>ball(head,[.055,.1,.075],skin,[v,-.03,0]));
      [-1,1].forEach(s=>{
        ball(g,[.22,.18,.48],'#293847',[s*.25,1.05,1.02]);
        const leg=box(g,[.28,.77,.28],'#293847',[s*.25,.63,.7]);leg.rotation.x=-.13;
        ball(g,[.2,.13,.38],'#17202a',[s*.25,.24,.49]);
      });
      const arms=[];
      [-1,1].forEach(s=>{
        const arm=group(rig,s*.45,.67,-.02);arm.name=s<0?'left-arm':'right-arm';
        const sleeve=ball(arm,[.145,.31,.145],cloth,[s*.025,-.21,-.12]);sleeve.rotation.x=.45;
        const forearm=ball(arm,[.12,.13,.34],skin,[s*.025,-.42,-.43]);forearm.rotation.x=-.12;
        ball(arm,[.13,.07,.18],skin,[s*.025,-.39,-.73]);arms.push(arm);
      });
      glow(g,0,.075,.1,4,3.5);
      return {screen,rig,head,arms};
    }
    function machine(parent,stage,i,r,x,z){
      box(parent,[6.8,.22,2.45],'#293743',[x,1.2,z],0,.65);
      [-1.15,1.15].forEach(s=>box(parent,[6.9,.18,.12],'#7b8893',[x,1.39,z+s],0,.7));
      box(parent,[.16,.07,2.45],'#d2a05b',[x-3.3,1.52,z],.35);
      const arrow=part(parent,'cone',[.16,.4,.035],'#c6cfd5',[x,1.5,z+1.25],.2);arrow.rotation.z=-Math.PI/2;arrow.rotation.y=Math.PI/2;
      [-2.6,2.6].forEach(s=>box(parent,[.18,1.2,1.85],'#495561',[x+s,.6,z],0,.7));
      const rollers=[];
      for(let j=0;j<12;j++){
        const roll=cyl(parent,[.15,2.12,.15],j%2?'#7a8790':'#566574',[x-3+j*.55,1.35,z],0,true);roll.rotation.x=Math.PI/2;
        // A small seam makes real rotation visible, even on cylindrical rollers.
        box(roll,[.08,1,.06],'#25333e',[.95,0,0],0,.1,true);rollers.push(roll);
      }
      box(parent,[.12,1.8,.12],'#61717e',[x-2.85,2.15,z-1],0,.7);
      const beacon=cyl(parent,[.17,.35,.17],'#67727d',[x-2.85,3.1,z-1],.8,true);beacon.material=beacon.material.clone();
      const glowLamp=glow(parent,x,.083,z,5,5);glowLamp.material=glowMaterial.clone();glowLamp.material.opacity=0;
      const tokens=[];
      for(let n=0;n<3;n++){
        const token=group(parent,x-1.2+n*1.2,1.88,z);token.userData.motion=true;token.visible=false;
        if(r.workflow==='youtube'){
          box(token,[.88,.62,.16],'#609fa8',[0,0,0]);box(token,[.7,.43,.025],'#213b4b',[0,0,.1]);
          const play=part(token,'cone',[.13,.24,.06],'#c7e7e6',[0,0,.13],.2);play.rotation.z=-Math.PI/2;
        }else{
          box(token,[.85,.65,.72],'#ad865b',[0,0,0]);box(token,[.12,.012,.73],'#d7bd8c',[0,.33,0]);box(token,[.4,.24,.014],'#e8dcca',[0,0,.37]);
        }
        token.userData.baseX=token.position.x;tokens.push(token);
      }
      return {beacon,glowLamp,tokens,rollers};
    }
    function bridge(x,z,w,d){
      const bridgeGroup=group(rootGroup);bridgeGroup.userData.productionBridge=z===0&&w>d;
      box(bridgeGroup,[w,.4,d],'#344250',[x,-.1,z],0,.6);
      const horizontal=w>d;
      [-1,1].forEach(s=>{
        const px=horizontal?x:x+s*(w/2-.1),pz=horizontal?z+s*(d/2-.1):z;
        box(bridgeGroup,[horizontal?w:.06,.06,horizontal?.06:d],'#e9b576',[px,.08,pz],2);
        box(bridgeGroup,[horizontal?w:.08,.08,horizontal?.08:d],'#71818c',[px,1.2,pz],0,.7);
        const len=horizontal?w:d;for(let n=-len/2;n<=len/2;n+=2)box(bridgeGroup,[.08,1.15,.08],'#526573',[horizontal?x+n:px,.6,horizontal?pz:z+n],0,.7);
      });
    }
    function finish(){
      // Most art is static. Batch matching geometry/material into GPU instances, while
      // leaving screens, articulated joints, beacons and queue objects independent.
      rootGroup.updateMatrixWorld(true);const batches=new Map();
      for(const m of staticParts){let animated=false;for(let p=m;p&&p!==rootGroup;p=p.parent){if(p.userData.motion)animated=true;if(p.userData.roomId)m.userData.roomId=p.userData.roomId;if(p.userData.productionBridge)m.userData.productionBridge=true;}if(animated)continue;
        const key=[m.geometry.uuid,m.material.uuid,m.userData.roomId||'',!!m.userData.productionBridge].join(':');let b=batches.get(key);if(!b){b=[];batches.set(key,b);}b.push(m);
      }
      for(const meshes of batches.values()){
        if(meshes.length<2)continue;
        const first=meshes[0],batch=new T.InstancedMesh(first.geometry,first.material,meshes.length);
        batch.name='room-art-batch';batch.castShadow=first.castShadow;batch.receiveShadow=true;
        batch.userData.roomId=first.userData.roomId;batch.userData.productionBridge=first.userData.productionBridge;
        meshes.forEach((m,i)=>{batch.setMatrixAt(i,m.matrixWorld);m.parent.remove(m);});batch.instanceMatrix.needsUpdate=true;rootGroup.add(batch);
      }
    }
    function dispose(){Object.values(geometries).forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());plane.dispose();glowMaterial.dispose();}
    return {room,desk,machine,bridge,finish,dispose};
  }
  root.ProductionRoomScene={create};
})(typeof globalThis!=='undefined'?globalThis:this);

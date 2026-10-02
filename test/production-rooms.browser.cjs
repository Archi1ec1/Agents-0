/* Optional real-browser integration: NODE_PATH must provide playwright. Uses an isolated
   profile and fixture Opus transport. No user station or external provider is contacted. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
const {SidecarFixture}=require('./helpers/sidecar-fixture.js');
const C=require('../frontend/app/presetcrews.js'),M=require('../frontend/app/worldmodel.js'),T=require('../frontend/app/stationtemplates.js'),P=require('../frontend/app/propsprites.js');
const root=path.resolve(__dirname,'..'),token='room-ui-fixture-token';
const fixture=new SidecarFixture({acquireToken:false,env:{STARNET_API_TOKEN:token,SKYNET_API_TOKEN:token,STARNET_CONNECTOR_ENCRYPTION_KEY:'cd'.repeat(32),NODE_OPTIONS:'--require "'+path.join(__dirname,'fixtures','shorts-opus-preload.cjs').replace(/\\/g,'/')+'"'}});
const seed={},ctx={window:{},localStorage:{getItem:k=>seed[k]||null,setItem:(k,v)=>seed[k]=v},setInterval:()=>0,clearInterval:()=>{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'website/app/demo-boot.js'),'utf8'),ctx);
const save=JSON.parse(seed['starnet.save']),crew=C.get('zakholding'),station=M.create(T.build('zakholding',M,P,1000));
save.agent.name='OVERSEER';save.agents=[];save.updatedAt=Date.now();const used=new Set();
crew.members.forEach((m,i)=>{
  const id='fixture-crew-'+i;save.agents.push({...save.agent,id,name:m.agentName,role:'specialist',specialtyId:m.cls,docs:C.docsFor(crew,m)});
  const room=station.rooms().find(r=>r.name===m.room);
  const desk=station.props().find(p=>p.t==='desk'&&!used.has(p.id)&&room.rects.some(r=>p.x>=r.x1&&p.x<=r.x2&&p.y>=r.y1&&p.y<=r.y2));
  used.add(desk.id);station.assignPropAgent(desk.id,id);
});
save.station=station.doc();seed['starnet.save']=JSON.stringify(save);seed['agent0.view']='3d';
seed['starnet.tutorial.v1']=JSON.stringify({v:1,firstCommandDone:true,seen:{quests:true,crew:true}});
let browser,page;
(async()=>{
  try{
    await fixture.start();
    browser=await chromium.launch({headless:true,channel:process.env.ROOMS_BROWSER_CHANNEL||'chrome',args:['--enable-unsafe-swiftshader']});
    page=await browser.newPage({viewport:{width:1600,height:1000},extraHTTPHeaders:{'X-StarNet-Token':token},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'||route.request().url().startsWith('data:')?route.continue():route.abort());
    // Read-only test instrumentation; r128 installs render on each instance, not the prototype.
    await page.route('**/app/office3d.js',async route=>{
      const response=await route.fetch();
      const observer='(function(){const Original=THREE.WebGLRenderer;THREE.WebGLRenderer=function(...args){const r=new Original(...args),render=r.render;r.render=function(scene,camera){window.__roomFixture={scene,camera};return render.call(this,scene,camera);};return r;};})();\n';
      await route.fulfill({response,body:observer+await response.text()});
    });
    await page.addInitScript(({seed})=>{window.__STARNET_DEV__={model:'anthropic/claude-haiku-4.5',prov:'openrouter'};for(const [k,v] of Object.entries(seed))localStorage.setItem(k,v);},{seed});
    await page.goto(fixture.baseUrl,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#stage-wrap.o3d-on',{timeout:45000});
    await page.waitForFunction(()=>document.querySelectorAll('.o3d-rooms button').length===5);
    await page.locator('.o3d-rooms button').filter({hasText:'YOUTUBE'}).click();
    assert.equal(await page.locator('.o3d-crew button').count(),5);
    assert.equal(await page.locator('.o3d-stations button').count(),6);
    await page.waitForFunction(()=>document.querySelector('.o3d-heading span').textContent.includes('SETUP'));
    // Instrument the renderer only in this test, to project actual raycast targets into pointer coordinates.
    await page.waitForFunction(()=>!!window.__roomFixture);
    // Real articulated meshes move only for the running roster ID, with reduced-motion respected.
    const movingId=save.agents.find(a=>a.name==='STELLA').id;
    await page.evaluate(id=>{window.__savedRunning=StationUI.isAgentRunning;StationUI.isAgentRunning=agentId=>agentId===id;Office3D._mounted().sync();},movingId);
    assert.equal(await page.evaluate(id=>window.__roomFixture.scene.getObjectByName('agent:'+id).getObjectByName('left-arm').rotation.x,movingId),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(id=>Math.abs(window.__roomFixture.scene.getObjectByName('agent:'+id).getObjectByName('left-arm').rotation.x)>.01,movingId);
    assert.equal(await page.evaluate(id=>{const agents=[];window.__roomFixture.scene.traverse(o=>{if(o.name.startsWith('agent:')&&o.name!=='agent:'+id)agents.push(o);});return agents.every(a=>a.getObjectByName('left-arm').rotation.x===0);},movingId),true);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(id=>window.__roomFixture.scene.getObjectByName('agent:'+id).getObjectByName('left-arm').rotation.x===0,movingId);
    await page.evaluate(()=>{StationUI.isAgentRunning=window.__savedRunning;Office3D._mounted().sync();});
    for(const name of ['STELLA','ECHO','QUILL','REEL','SPARK']){
      const agent=save.agents.find(a=>a.name===name);
      const point=await page.evaluate(id=>{
        const {scene,camera}=window.__roomFixture;let target;scene.traverse(o=>{if(o.userData.target?.id===id)target=o;});
        const v=target.getWorldPosition(new THREE.Vector3()).project(camera),r=document.getElementById('stage3d').getBoundingClientRect();return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};
      },agent.id);
      await page.mouse.click(point.x,point.y);
      await page.waitForFunction(name=>document.querySelector('.dossier .ag-name')?.textContent.toUpperCase().startsWith(name.toUpperCase()),name);
      await page.evaluate(()=>StationUI.closeTerm('agents'));
    }
    const stagePoint=await page.evaluate(()=>{const {scene,camera}=window.__roomFixture;let target;scene.traverse(o=>{if(o.userData.target?.type==='stage'&&o.userData.target.kind==='youtube'&&o.userData.target.stage==='permission')target=o;});const v=target.getWorldPosition(new THREE.Vector3()).project(camera),r=document.getElementById('stage3d').getBoundingClientRect();return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};});
    await page.mouse.click(stagePoint.x,stagePoint.y);assert.ok(await page.locator('.o3d-inspector h3').textContent().then(s=>s.includes('Permission')));
    await page.locator('[data-dismiss]').click();
    for(const coach of await page.locator('.tut-coach-ok').all())if(await coach.isVisible())await coach.click();
    await page.mouse.move(1590,5);
    const shotDir=process.env.ROOMS_SCREENSHOTS;
    await page.locator('[data-expand]').click();
    await page.waitForFunction(()=>document.getElementById('stage-wrap').clientWidth>1200);
    if(shotDir){fs.mkdirSync(shotDir,{recursive:true});await page.locator('#stage-wrap').screenshot({path:path.join(shotDir,'youtube-production-room.png')});await page.locator('[data-overview]').click();await page.mouse.move(1590,5);await page.locator('#stage-wrap').screenshot({path:path.join(shotDir,'connected-production-rooms-initial.png')});await page.locator('.o3d-rooms button').filter({hasText:'YOUTUBE'}).click();}
    await page.locator('.o3d-crew button').filter({hasText:'STELLA'}).click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"]')).some(d=>d.textContent.toUpperCase().includes('STELLA')));
    await page.evaluate(()=>StationUI.closeTerm('agents'));
    await page.locator('.o3d-tools button').filter({hasText:'Task board'}).click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"]')).some(d=>d.textContent.includes('TASK')));
    await page.evaluate(()=>StationUI.closeTerm('tasks'));
    await page.locator('[data-shortcuts="youtube"]').click();
    await page.waitForSelector('.shorts-shell');
    assert.ok(await page.locator('.shorts-window').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),'Shorts sheet stays on screen with header dock');
    await page.locator('.shorts-shell [data-section="sources"]').click();
    await page.locator('.shorts-shell [name="title"]').fill('UI licensed source');
    await page.locator('.shorts-shell [name="creator"]').fill('Fixture creator');
    await page.locator('.shorts-shell [name="url"]').fill('https://drive.google.com/file/d/ui-fixture/view');
    await page.locator('.shorts-shell [name="durationSec"]').fill('90');
    // A background read must not destroy partially completed forms.
    await page.evaluate(()=>ProductionFlow.getStore().refresh('youtube'));
    assert.equal(await page.locator('.shorts-shell [name="title"]').inputValue(),'UI licensed source');
    await page.locator('.shorts-shell button[type="submit"]').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.sources.length===1);
    await page.locator('.shorts-shell [data-section="permission"]').click();
    const sid=await page.evaluate(()=>ProductionFlow.getStore().get('youtube').data.sources[0].id);
    await page.locator('[name="sourceId"]').selectOption(sid);
    for(const [name,value] of [['evidence','Fixture permission'],['attribution','Credit fixture'],['originalityPlan','Add original explanation']])await page.locator('.shorts-shell [name="'+name+'"]').fill(value);
    for(const name of ['commercialEditsAllowed','sourceAccessConfirmed'])await page.locator('[name="'+name+'"]').check();
    await page.locator('.shorts-shell button[type="submit"]').click();
    await page.waitForFunction(()=>!!ProductionFlow.getStore().get('youtube').data.sources[0].clearance);
    await page.locator('.shorts-shell [data-section="setup"]').click();
    await page.locator('[name="orgId"]').fill('org_fixture');await page.locator('[name="apiKey"]').fill('fixture-short-token-0123456789');
    await page.locator('.shorts-shell button[type="submit"]').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.connection.configured);
    assert.equal(await page.locator('[name="apiKey"]').inputValue(),'');
    await page.locator('.shorts-shell [data-section="processing"]').click();
    const paidBodies=[];
    await page.route('**/api/shorts/jobs/submit',async route=>{
      paidBodies.push(route.request().postDataJSON());
      const response=await route.fetch();
      if(paidBodies.length===1)await route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"code":"fixture_lost_acknowledgement"}'});
      else await route.fulfill({response});
    });
    await page.locator('[name="confirmProcessing"]').check();await page.locator('form[data-path="jobs/submit"] button').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.jobs.length===1);
    await page.locator('.shorts-shell [data-retry]').click();
    await page.waitForSelector('.shorts-shell [data-retry]',{state:'detached'});
    assert.equal(paidBodies.length,2);assert.deepEqual(paidBodies[0],paidBodies[1]);
    await page.locator('form[data-path="jobs/refresh"] button').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.clips.length===1);
    await page.locator('.shorts-shell [data-section="review"]').click();
    await page.locator('[name="accountId"]').selectOption('youtube-fixture');
    for(const [name,value] of [['description','Credit Fixture creator'],['editorialNotes','Reviewed actual final clip'],['publishAt',new Date(Date.now()+86400000).toISOString().slice(0,16)]])await page.locator('.shorts-shell [name="'+name+'"]').fill(value);
    for(const name of ['rights','originality','captions','framing','audio'])await page.locator('[name="'+name+'"]').check();
    await page.locator('form[data-path="clips/approve"] button').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.approvals.length===1);
    assert.equal(await page.evaluate(()=>ProductionFlow.getStore().get('youtube').data.publications.length),0);
    await page.locator('.shorts-shell [data-section="schedule"]').click();await page.locator('[name="confirmPublication"]').check();await page.locator('form[data-path="publications/schedule"] button').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('youtube').data.publications[0]?.state==='scheduled');
    const providerCalls=fs.readFileSync(path.join(fixture.workspace,'shorts-provider-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(providerCalls.filter(c=>c.path==='/api/clip-projects').length,1);
    assert.equal(providerCalls.filter(c=>c.path==='/api/publish-schedules'&&c.method==='POST').length,1);
    await page.evaluate(()=>StationUI.closeTerm('shorts'));
    await page.waitForSelector('.shorts-shell',{state:'detached'});
    await page.locator('.o3d-rooms button').filter({hasText:'E-COMMERCE'}).click();
    await page.locator('.o3d-shop').click();await page.waitForSelector('#shop-panel:not([hidden])');
    await page.locator('#shop-panel [data-mode="demo"]').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('commerce').data?.mode==='demo');
    await page.locator('#shop-panel [data-step="paid"]').click();
    await page.waitForFunction(()=>ProductionFlow.getStore().get('commerce').data.orders.length>0);
    await page.keyboard.press('Escape');
    if(shotDir){await page.locator('#stage-wrap').screenshot({path:path.join(shotDir,'commerce-production-room.png')});await page.locator('[data-overview]').click();await page.locator('#stage-wrap').screenshot({path:path.join(shotDir,'connected-production-rooms.png')});}
    // Rejected GETs retain an explicitly stale view, including commerce demo orders.
    await page.route('**/api/commerce*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'}));
    await page.evaluate(()=>ProductionFlow.getStore().refresh('commerce'));
    assert.ok(await page.evaluate(()=>ProductionFlow.getStore().project('commerce').stages.every(s=>s.status==='unknown')));
    await page.locator('[data-view="classic"]').click();assert.ok(!await page.locator('#stage-wrap').evaluate(e=>e.classList.contains('o3d-on')));
    await page.locator('[data-view="3d"]').click();
    await page.locator('[data-expand]').click();
    for(const w of [1050,760,420]){
      await page.setViewportSize({width:w,height:900});await page.locator('.o3d-rooms button').filter({hasText:'YOUTUBE'}).click();assert.equal(await page.locator('.o3d-stations button').count(),6);
      const clipped=await page.evaluate(()=>{const r=document.getElementById('stage-wrap').getBoundingClientRect();return Array.from(document.querySelectorAll('.o3d-toolbar button')).filter(b=>b.offsetParent).some(b=>{const v=b.getBoundingClientRect();return v.left<r.left||v.right>r.right;});});assert.equal(clipped,false,'toolbar inside the scene at '+w);
      assert.ok(await page.evaluate(()=>document.querySelector('.o3d-crew').getBoundingClientRect().top-document.querySelector('.o3d-stations').getBoundingClientRect().bottom>20),'room controls do not collide at '+w);
      if(w<=760)assert.ok(await page.evaluate(()=>document.getElementById('chat-panel').getBoundingClientRect().top>=document.getElementById('stage-wrap').getBoundingClientRect().bottom-1),'chat does not cover the room at '+w);
      if(shotDir&&w===420)await page.locator('#stage-wrap').screenshot({path:path.join(shotDir,'production-room-small.png')});
    }
    await page.evaluate(()=>document.getElementById('stage3d').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
    assert.ok(!await page.locator('#stage-wrap').evaluate(e=>e.classList.contains('o3d-on')));
    assert.deepEqual(errors,[]);
    console.log('production-rooms.browser: PASS — actual app, real classic handlers, 19-agent roster, isolated authenticated workflows, separate approval/schedule, draft retention, stale states and Classic switch');
  }catch(e){
    if(page&&process.env.ROOMS_SCREENSHOTS){await page.screenshot({path:path.join(process.env.ROOMS_SCREENSHOTS,'failure.png')});console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('.shorts-shell,[role="dialog"],#stage-wrap')).map(e=>({class:e.className,id:e.id,rect:e.getBoundingClientRect().toJSON()}))));}throw e;
  }finally{if(browser)await browser.close();await fixture.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});

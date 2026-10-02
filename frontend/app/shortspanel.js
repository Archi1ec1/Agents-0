/* The production room opens the existing StationUI window manager.
   Commands go through the authenticated Shorts service; drawing a room never submits work. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ShortsPanel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arr=v=>Array.isArray(v)?v:[];
  const tabs=[['setup','Connection'],['sources','Sources'],['permission','Permission'],['processing','Clipping'],['review','Review'],['schedule','Schedule'],['verify','Verify']];
  const field=(name,label,type='text',extra='')=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" required '+extra+'></label>';
  const area=(name,label,max=1000)=>'<label>'+esc(label)+'<textarea name="'+name+'" maxlength="'+max+'" required></textarea></label>';
  const check=(name,label)=>'<label class="shorts-check"><input type="checkbox" name="'+name+'" required> '+esc(label)+'</label>';
  const hidden=(name,value)=>'<input type="hidden" name="'+name+'" value="'+esc(value)+'">';
  const button=(text,disabled)=>'<button type="submit"'+(disabled?' disabled':'')+'>'+esc(text)+'</button>';
  const form=(path,content)=>'<form data-path="'+path+'">'+content+'</form>';
  const card=(title,content)=>'<article class="shorts-card"><h3>'+esc(title)+'</h3>'+content+'</article>';
  const pick=(name,label,rows)=>'<label>'+esc(label)+'<select name="'+name+'" required><option value="">Choose…</option>'+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.title||r.name||r.id)+'</option>').join('')+'</select></label>';
  function mediaUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname.endsWith('.cdn.opus.pro')&&!u.username&&!u.password?u.href:null;}catch(_){return null;}}
  function renderSection(section,s){
    if(!s)return '<p>Loading saved workflow…</p>';
    const conn=s.connection||{},cap=s.capabilities||{},sources=arr(s.sources),jobs=arr(s.jobs),clips=arr(s.clips),approvals=arr(s.approvals),pubs=arr(s.publications);
    if(section==='setup')return card('Connect Opus',
      '<p>'+esc(conn.configured?'Connected. A live trial is still needed to verify API entitlement.':'No account is connected. You can prepare sources before subscribing.')+'</p>'+
      '<p>Connect your YouTube channel in Opus first. Credentials are stored with desktop encryption.</p>'+
      (!cap.configure?'<p class="shorts-warning">Encrypted storage is unavailable. Open THE LAB desktop to configure this connection.</p>':'')+
      form('connect',field('orgId','Opus organization ID','text','autocomplete="off" maxlength="128"')+field('apiKey','Opus API key','password','autocomplete="new-password" maxlength="512"')+button('Check and save connection',!cap.configure))+
      '<p>Channels: '+esc(arr(conn.accounts).map(a=>a.name).join(', ')||'None verified')+'</p>');
    if(section==='sources')return card('Add a creator-supplied source',
      '<p>Use a licensed file, or a YouTube channel already verified with Opus. A public viral video link alone is not permission.</p>'+
      form('sources',field('title','Source title','text','maxlength="200"')+field('creator','Creator','text','maxlength="200"')+field('url','Authorized source URL','url','maxlength="2000"')+
      '<label>Source type<select name="kind"><option value="licensed_file">Licensed file (Drive, Dropbox or public S3)</option><option value="verified_youtube">YouTube owner verified in Opus</option></select></label>'+
      field('durationSec','Full source duration, seconds','number','min="1" max="18000" step="1"')+button('Save source',!cap.prepareSources)))+
      sources.map(s=>card(s.title,'<p>'+esc(s.creator)+' · '+esc(s.durationSec)+' sec · '+(s.clearance?'Permission recorded':'Needs permission')+'</p>')).join('');
    if(section==='permission'){
      const eligible=sources.filter(s=>!jobs.some(j=>j.sourceId===s.id));
      return card('Record permission and your original contribution',
        '<p>These are your attestations. Add the explanation or commentary in the actual edit before approval.</p>'+
        form('sources/clear',pick('sourceId','Source',eligible)+area('evidence','Permission / license reference')+area('attribution','Required credit')+area('originalityPlan','Original explanation or commentary you will add')+
        check('commercialEditsAllowed','The permission allows these commercial edits')+check('sourceAccessConfirmed','The authorized file or verified owner access is available to Opus')+button('Record clearance',!eligible.length)));
    }
    if(section==='processing')return (sources.filter(s=>s.clearance&&!jobs.some(j=>j.sourceId===s.id)).map(s=>{
      const estimate=Math.max(10,Math.ceil(s.durationSec/60));
      return card(s.title,'<p>Estimated reservation: <b>'+estimate+' credits</b> for '+s.durationSec+' seconds. Check your provider balance; the local allowance is not a billing guarantee.</p>'+
        form('jobs/submit',hidden('sourceId',s.id)+hidden('maxCredits',estimate)+check('confirmProcessing','I confirm this billable clipping request')+button('Submit to Opus',!cap.submit)));
    }).join('')||'<p>No cleared source is waiting for processing.</p>')+jobs.map(j=>card((sources.find(s=>s.id===j.sourceId)||{}).title||j.sourceId,
      '<p>'+esc(j.state)+' · '+esc(j.errorCode||'')+'</p>'+form('jobs/refresh',hidden('jobId',j.id)+button('Refresh exports',!conn.configured||!j.projectId))+
      (!j.projectId&&j.state==='submission_unknown'?'<p>Find this source in Opus before linking an existing project. Do not resubmit it.</p>'+form('jobs/reconcile',hidden('jobId',j.id)+field('projectId','Existing Opus project ID')+area('evidence','How you matched this project to the source')+check('confirmSourceMatch','I checked the source and THE LAB marker in Opus')+button('Reconcile existing project',!conn.configured)):'')
    )).join('');
    if(section==='review')return clips.filter(c=>c.available&&!pubs.some(p=>p.clipId===c.id)).map(c=>{
      const url=mediaUrl(c.previewUrl)||mediaUrl(c.exportUrl);
      return card(c.title,(url?'<video controls preload="none" referrerpolicy="no-referrer" src="'+esc(url)+'"></video>':'<p>No playable export URL. Review the clip in Opus.</p>')+
        '<p>Edit the actual video in Opus, then refresh exports before approving. Notes here do not change the render.</p>'+form('clips/approve',hidden('clipId',c.id)+hidden('fingerprint',c.fingerprint)+pick('accountId','YouTube destination',arr(conn.accounts))+
        field('title','Publication title','text','maxlength="100" value="'+esc(c.title)+'"')+area('description','Description and credit',4500)+field('publishAt','Publish time (your local timezone)','datetime-local')+area('editorialNotes','What you reviewed in the final render')+
        check('rights','Permission and credit checked')+check('originality','Original contribution present in the actual video')+check('captions','Captions checked')+check('framing','Vertical framing checked')+check('audio','Audio checked')+button('Save approval — does not publish',!conn.configured)));
    }).join('')||'<p>No exported clip is awaiting editorial review.</p>';
    if(section==='schedule')return (approvals.filter(a=>a.valid&&!pubs.some(p=>p.clipId===a.clipId)).map(a=>card(a.title,
      '<p>Destination: '+esc((arr(conn.accounts).find(c=>c.id===a.accountId)||{}).name||a.accountId)+'<br>'+esc(a.publishAt)+'</p><p>'+esc(a.description)+'</p>'+
      form('publications/schedule',hidden('approvalId',a.id)+check('confirmPublication','I confirm this destination, content and publication time')+button('Confirm schedule in Opus',!cap.schedule)))).join('')||'<p>No approved clip is ready to schedule.</p>')+
      pubs.map(p=>{
        const a=approvals.find(a=>a.id===p.approvalId)||{};
        return card(a.title||p.clipId,'<p>'+esc(p.state)+' · '+esc(a.publishAt)+'<br>'+esc(p.errorCode||'')+'</p>'+
          (p.state==='scheduled'?form('publications/cancel',hidden('publicationId',p.id)+check('confirmCancellation','Cancel this known future schedule')+button('Request cancellation',!conn.configured)):'')+
          (/unknown/.test(p.state)?'<p>Outcome unknown. Inspect Opus; a new scheduling attempt is not available.</p>':''));
      }).join('');
    return card('Verify the published result','<p>A scheduled time passing is not proof of publication. Verify the actual video and visibility in YouTube Studio.</p><p><a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">Open YouTube Studio</a> · <a href="https://www.opus.pro/" target="_blank" rel="noopener noreferrer">Open Opus</a></p>')+
      arr(s.attention).map(a=>card(a.targetId,'<p>'+esc(a.code)+'</p>')).join('');
  }
  // Form conversion is pure and tested independently of the DOM.
  function payload(path,v,makeId){
    const out={...v};
    if(path==='sources'){out.sourceId=makeId();out.durationSec=Number(out.durationSec);}
    if(path==='jobs/submit')out.maxCredits=Number(out.maxCredits);
    for(const k of ['commercialEditsAllowed','sourceAccessConfirmed','confirmProcessing','confirmSourceMatch','confirmPublication','confirmCancellation'])if(k in out)out[k]=out[k]==='on'||out[k]===true;
    if(path==='clips/approve'){
      out.publishAt=new Date(out.publishAt).toISOString();out.checks={};
      for(const k of ['rights','originality','captions','framing','audio']){out.checks[k]=out[k]==='on'||out[k]===true;delete out[k];}
    }
    out.actionId=makeId();return out;
  }
  let body=null,section='sources',unsubscribe=null,registered=false,busy=false,pending=null,notice='',opener=null,failedDraft=null,refreshTimer=null;
  const newId=()=> 'ui.'+crypto.randomUUID();
  function store(){return ProductionFlow.getStore();}
  function summary(){const e=store().get('youtube'),s=e.data;return e.error?'Read failed — displayed data may be stale.':s?((s.connection||{}).configured?'Opus configured':'Opus not connected')+' · '+((s.budget||{}).remainingCredits??'—')+' estimated credits remain':'Loading…';}
  function paint(){
    if(!body||!body.isConnected)return;
    const e=store().get('youtube');
    body.innerHTML='<div class="shorts-shell"><nav aria-label="Shorts stages">'+tabs.map(([id,label])=>'<button type="button" data-section="'+id+'" aria-pressed="'+(id===section)+'">'+label+'</button>').join('')+'</nav>'+
      '<p class="shorts-state" role="status">'+esc(summary())+'</p><button type="button" data-refresh>Refresh saved state</button>'+
      '<p class="shorts-notice" role="status">'+esc(notice)+'</p>'+(pending&&!busy?'<button type="button" data-retry>Retry the same request safely</button><p>Keep this request unchanged until its outcome is known.</p>':'')+
      '<div class="shorts-content">'+renderSection(section,e.data)+'</div></div>';
    if(failedDraft){
      const form=Array.from(body.querySelectorAll('form')).find(f=>f.dataset.path===failedDraft.path&&(!failedDraft.values.clipId||f.elements.namedItem('clipId')?.value===failedDraft.values.clipId));
      if(form){for(const [name,value] of Object.entries(failedDraft.values)){const input=form.elements.namedItem(name);if(input&&input.type!=='password'){if(input.type==='checkbox')input.checked=value==='on';else input.value=value;}}body.dataset.dirty='true';failedDraft=null;}
    }
    if(busy||pending)body.querySelectorAll('form button,form input,form select,form textarea').forEach(b=>b.disabled=true);
  }
  async function send(){
    if(!pending||busy)return;busy=true;notice='Saving request…';paint();
    const command=pending,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const r=await fetch('/api/shorts/'+command.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command.data),signal:controller.signal});
      const j=await r.json();
      if(!r.ok||!j.ok){
        if(r.status>=400&&r.status<500)pending=null;
        throw new Error(j.code||'Request could not be verified');
      }
      pending=null;notice='Request recorded. Check the resulting state below; an acknowledgement alone is not provider success.';
    }catch(e){notice='Request not confirmed: '+e.message+'. '+(pending?'Retry uses the same action ID.':'Review the fields and saved state.');if(!pending&&command.path!=='connect')failedDraft={path:command.path,values:command.raw};}
    finally{
      clearTimeout(timer);
      // Never retain credentials in retry state or a hidden form.
      if(command.path==='connect'){command.data.apiKey='';pending=null;}
      await store().refresh('youtube');busy=false;paint();
    }
  }
  function build(target){
    body=target;paint();if(unsubscribe)unsubscribe();
    unsubscribe=store().subscribe(()=>{
      if(!body||!body.isConnected)return;
      const status=body.querySelector('.shorts-state');if(status)status.textContent=summary();
      // Saved-state refresh never destroys a draft or a partially completed approval.
      if(!body.dataset.dirty&&!busy&&!pending)paint();
    });
    body.oninput=()=>{body.dataset.dirty='true';};
    body.onclick=ev=>{
      const b=ev.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.section){section=b.dataset.section;delete body.dataset.dirty;paint();}
      if(b.hasAttribute('data-refresh'))store().refresh('youtube').then(()=>{if(!body.dataset.dirty)paint();else notice='Saved state refreshed. Your draft is retained.';});
      if(b.hasAttribute('data-retry'))send();
    };
    body.onsubmit=ev=>{
      ev.preventDefault();if(busy||pending)return;
      try{const raw=Object.fromEntries(new FormData(ev.target));pending={path:ev.target.dataset.path,data:payload(ev.target.dataset.path,raw,newId),raw:ev.target.dataset.path==='connect'?null:raw};delete body.dataset.dirty;send();}
      catch(_){notice='Check the date and required fields.';paint();}
    };
    store().refresh('youtube');clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(body&&body.isConnected&&!document.hidden)store().refresh('youtube');},15000);
  }
  function open(stage){
    if(typeof StationUI==='undefined'||typeof ProductionFlow==='undefined')return;
    if(!registered){StationUI.registerWindow('shorts','YOUTUBE — PRODUCTION',build,{console:true,className:'shorts-window',onClose:()=>{if(unsubscribe)unsubscribe();unsubscribe=null;clearInterval(refreshTimer);body=null;if(opener&&opener.isConnected)opener.focus();}});registered=true;}
    opener=document.activeElement;
    // Reopening a station must not silently replace an in-progress form.
    if(!body||!body.isConnected||!body.dataset.dirty)section=tabs.some(t=>t[0]===stage)?stage:'sources';
    StationUI.openTerm('shorts');if(body&&!body.dataset.dirty)paint();
  }
  return {open,renderSection,payload,mediaUrl};
});

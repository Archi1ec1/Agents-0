/* Saved workflow projections shared by the production rooms and Shorts controls.
   GETs only in the room view. Source/clip status never claims an agent is running. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductionFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STAGES = {
    youtube: [['sources','Sources'],['permission','Permission'],['processing','Clipping'],['review','Review'],['schedule','Schedule'],['verify','Verify']],
    commerce: [['products','Products'],['listings','Listings'],['orders','Orders'],['production','Production'],['shipping','Shipping'],['delivered','Delivered']]
  };
  const list = v => Array.isArray(v) ? v : [];
  const clean = v => String(v == null ? '' : v).replace(/[\x00-\x1f]/g, ' ').slice(0, 250);
  function project(kind, entry, now) {
    const defs = STAGES[kind] || [], data = entry && entry.data;
    const stages = defs.map(([id,label]) => ({ id,label,items:[],status:'idle',note:'No work queued',count:0 }));
    const by = Object.fromEntries(stages.map(s=>[s.id,s]));
    const add = (stage,id,label,status,detail,since) => {
      if (by[stage]) by[stage].items.push({id:clean(id),label:clean(label),status,detail:clean(detail),since:since||null});
    };
    const result = {kind,stages,mode:data ? data.mode : 'unavailable',notice:'Loading workflow…',attention:[],stale:!!(entry && entry.error),loadedAt:entry && entry.loadedAt};
    if (!data) {
      result.notice=entry && entry.error ? 'Workflow unavailable. Retry to check its state.' : 'Loading workflow…';
      stages.forEach(s=>{s.status='unknown';s.note=result.notice;});
      return result;
    }
    result.notice=clean(data.notice || (data.mode==='demo'?'Demonstration only':'Saved workflow'));
    if (kind==='youtube') {
      const jobs=list(data.jobs),clips=list(data.clips),pubs=list(data.publications);
      const approved=new Set(list(data.approvals).filter(a=>a.valid).map(a=>a.clipId));
      list(data.sources).forEach(s=>{
        if(jobs.some(j=>j.sourceId===s.id))return;
        add(s.clearance?'sources':'permission','source:'+s.id,s.title,s.clearance?'ready':'review',s.clearance?'Ready for confirmed processing':'Permission and source access required',s.createdAt);
      });
      jobs.forEach(j=>{
        if(j.state==='review' && clips.some(c=>c.jobId===j.id && c.available))return;
        const status=['submission_unknown','attention','rejected'].includes(j.state)?'blocked':['processing','submitting'].includes(j.state)?'working':'review';
        add('processing','job:'+j.id,j.sourceId,status,j.errorCode || ({submission_unknown:'Check Opus before retrying',processing:'Provider processing; progress percentage unavailable',submitting:'Submission in progress',attention:'Inspect this project in Opus',rejected:'Provider rejected the request'})[j.state] || j.state,j.createdAt);
      });
      clips.filter(c=>c.available).forEach(c=>{
        const p=pubs.find(p=>p.clipId===c.id);
        if(!p)add(approved.has(c.id)?'schedule':'review','clip:'+c.id,c.title,approved.has(c.id)?'ready':'review',approved.has(c.id)?'Approved; waiting for scheduling confirmation':'Final clip needs editorial review',c.fetchedAt);
      });
      pubs.forEach(p=>{
        const a=list(data.approvals).find(a=>a.id===p.approvalId),c=clips.find(c=>c.id===p.clipId);
        const due=p.state==='scheduled' && a && Date.parse(a.publishAt)<=Date.parse(now);
        const uncertain=['schedule_unknown','cancel_unknown'].includes(p.state);
        add(due?'verify':'schedule','publication:'+p.id,c?c.title:p.clipId,uncertain||p.state==='rejected'?'blocked':due?'review':p.state==='canceled'?'idle':'ready',due?'Scheduled time passed. Verify publication; it is not confirmed.':uncertain?'Outcome unknown. Inspect the schedule in Opus.':p.state,a&&a.publishAt);
      });
      if(!data.connection || !data.connection.configured){by.processing.status='review';by.processing.note='Connect Opus to process videos';result.attention.push({stage:'processing',detail:'Opus setup required'});}
      if(data.connection && data.connection.status==='locked'){by.processing.status='blocked';by.processing.note='Credential storage is locked';}
    } else if(kind==='commerce') {
      list(data.products).forEach(p=>add('products','product:'+p.id,p.title||p.name||p.id,'ready','Recorded product mapping; not a live listing',null));
      by.listings.note='Live listing publication is not connected';
      list(data.orders).forEach(o=>{
        const exception=list(data.exceptions).find(e=>e.orderId===o.id && e.status==='open');
        const stage=({processing:'production',failed:'production',shipped:'shipping',delivered:'delivered'})[o.fulfillmentStatus]||'orders';
        const status=exception?'blocked':o.fulfillmentStatus==='processing'?'working':o.fulfillmentStatus==='delivered'?'ready':'review';
        add(stage,o.id,o.channelOrderId,status,exception?exception.summary:(o.cancellationStatus!=='none'?'Cancellation: '+o.cancellationStatus:o.fulfillmentStatus),o.updatedAt);
      });
      if(data.mode!=='demo'){by.orders.note='Etsy and supplier are not connected';by.orders.status='review';result.attention.push({stage:'orders',detail:by.orders.note});}
    }
    const priority={idle:0,ready:1,working:2,review:3,blocked:4,unknown:5};
    stages.forEach(s=>{
      s.count=s.items.length;
      s.items.forEach(i=>{if(priority[i.status]>priority[s.status])s.status=i.status;});
      const problem=s.items.find(i=>i.status==='blocked') || s.items.find(i=>i.status==='review');
      if(problem)s.note=problem.detail;else if(s.count)s.note=s.count+' recorded item'+(s.count===1?'':'s');
      if(problem)result.attention.push({stage:s.id,detail:problem.detail});
      if(result.stale){s.status='unknown';s.note='Refresh failed. Last saved view is stale.';}
    });
    if(result.stale)result.notice='Refresh failed. Showing the last successful read, not current provider status.';
    return result;
  }
  function create(options) {
    const request=options.request,now=options.now;
    let commerceMode='disconnected',disposed=false;
    const entries={youtube:{data:null,error:null,loadedAt:null},commerce:{data:null,error:null,loadedAt:null}},pending={},listeners=new Set();
    function notify(){listeners.forEach(fn=>fn());}
    async function refresh(kind) {
      if(disposed)return;
      if(pending[kind])return pending[kind];
      const mode=commerceMode;
      const operation=(async()=>{
        try{
          const data=await request(kind==='youtube'?'/api/shorts':'/api/commerce'+(mode==='demo'?'?mode=demo':''));
          if(disposed || (kind==='commerce'&&mode!==commerceMode))return;
          if(!data || data.ok!==true || !Array.isArray(kind==='youtube'?data.sources:data.orders))throw new Error('Invalid workflow response');
          entries[kind]={data,error:null,loadedAt:now()};
        }catch(e){if(!disposed && (kind!=='commerce'||mode===commerceMode))entries[kind]={...entries[kind],error:'Refresh unavailable'};}
        finally{if(!disposed)notify();}
      })();
      pending[kind]=operation;try{await operation;}finally{if(pending[kind]===operation)delete pending[kind];}
    }
    function setCommerceMode(mode){const next=mode==='demo'?'demo':'disconnected';if(next===commerceMode)return;commerceMode=next;entries.commerce={data:null,error:null,loadedAt:null};notify();const old=pending.commerce;if(old)old.finally(()=>refresh('commerce'));else refresh('commerce');}
    return {refresh,get:kind=>entries[kind],project:kind=>project(kind,entries[kind],now()),setCommerceMode,
      subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},dispose:()=>{disposed=true;listeners.clear();}};
  }
  let shared=null;
  function getStore(){
    if(!shared)shared=create({now:()=>new Date().toISOString(),request:async url=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      try{const r=await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}
    }});
    return shared;
  }
  return {STAGES,project,create,getStore};
});

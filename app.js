/* Big Ben RMC - Asphalt QC Monitoring | app.js */

const firebaseConfig = {
  apiKey:            "AIzaSyAnw-jxJHoVKz_NXX2HWFTiWsQ5aP_oB9Q",
  authDomain:        "bigben-asphalt-qc.firebaseapp.com",
  databaseURL:       "https://bigben-asphalt-qc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "bigben-asphalt-qc",
  storageBucket:     "bigben-asphalt-qc.firebasestorage.app",
  messagingSenderId: "1069991782524",
  appId:             "1:1069991782524:web:ddd9402b422233aed2c1f9"
};

/* === SPECS === */
let SPECS = {
  stability:{ min:3.3, max:8.0 },
  flow:     { min:2.0, max:3.5 },
  airVoids: { min:3.0, max:5.0 },
  vma:      { min:13.0,max:16.0 },
  vfb:      { min:65.0,max:75.0 },
  bitTol:   0.4,
  coreMin:  3, coreMax: 30,
  daysOnTime: 3
};

/* === STATE === */
let layings=[], editLayIdx=null, testLayIdx=null;
let gaugeCharts={}, trendChart=null, activeTab='kpi';
let db=null, isOnline=navigator.onLine, pendingSync=[], modalIsOpen=false;
const LS_L='asphalt_qc_v2', LS_S='asphalt_qc_specs_v2';

/* === UTILS === */
const gv=id=>{ const e=document.getElementById(id); return e?e.value:''; };
const sv=(id,v)=>{ const e=document.getElementById(id); if(e) e.value=v||''; };
const inRange=(v,min,max)=>{ const n=parseFloat(v); return !isNaN(n)&&n>=min&&n<=max; };
const avg=arr=>{ const v=arr.filter(x=>x!==''&&x!==null&&x!==undefined&&!isNaN(parseFloat(x))).map(Number); return v.length?(v.reduce((a,b)=>a+b,0)/v.length):null; };
const fmtAvg=(v,dec=2)=>v!==null?parseFloat(v).toFixed(dec):'';

function localDate(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(s,n){ const p=s.split('-'); const d=new Date(+p[0],+p[1]-1,+p[2]); d.setDate(d.getDate()+n); return localDate(d); }
function daysBetween(a,b){ return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/(864e5)); }
function tlStatus(laid,tested){ if(!laid||!tested) return 'Pending'; return daysBetween(laid,tested)<=SPECS.daysOnTime?'On Time':'Late'; }

/* === ONLINE === */
function updateOnline(){
  isOnline=navigator.onLine;
  const el=document.getElementById('online-indicator');
  if(el){ el.textContent=isOnline?'Online':'Offline';
    el.style.background=isOnline?'#EAF3DE':'#FAEEDA';
    el.style.color=isOnline?'#3B6D11':'#854F0B';
    el.style.border=isOnline?'0.5px solid #639922':'0.5px solid #EF9F27'; }
  if(isOnline) syncPending();
}
window.addEventListener('online',updateOnline);
window.addEventListener('offline',updateOnline);

/* === LOCAL STORAGE === */
function saveLocal(){ try{ localStorage.setItem(LS_L,JSON.stringify(layings)); }catch(e){} }
function loadLocal(){
  try{
    const l=localStorage.getItem(LS_L); if(l) layings=JSON.parse(l);
    const s=localStorage.getItem(LS_S); if(s) SPECS={...SPECS,...JSON.parse(s)};
  }catch(e){}
}

/* === FIREBASE === */
function initFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);
    db=firebase.database();
    db.ref('layings').on('value',snap=>{
      const val=snap.val();
      layings=val?Object.entries(val).map(([id,d])=>({...d,_id:id})):[];
      layings.sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));
      saveLocal(); updateAC();
      if(modalIsOpen) return;
      buildMonthSel(); render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
    });
    db.ref('specs').once('value',snap=>{ if(snap.val()){ SPECS={...SPECS,...snap.val()}; loadSpecsForm(); } });
  }catch(e){ toast('Offline mode','#854F0B'); }
}
function syncPending(){
  if(!db||!pendingSync.length) return;
  const q=[...pendingSync]; pendingSync=[];
  q.forEach(e=>db.ref('layings').push(e).catch(()=>pendingSync.push(e)));
}

/* === MONTH SELECT === */
function buildMonthSel(){
  const sel=document.getElementById('sel-month'); if(!sel) return;
  const cur=sel.value;
  const months=new Set(layings.map(d=>(d.dateLaid||'').slice(0,7)).filter(Boolean));
  const now=new Date(), tm=localDate(now).slice(0,7); months.add(tm);
  sel.innerHTML='';
  const ao=document.createElement('option'); ao.value='all'; ao.textContent='All Months';
  if(cur==='all') ao.selected=true; sel.appendChild(ao);
  [...months].sort().reverse().forEach(m=>{
    const [y,mo]=m.split('-');
    const lbl=new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'});
    const o=document.createElement('option'); o.value=m; o.textContent=lbl;
    if(m===(cur||tm)) o.selected=true; sel.appendChild(o);
  });
}
function selMonth(){ return gv('sel-month'); }
function monthLayings(){ const m=selMonth(); if(m==='all') return [...layings]; return layings.filter(d=>(d.dateLaid||'').startsWith(m)); }

/* === SPECS === */
function loadSpecsForm(){
  sv('sp-smin',SPECS.stability.min); sv('sp-smax',SPECS.stability.max);
  sv('sp-fmin',SPECS.flow.min);      sv('sp-fmax',SPECS.flow.max);
  sv('sp-avmin',SPECS.airVoids.min); sv('sp-avmax',SPECS.airVoids.max);
  sv('sp-vmamin',SPECS.vma.min);     sv('sp-vmamax',SPECS.vma.max);
  sv('sp-vfbmin',SPECS.vfb.min);     sv('sp-vfbmax',SPECS.vfb.max);
  sv('sp-bittol',SPECS.bitTol);
  sv('sp-cmin',SPECS.coreMin);       sv('sp-cmax',SPECS.coreMax);
  sv('sp-days',SPECS.daysOnTime);
}
function saveSpecs(){
  SPECS={
    stability:{min:parseFloat(gv('sp-smin'))||3.3, max:parseFloat(gv('sp-smax'))||8.0},
    flow:     {min:parseFloat(gv('sp-fmin'))||2.0, max:parseFloat(gv('sp-fmax'))||3.5},
    airVoids: {min:parseFloat(gv('sp-avmin'))||3.0, max:parseFloat(gv('sp-avmax'))||5.0},
    vma:      {min:parseFloat(gv('sp-vmamin'))||13.0, max:parseFloat(gv('sp-vmamax'))||16.0},
    vfb:      {min:parseFloat(gv('sp-vfbmin'))||65.0, max:parseFloat(gv('sp-vfbmax'))||75.0},
    bitTol:   parseFloat(gv('sp-bittol'))||0.4,
    coreMin:  parseInt(gv('sp-cmin'))||3, coreMax: parseInt(gv('sp-cmax'))||30,
    daysOnTime: parseInt(gv('sp-days'))||3
  };
  try{ localStorage.setItem(LS_S,JSON.stringify(SPECS)); }catch(e){}
  if(db) db.ref('specs').set(SPECS);
  toast('Specs saved!','#639922');
}

/* === PASS/FAIL === */
function evalResult(t){
  const type=t.testType;
  if(type==='Marshall Test'){
    const fields=['stability','flow','airVoids','vma','vfb'];
    const avgs=[t.stabAvg,t.flowAvg,t.avAvg,t.vmaAvg,t.vfbAvg];
    const specs=[SPECS.stability,SPECS.flow,SPECS.airVoids,SPECS.vma,SPECS.vfb];
    const entered=avgs.filter(v=>v!==''&&v!==undefined&&v!==null&&!isNaN(parseFloat(v)));
    if(!entered.length) return 'Pending';
    for(let i=0;i<avgs.length;i++){
      if(avgs[i]!==''&&avgs[i]!==null&&avgs[i]!==undefined&&!isNaN(parseFloat(avgs[i]))){
        if(!inRange(avgs[i],specs[i].min,specs[i].max)) return 'Failed';
      }
    }
    return 'Passed';
  }
  if(type==='Extraction Test'){
    if(!t.bitumen) return 'Pending';
    if(!t.bitTarget) return 'Pending';
    return Math.abs(parseFloat(t.bitumen)-parseFloat(t.bitTarget))<=SPECS.bitTol?'Passed':'Failed';
  }
  if(type==='Air Voids/VMA/VFB'){
    const vals=[{v:t.airVoids,s:SPECS.airVoids},{v:t.vma,s:SPECS.vma},{v:t.vfb,s:SPECS.vfb}];
    const entered=vals.filter(x=>x.v!==''&&x.v!==undefined&&!isNaN(parseFloat(x.v)));
    if(!entered.length) return 'Pending';
    for(const {v,s} of entered){ if(!inRange(v,s.min,s.max)) return 'Failed'; }
    return 'Passed';
  }
  if(type==='Coring'){
    const c=parseInt(t.coreCount)||0;
    if(!c) return 'Pending';
    return (c>=SPECS.coreMin&&c<=SPECS.coreMax)?'Passed':'Failed';
  }
  return 'Pending';
}

function layingOverall(lay){
  const tests=Object.values(lay.tests||{});
  if(!tests.length) return 'Pending';
  if(tests.some(t=>evalResult(t)==='Failed')) return 'Failed';
  if(tests.every(t=>evalResult(t)==='Passed')) return 'Passed';
  return 'Pending';
}

/* === TABS === */
function setTab(name,btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  const t=document.getElementById('tab-'+name); if(t) t.classList.add('active');
  activeTab=name;
  if(name==='kpi') setTimeout(renderCharts,80);
  if(name==='specs') loadSpecsForm();
}

/* === RENDER === */
function render(){
  const now=new Date();
  const de=document.getElementById('cur-date');
  if(de) de.textContent=now.toLocaleDateString('en-PH',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
  const m=selMonth(), lbl=m==='all'?'All Months':(()=>{const [y,mo]=(m||'').split('-');return y&&mo?new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'}):'';})();
  ['s1-lbl','s2-lbl','s3-lbl','trend-lbl'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=lbl;});
  const md=monthLayings();
  renderKPI(md); renderSheet1(); renderSheet2(); renderSheet3();
}

/* === KPI === */
function renderKPI(md){
  let tot=0,pass=0,fail=0,pend=0,ont=0,lat=0,tlp=0;
  const typeMap={};
  ['Marshall Test','Extraction Test','Air Voids/VMA/VFB','Coring'].forEach(t=>typeMap[t]={p:0,f:0});

  md.forEach(lay=>{
    const tests=Object.values(lay.tests||{});
    if(!tests.length){pend++;tlp++;return;}
    const first=tests.sort((a,b)=>(a.dateTested||'').localeCompare(b.dateTested||''))[0];
    const tl=tlStatus(lay.dateLaid,first.dateTested);
    if(tl==='On Time')ont++;else if(tl==='Late')lat++;else tlp++;
    tests.forEach(t=>{
      tot++;
      const r=evalResult(t);
      if(r==='Passed'){pass++;if(typeMap[t.testType])typeMap[t.testType].p++;}
      else if(r==='Failed'){fail++;if(typeMap[t.testType])typeMap[t.testType].f++;}
      else{pend++;}
    });
  });

  const pct=tot?Math.round(pass/tot*100):0;
  const col=pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
  const bar=pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
  const pe=document.querySelector('#overall-card .overall-big span:first-child');
  if(pe){pe.textContent=pct+'%';pe.style.color=col;}
  const be=document.getElementById('overall-bar');
  if(be){be.style.width=pct+'%';be.style.background=bar;}
  const ne=document.getElementById('overall-note');
  if(ne) ne.textContent=pct===100?'All '+tot+' tests passed!':(100-pct)+'% gap - '+fail+' failed'+(pend?' - '+pend+' pending':'');

  const sm=(id,v,c)=>{const e=document.querySelector('#'+id+' .ms-val');if(e){e.textContent=v;if(c)e.style.color=c;}};
  sm('mini-total',tot);sm('mini-pass',pass,'#3B6D11');sm('mini-fail',fail,'#A32D2D');sm('mini-pend',pend,'#854F0B');
  sm('tl-ontime',ont,'#3B6D11');sm('tl-late',lat,'#A32D2D');sm('tl-pend',tlp,'#854F0B');

  const tk=document.getElementById('type-kpi');
  if(tk) tk.innerHTML=Object.entries(typeMap).map(([t,v])=>
    '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:0.5px solid var(--border)">'+
    '<span>'+t+'</span><span style="color:'+(v.f?'#A32D2D':v.p?'#3B6D11':'#999')+';font-weight:600">'+v.p+' Passed / '+v.f+' Failed</span></div>'
  ).join('');
}

/* === GAUGES === */
function renderGauges(md){
  const grid=document.getElementById('gauge-grid'); if(!grid) return;
  grid.innerHTML='';
  ['Marshall Test','Extraction Test','Air Voids/VMA/VFB','Coring'].forEach(function(type,i){
    let tot=0,pass=0;
    md.forEach(lay=>Object.values(lay.tests||{}).forEach(t=>{
      if(t.testType===type){tot++;if(evalResult(t)==='Passed')pass++;}
    }));
    const pct=tot?Math.round(pass/tot*100):null;
    const col=pct===null?'#999':pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
    const fill=pct===null?'#ddd':pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
    const cls=pct===null?'':pct===100?'hit':pct>=80?'warn':'critical';
    const pill=pct===null?'p-pend':pct===100?'p-pass':pct>=80?'p-pend':'p-rej';
    const lbl=pct===null?'no data':pct===100?'on target':'needs attention';
    const card=document.createElement('div'); card.className='gauge-card '+cls;
    card.innerHTML='<div class="gauge-mat">'+type+'</div>'+
      '<div class="gauge-wrap"><canvas id="gc-'+i+'" width="90" height="50"></canvas></div>'+
      '<div class="gauge-pct" style="color:'+col+'">'+(pct!==null?pct+'%':'--')+'</div>'+
      '<div class="gauge-det">'+pass+'/'+tot+' passed</div>'+
      '<span class="gauge-pill badge '+pill+'">'+lbl+'</span>';
    grid.appendChild(card);
    setTimeout(function(){
      const ctx=document.getElementById('gc-'+i); if(!ctx) return;
      if(gaugeCharts[i]) try{gaugeCharts[i].destroy();}catch(e){}
      gaugeCharts[i]=new Chart(ctx,{type:'doughnut',
        data:{datasets:[{data:[pct||0,100-(pct||0)],backgroundColor:[fill,'rgba(128,128,128,0.1)'],borderWidth:0,circumference:180,rotation:270}]},
        options:{responsive:false,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:500}}
      });
    },100+i*30);
  });
}

/* === TREND === */
function renderCharts(){
  const md=monthLayings(); renderGauges(md);
  const ms=selMonth(); if(!ms||ms==='all') return;
  if(trendChart){try{trendChart.destroy();}catch(e){}trendChart=null;}
  const [y,mo]=ms.split('-');
  const days=Array.from({length:new Date(+y,+mo,0).getDate()},(_,i)=>ms+'-'+String(i+1).padStart(2,'0'));
  const rates=days.map(d=>{
    let tot=0,pass=0;
    md.forEach(lay=>{ if((lay.dateLaid||'').startsWith(d)) Object.values(lay.tests||{}).forEach(t=>{tot++;if(evalResult(t)==='Passed')pass++;}); });
    return tot?Math.round(pass/tot*100):null;
  });
  const ctx=document.getElementById('chartTrend'); if(!ctx) return;
  trendChart=new Chart(ctx,{type:'line',
    data:{labels:days.map(d=>d.slice(8)),datasets:[
      {data:rates,borderColor:'#3B6D11',backgroundColor:'rgba(59,109,17,0.07)',tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#639922',borderWidth:2,spanGaps:true},
      {data:days.map(()=>100),borderColor:'#378ADD',borderDash:[5,4],pointRadius:0,fill:false,borderWidth:1.5}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{grid:{display:false},ticks:{font:{size:9},autoSkip:true,maxTicksLimit:15}},
        y:{min:0,max:105,ticks:{font:{size:9},callback:v=>v+'%'},grid:{color:'rgba(128,128,128,0.07)'}}}}
  });
}

/* === SHEET 1 === */
function renderSheet1(){
  const md=monthLayings();
  const search=(gv('s1-search')||'').toLowerCase();
  let rows=[...md].sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));
  if(search) rows=rows.filter(r=>[r.projId,r.client,r.location,r.materials].join(' ').toLowerCase().includes(search));
  const tb=document.getElementById('s1-body'); if(!tb) return;
  tb.innerHTML=!rows.length?'<tr class="empty-row"><td colspan="9">No layings. Click "+ Log Laying" to start.</td></tr>'
    :rows.map(lay=>{
      const idx=layings.findIndex(x=>x._id===lay._id);
      const scope=(lay.scope||[]).join(', ')||'--';
      return '<tr>'+
        '<td>'+( lay.dateLaid||'--')+'</td>'+
        '<td>'+( lay.projId||'--')+'</td>'+
        '<td>'+( lay.client||'--')+'</td>'+
        '<td>'+( lay.location||'--')+'</td>'+
        '<td>'+( lay.materials||'--')+'</td>'+
        '<td>'+scope+'</td>'+
        '<td>'+( lay.volume||'--')+'</td>'+
        '<td>'+( lay.remarks||'--')+'</td>'+
        '<td style="white-space:nowrap">'+
          '<button class="act-btn" onclick="openTestModal('+idx+')" title="Log Test" style="color:#378ADD">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><circle cx="18" cy="6" r="3"/></svg></button>'+
          '<button class="act-btn" onclick="openEditLaying('+idx+')" title="Edit">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'+
        '</td></tr>';
    }).join('');
  const f=document.getElementById('s1-footer'); if(f) f.textContent='Showing '+rows.length+' of '+md.length+' layings';
}

/* === SHEET 2 === */
function renderSheet2(){
  const md=monthLayings();
  const fStat=gv('s2-filter');
  let rows=[...md].sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));
  const TYPES=['Marshall Test','Extraction Test','Air Voids/VMA/VFB','Coring'];
  const TYPE_KEYS={'Marshall Test':'Marshall_Test','Extraction Test':'Extraction_Test','Air Voids/VMA/VFB':'Air_Voids_VMA_VFB','Coring':'Coring'};

  const tRows=rows.map(lay=>{
    const tests=lay.tests||{};
    const dueDate=lay.dateLaid?addDays(lay.dateLaid,SPECS.daysOnTime):'--';

    // first tested date for overall timeliness
    const testList=Object.values(tests);
    const first=testList.length?testList.sort((a,b)=>(a.dateTested||'').localeCompare(b.dateTested||''))[0]:null;
    const overallTl=first?tlStatus(lay.dateLaid,first.dateTested):'Pending';
    if(fStat&&overallTl!==fStat) return null;

    const tlCell=type=>{
      const t=Object.values(tests).find(x=>x.testType===type);
      if(!t) return '<td style="text-align:center;color:var(--text-2)">--</td>';
      const tl=tlStatus(lay.dateLaid,t.dateTested);
      const col=tl==='On Time'?'#3B6D11':tl==='Late'?'#A32D2D':'#854F0B';
      const bg=tl==='On Time'?'#EAF3DE':tl==='Late'?'#FCEBEB':'#FAEEDA';
      return '<td style="text-align:center"><div style="font-size:10px">'+(t.dateTested||'--')+'</div>'+
        '<span style="font-size:9px;padding:1px 6px;border-radius:6px;background:'+bg+';color:'+col+';font-weight:600">'+tl+'</span></td>';
    };

    const otlCol=overallTl==='On Time'?'#3B6D11':overallTl==='Late'?'#A32D2D':'#854F0B';
    const otlBg=overallTl==='On Time'?'#EAF3DE':overallTl==='Late'?'#FCEBEB':'#FAEEDA';

    return '<tr>'+
      '<td>'+(lay.dateLaid||'--')+'</td>'+
      '<td>'+(lay.projId||'--')+'</td>'+
      '<td>'+(lay.client||'--')+'</td>'+
      '<td>'+(lay.location||'--')+'</td>'+
      '<td>'+(lay.materials||'--')+'</td>'+
      '<td>'+dueDate+'</td>'+
      TYPES.map(tlCell).join('')+
      '<td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:6px;background:'+otlBg+';color:'+otlCol+';font-weight:600">'+overallTl+'</span></td>'+
      '</tr>';
  }).filter(Boolean);

  const tb=document.getElementById('s2-body'); if(!tb) return;
  tb.innerHTML=!tRows.length?'<tr class="empty-row"><td colspan="11">No data found.</td></tr>':tRows.join('');
  const f=document.getElementById('s2-footer'); if(f) f.textContent='Showing '+tRows.length+' records';
}

/* === SHEET 3 === */
function renderSheet3(){
  const md=monthLayings();
  const fType=gv('s3-filter-type'), fRes=gv('s3-filter-result');
  const tb=document.getElementById('s3-body'); if(!tb) return;

  const testRows=[];
  md.forEach(lay=>{
    Object.values(lay.tests||{}).forEach(t=>{
      if(fType&&t.testType!==fType) return;
      const result=evalResult(t);
      if(fRes&&result!==fRes) return;
      const rc=result==='Passed'?'#3B6D11':result==='Failed'?'#A32D2D':'#854F0B';
      const rb=result==='Passed'?'#EAF3DE':result==='Failed'?'#FCEBEB':'#FAEEDA';
      const idx=layings.findIndex(x=>x._id===lay._id);

      const valCell=(v,min,max)=>{
        if(v===''||v===undefined||v===null) return '<td class="result-cell" style="color:var(--text-2)">--</td>';
        const ok=inRange(v,min,max);
        return '<td class="result-cell"><span class="val" style="color:'+(ok?'#3B6D11':'#A32D2D')+'">'+parseFloat(v).toFixed(2)+'</span>'+
          '<div class="req">'+min+'-'+max+'</div></td>';
      };

      // Build display values
      const stab=t.stabAvg!==undefined?t.stabAvg:'', flow=t.flowAvg!==undefined?t.flowAvg:'';
      const av=t.avAvg!==undefined?t.avAvg:(t.airVoids||'');
      const vma=t.vmaAvg!==undefined?t.vmaAvg:(t.vma||'');
      const vfb=t.vfbAvg!==undefined?t.vfbAvg:(t.vfb||'');
      const bit=t.bitumen||'';
      const coreInfo=t.coreCount?(t.coreCount+' cores'+(t.coreAvg?' / '+parseFloat(t.coreAvg).toFixed(1)+' mm':'')):'';

      testRows.push('<tr>'+
        '<td>'+(lay.dateLaid||'--')+'</td>'+
        '<td>'+(t.dateTested||'--')+'</td>'+
        '<td>'+(lay.projId||'--')+'</td>'+
        '<td>'+(lay.client||'--')+'</td>'+
        '<td>'+(lay.materials||'--')+'</td>'+
        '<td>'+(t.testType||'--')+'</td>'+
        '<td>'+(t.labNo||'--')+'</td>'+
        (t.testType==='Extraction Test'
          ? '<td class="result-cell"><span class="val">'+( bit?parseFloat(bit).toFixed(2):'--')+'%</span>'+(t.bitTarget?'<div class="req">Target: '+t.bitTarget+'%</div>':'')+'</td>'
          : '<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Marshall Test'?valCell(stab,SPECS.stability.min,SPECS.stability.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Marshall Test'?valCell(flow,SPECS.flow.min,SPECS.flow.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        valCell(av,SPECS.airVoids.min,SPECS.airVoids.max)+
        valCell(vma,SPECS.vma.min,SPECS.vma.max)+
        valCell(vfb,SPECS.vfb.min,SPECS.vfb.max)+
        '<td class="result-cell">'+(coreInfo||'--')+'</td>'+
        '<td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:6px;background:'+rb+';color:'+rc+';font-weight:600">'+result+'</span></td>'+
        '<td>'+(t.remarks||'--')+'</td>'+
        '<td><button class="act-btn" onclick="delTest('+idx+',\''+t._key+'\')" title="Delete">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A32D2D" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button></td>'+
        '</tr>');
    });
  });

  tb.innerHTML=!testRows.length?'<tr class="empty-row"><td colspan="17">No test results found.</td></tr>':testRows.join('');
  const f=document.getElementById('s3-footer'); if(f) f.textContent='Showing '+testRows.length+' test results';
}

/* === LAYING MODAL === */
function openLayingForm(){
  try{
    editLayIdx=null; modalIsOpen=true;
    const ti=document.getElementById('laying-title'); if(ti) ti.textContent='Log New Laying';
    const db=document.getElementById('laying-del-btn'); if(db) db.style.display='none';
    sv('laying-save-btn','Save');
    sv('l-date',localDate(new Date()));
    ['l-projid','l-client','l-location','l-volume','l-remarks','l-materials-other'].forEach(id=>sv(id,''));
    sv('l-materials','');
    const mow=document.getElementById('mat-other-wrap'); if(mow) mow.style.display='none';
    ['sc-furnish','sc-delivery','sc-laying','sc-rolling','sc-correction','sc-patching'].forEach(id=>{
      const e=document.getElementById(id); if(e) e.checked=false;
    });
    const modal=document.getElementById('laying-modal'); if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function openEditLaying(idx){
  try{
    editLayIdx=idx; modalIsOpen=true;
    const lay=layings[idx]; if(!lay) return;
    const ti=document.getElementById('laying-title'); if(ti) ti.textContent='Edit Laying';
    const db=document.getElementById('laying-del-btn'); if(db) db.style.display='inline-flex';
    sv('l-date',lay.dateLaid);
    sv('l-projid',lay.projId);
    sv('l-client',lay.client);
    sv('l-location',lay.location);
    sv('l-volume',lay.volume);
    sv('l-remarks',lay.remarks);
    const knownMat=['Grading 310-B','Grading 310-C','Grading 310-D','Grading 310-E','SMA - A','SMA - B','ATB - Asphalt Treated Basecoarse'];
    const matOther=lay.materials&&!knownMat.includes(lay.materials);
    sv('l-materials',matOther?'__other__':lay.materials||'');
    sv('l-materials-other',matOther?lay.materials:'');
    const mow=document.getElementById('mat-other-wrap'); if(mow) mow.style.display=matOther?'':'none';
    const scope=lay.scope||[];
    ['furnish','delivery','laying','rolling','correction','patching'].forEach(s=>{
      const e=document.getElementById('sc-'+s); if(e) e.checked=scope.includes(s);
    });
    const modal=document.getElementById('laying-modal'); if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function closeLayingModal(){
  modalIsOpen=false;
  const modal=document.getElementById('laying-modal'); if(modal) modal.classList.remove('open');
  editLayIdx=null;
}

function toggleMaterialOther(){
  const wrap=document.getElementById('mat-other-wrap');
  if(wrap) wrap.style.display=gv('l-materials')==='__other__'?'':'none';
}

function saveLaying(){
  const date=gv('l-date'), projId=gv('l-projid').trim(), client=gv('l-client').trim();
  if(!date||!projId||!client){ toast('Please fill in Date, Project ID and Client.','#E24B4A'); return; }
  const mat=gv('l-materials')==='__other__'?gv('l-materials-other').trim():gv('l-materials');
  const scope=['furnish','delivery','laying','rolling','correction','patching'].filter(s=>{ const e=document.getElementById('sc-'+s); return e&&e.checked; });
  const existing=editLayIdx!==null&&layings[editLayIdx]?(layings[editLayIdx].tests||{}):{};
  const entry={ dateLaid:date, projId, client, location:gv('l-location').trim(), materials:mat, scope, volume:gv('l-volume').trim(), remarks:gv('l-remarks').trim(), tests:existing };
  const btn=document.getElementById('laying-save-btn'); if(btn){btn.textContent='Saving...';btn.disabled=true;}
  const doSave=()=>{
    if(!isOnline||!db){ const o={...entry,_id:'off_'+Date.now(),_pending:true}; layings.unshift(o); saveLocal(); pendingSync.push(entry); return Promise.resolve(); }
    if(editLayIdx!==null&&layings[editLayIdx]&&layings[editLayIdx]._id) return window.db.ref('layings/'+layings[editLayIdx]._id).set(entry);
    return window.db.ref('layings').push(entry);
  };
  doSave().then(()=>{ closeLayingModal(); buildMonthSel(); const sel=document.getElementById('sel-month'); if(sel&&sel.value!=='all') sel.value=date.slice(0,7); render(); if(activeTab==='kpi') setTimeout(renderCharts,80); toast(editLayIdx!==null?'Laying updated!':'Laying logged: '+client,'#639922'); })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{ if(btn){btn.textContent=editLayIdx!==null?'Save Changes':'Save';btn.disabled=false;} });
}

function deleteLaying(){
  if(editLayIdx===null) return;
  if(!confirm('Delete this laying and all test results?')) return;
  const id=layings[editLayIdx]._id;
  if(!isOnline||!db){toast('Cannot delete offline','#E24B4A');return;}
  db.ref('layings/'+id).remove().then(()=>{closeLayingModal();toast('Deleted.','#E24B4A');}).catch(err=>toast(err.message,'#E24B4A'));
}

/* === TEST MODAL === */
function openTestModal(idx){
  try{
    testLayIdx=idx; modalIsOpen=true;
    const lay=layings[idx]; if(!lay) return;
    const info=document.getElementById('test-info');
    if(info) info.innerHTML='<strong>'+lay.projId+'</strong> | '+lay.client+' | '+(lay.location||'')+'<br>Date Laid: <strong>'+lay.dateLaid+'</strong> | Materials: '+(lay.materials||'--');
    sv('t-type',''); sv('t-date',localDate(new Date())); sv('t-labno',''); sv('t-timeliness',''); sv('t-result',''); sv('t-remarks','');
    // Clear all test fields
    ['m-ac1','m-ac2','m-ac3','m-acavg','m-av1','m-av2','m-av3','m-avavg',
     'm-vma1','m-vma2','m-vma3','m-vmaavg','m-vfb1','m-vfb2','m-vfb3','m-vfbavg',
     'm-stab1','m-stab2','m-stab3','m-stabavg','m-flow1','m-flow2','m-flow3','m-flowavg',
     'e-bitumen','e-target','a-av','a-vma','a-vfb','c-count','c-avg'].forEach(id=>sv(id,''));
    document.getElementById('core-inputs').innerHTML='';
    toggleTestFields(); computeTimeliness();
    const modal=document.getElementById('test-modal'); if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function closeTestModal(){
  modalIsOpen=false;
  const modal=document.getElementById('test-modal'); if(modal) modal.classList.remove('open');
  testLayIdx=null;
}

function toggleTestFields(){
  const type=gv('t-type');
  document.getElementById('f-marshall').style.display    = type==='Marshall Test'?'':'none';
  document.getElementById('f-extraction').style.display  = type==='Extraction Test'?'':'none';
  document.getElementById('f-airvoids').style.display    = type==='Air Voids/VMA/VFB'?'':'none';
  document.getElementById('f-coring').style.display      = type==='Coring'?'':'none';
  // Update req labels
  const avReq=document.getElementById('av-req'); if(avReq) avReq.textContent='('+SPECS.airVoids.min+'-'+SPECS.airVoids.max+'%)';
  const vmaReq=document.getElementById('vma-req'); if(vmaReq) vmaReq.textContent='('+SPECS.vma.min+'-'+SPECS.vma.max+'%)';
  const vfbReq=document.getElementById('vfb-req'); if(vfbReq) vfbReq.textContent='('+SPECS.vfb.min+'-'+SPECS.vfb.max+'%)';
  const cReq=document.getElementById('core-req'); if(cReq) cReq.textContent='('+SPECS.coreMin+'-'+SPECS.coreMax+' cores)';
  computeResult();
}

function computeTimeliness(){
  const lay=testLayIdx!==null?layings[testLayIdx]:null; if(!lay) return;
  const tl=tlStatus(lay.dateLaid,gv('t-date'));
  const el=document.getElementById('t-timeliness');
  if(el){ el.value=tl; el.style.color=tl==='On Time'?'#3B6D11':tl==='Late'?'#A32D2D':'#854F0B'; }
}

function computeMarshall(){
  [['m-ac1','m-ac2','m-ac3','m-acavg'],
   ['m-av1','m-av2','m-av3','m-avavg'],
   ['m-vma1','m-vma2','m-vma3','m-vmaavg'],
   ['m-vfb1','m-vfb2','m-vfb3','m-vfbavg'],
   ['m-stab1','m-stab2','m-stab3','m-stabavg'],
   ['m-flow1','m-flow2','m-flow3','m-flowavg']].forEach(([t1,t2,t3,ta])=>{
    const a=avg([gv(t1),gv(t2),gv(t3)]);
    sv(ta, a!==null?a.toFixed(2):'');
  });
  computeResult();
}

function computeResult(){
  const type=gv('t-type');
  const t={
    testType:type,
    stabAvg:gv('m-stabavg'), flowAvg:gv('m-flowavg'),
    avAvg:gv('m-avavg'), vmaAvg:gv('m-vmaavg'), vfbAvg:gv('m-vfbavg'),
    bitumen:gv('e-bitumen'), bitTarget:gv('e-target'),
    airVoids:gv('a-av'), vma:gv('a-vma'), vfb:gv('a-vfb'),
    coreCount:gv('c-count')
  };
  const result=evalResult(t);
  const el=document.getElementById('t-result');
  if(el){ el.value=result; el.style.color=result==='Passed'?'#3B6D11':result==='Failed'?'#A32D2D':'#854F0B'; }
}

function buildCoreInputs(){
  const count=parseInt(gv('c-count'))||0;
  const container=document.getElementById('core-inputs'); if(!container) return;
  if(!count){container.innerHTML='';return;}
  let html='<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">Core Thickness Readings (mm)</div>';
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">';
  for(let i=1;i<=Math.min(count,30);i++){
    html+='<div class="form-group"><label>Core '+i+'</label><input type="number" id="core-'+i+'" placeholder="mm" step="0.1" oninput="computeCoreAvg()"></div>';
  }
  html+='</div>';
  container.innerHTML=html;
  computeResult();
}

function computeCoreAvg(){
  const count=parseInt(gv('c-count'))||0;
  const vals=[];
  for(let i=1;i<=count;i++){ const e=document.getElementById('core-'+i); if(e&&e.value) vals.push(parseFloat(e.value)); }
  const a=vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:0;
  sv('c-avg',a?a.toFixed(1):'');
  computeResult();
}

function saveTestResult(){
  const type=gv('t-type'), date=gv('t-date');
  if(!type||!date){toast('Please select Test Type and Date Tested.','#E24B4A');return;}

  const count=parseInt(gv('c-count'))||0;
  const coreReadings=[];
  for(let i=1;i<=count;i++){const e=document.getElementById('core-'+i);if(e&&e.value) coreReadings.push(parseFloat(e.value));}

  const testEntry={
    testType:type, dateTested:date, labNo:gv('t-labno').trim(), timeliness:gv('t-timeliness'),
    // Marshall trials
    ac1:gv('m-ac1'),ac2:gv('m-ac2'),ac3:gv('m-ac3'),acAvg:gv('m-acavg'),
    av1:gv('m-av1'),av2:gv('m-av2'),av3:gv('m-av3'),avAvg:gv('m-avavg'),
    vma1:gv('m-vma1'),vma2:gv('m-vma2'),vma3:gv('m-vma3'),vmaAvg:gv('m-vmaavg'),
    vfb1:gv('m-vfb1'),vfb2:gv('m-vfb2'),vfb3:gv('m-vfb3'),vfbAvg:gv('m-vfbavg'),
    stab1:gv('m-stab1'),stab2:gv('m-stab2'),stab3:gv('m-stab3'),stabAvg:gv('m-stabavg'),
    flow1:gv('m-flow1'),flow2:gv('m-flow2'),flow3:gv('m-flow3'),flowAvg:gv('m-flowavg'),
    // Extraction
    bitumen:gv('e-bitumen'), bitTarget:gv('e-target'),
    // Air Voids standalone
    airVoids:gv('a-av'), vma:gv('a-vma'), vfb:gv('a-vfb'),
    // Coring
    coreCount:count, coreReadings, coreAvg:gv('c-avg'),
    remarks:gv('t-remarks').trim(),
    _key:type.replace(/[^a-zA-Z]/g,'_'),
  };
  testEntry.result=evalResult(testEntry);

  const btn=document.getElementById('test-save-btn'); if(btn){btn.textContent='Saving...';btn.disabled=true;}
  const lay=layings[testLayIdx];
  const testKey=type.replace(/[^a-zA-Z]/g,'_');

  db.ref('layings/'+lay._id+'/tests/'+testKey).set(testEntry)
    .then(()=>{
      if(!layings[testLayIdx].tests) layings[testLayIdx].tests={};
      layings[testLayIdx].tests[testKey]=testEntry;
      saveLocal(); closeTestModal(); render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast('Test saved! '+testEntry.result,'#639922');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{if(btn){btn.textContent='Save Result';btn.disabled=false;}});
}

function delTest(layIdx,testKey){
  if(!confirm('Delete this test result?')) return;
  const lay=layings[layIdx]; if(!lay||!lay._id) return;
  db.ref('layings/'+lay._id+'/tests/'+testKey).remove()
    .then(()=>toast('Test deleted.','#E24B4A')).catch(err=>toast(err.message,'#E24B4A'));
}

/* === AUTOCOMPLETE === */
function updateAC(){
  const fields={'ac-projid':[...new Set(layings.map(d=>d.projId).filter(Boolean))],
    'ac-client':[...new Set(layings.map(d=>d.client).filter(Boolean))],
    'ac-location':[...new Set(layings.map(d=>d.location).filter(Boolean))],
    'ac-labno':[...new Set(Object.values(layings.reduce((a,l)=>({...a,...(l.tests||{})}),{})).map(t=>t.labNo).filter(Boolean))]};
  Object.entries(fields).forEach(([id,vals])=>{
    let dl=document.getElementById(id);
    if(!dl){dl=document.createElement('datalist');dl.id=id;document.body.appendChild(dl);}
    dl.innerHTML=vals.map(v=>'<option value="'+v.replace(/"/g,'&quot;')+'">').join('');
  });
}

/* === EXPORT === */
function exportCSV(){
  const md=monthLayings(); if(!md.length){toast('No data.','#E24B4A');return;}
  const hdrs=['Date Laid','Project ID','Client','Location','Materials','Scope','Volume',
    'Test Type','Date Tested','Lab No.','Timeliness',
    '% Bitumen','Stability Avg (kN)','Flow Avg (mm)','Air Voids Avg (%)','VMA Avg (%)','VFB Avg (%)','Core Count','Core Avg (mm)','Result','Remarks'];
  const rows=[];
  md.forEach(lay=>{
    const scope=(lay.scope||[]).join('; ');
    const tests=Object.values(lay.tests||{});
    if(!tests.length){
      rows.push([lay.dateLaid,lay.projId,lay.client,lay.location,lay.materials,scope,lay.volume,'','','','','','','','','','','','','Pending',''].map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
    } else {
      tests.forEach(t=>{
        rows.push([lay.dateLaid,lay.projId,lay.client,lay.location,lay.materials,scope,lay.volume,
          t.testType,t.dateTested,t.labNo,t.timeliness,
          t.bitumen,t.stabAvg,t.flowAvg,t.avAvg||t.airVoids,t.vmaAvg||t.vma,t.vfbAvg||t.vfb,t.coreCount,t.coreAvg,t.result,t.remarks]
          .map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
      });
    }
  });
  const csv=[hdrs.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='BigBen_AsphaltQC_'+(selMonth()||'export').replace('-','_')+'.csv';
  a.click(); toast('CSV exported.','#378ADD');
}

/* === TOAST === */
function toast(msg,color){
  const el=document.getElementById('toast'),dot=document.getElementById('toast-dot'),me=document.getElementById('toast-msg');
  if(!el) return;
  if(dot) dot.style.background=color||'#639922';
  if(me) me.textContent=msg;
  el.classList.add('show'); clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),4000);
}

/* === INIT === */
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){closeLayingModal();closeTestModal();} });
document.addEventListener('DOMContentLoaded',function(){
  const sel=document.getElementById('sel-month');
  if(sel) sel.addEventListener('change',()=>{render();if(activeTab==='kpi')setTimeout(renderCharts,80);});
  const lm=document.getElementById('l-materials');
  if(lm) lm.addEventListener('change',toggleMaterialOther);
  loadLocal(); loadSpecsForm(); buildMonthSel(); render(); initFirebase(); updateOnline();
  setTimeout(renderCharts,200);
  // expose db globally for saveLaying
  Object.defineProperty(window,'db',{get:()=>db});
});

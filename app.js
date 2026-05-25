/* ================================================================
   Big Ben RMC -- Asphalt QC Monitoring Dashboard
   app.js | Firebase | DPWH Standards
   ================================================================ */

const firebaseConfig = {
  apiKey:            "AIzaSyAnw-jxJHoVKz_NXX2HWFTiWsQ5aP_oB9Q",
  authDomain:        "bigben-asphalt-qc.firebaseapp.com",
  databaseURL:       "https://bigben-asphalt-qc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "bigben-asphalt-qc",
  storageBucket:     "bigben-asphalt-qc.firebasestorage.app",
  messagingSenderId: "1069991782524",
  appId:             "1:1069991782524:web:ddd9402b422233aed2c1f9"
};

/* ================================================================
   DEFAULT SPECS (DPWH Standard)
   ================================================================ */
let SPECS = {
  stability: { min: 3.3, max: 8.0 },
  flow:      { min: 2.0, max: 3.5 },
  airVoids:  { min: 3.0, max: 5.0 },
  vma:       { min: 13.0, max: 16.0 },
  vfa:       { min: 65.0, max: 75.0 },
  coreMin:   3,
  coreMax:   30,
  daysOnTime: 3
};

/* ================================================================
   STATE
   ================================================================ */
let layings    = [];
let editLayIdx = null;
let testLayIdx = null;
let gaugeCharts = {};
let trendChart  = null;
let activeTab   = 'kpi';
let db          = null;
let isOnline    = navigator.onLine;
let pendingSync = [];
let modalIsOpen = false;

const LS_LAYINGS = 'asphalt_qc_layings_v1';
const LS_SPECS   = 'asphalt_qc_specs_v1';

/* ================================================================
   HELPERS
   ================================================================ */
function getVal(id){ const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v||''; }
function inRange(v, min, max){ const n=parseFloat(v); return !isNaN(n) && n>=min && n<=max; }
function fmtDate(d){ return d||'--'; }

function localDateStr(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function addDays(dateStr, days){
  const parts = dateStr.split('-');
  const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
  d.setDate(d.getDate()+days);
  return localDateStr(d);
}

function daysBetween(d1, d2){
  const a = new Date(d1+'T00:00:00'), b = new Date(d2+'T00:00:00');
  return Math.round((b-a)/(1000*60*60*24));
}

function computeTimelinessStatus(dateLaid, dateTested){
  if (!dateLaid || !dateTested) return 'Pending';
  const diff = daysBetween(dateLaid, dateTested);
  return diff <= SPECS.daysOnTime ? 'On Time' : 'Late';
}

/* ================================================================
   ONLINE / OFFLINE
   ================================================================ */
function updateOnlineStatus(){
  isOnline = navigator.onLine;
  const el = document.getElementById('online-indicator');
  if(el){
    el.textContent = isOnline?'Online':'Offline';
    el.style.background = isOnline?'#EAF3DE':'#FAEEDA';
    el.style.color      = isOnline?'#3B6D11':'#854F0B';
    el.style.border     = isOnline?'0.5px solid #639922':'0.5px solid #EF9F27';
  }
  if(isOnline) syncPending();
}
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ================================================================
   LOCAL STORAGE
   ================================================================ */
function saveLocal(){
  try{ localStorage.setItem(LS_LAYINGS, JSON.stringify(layings)); }catch(e){}
}
function loadLocal(){
  try{
    const l = localStorage.getItem(LS_LAYINGS); if(l) layings = JSON.parse(l);
    const s = localStorage.getItem(LS_SPECS);   if(s) SPECS   = {...SPECS, ...JSON.parse(s)};
  }catch(e){}
}

/* ================================================================
   FIREBASE
   ================================================================ */
function initFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    db.ref('layings').on('value', snap => {
      const val = snap.val();
      layings = val ? Object.entries(val).map(([id,d])=>({...d,_id:id})) : [];
      layings.sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));
      saveLocal();
      updateAutocomplete();
      if(modalIsOpen) return;
      buildMonthSelect();
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
    }, err=>{ toast('Using offline data','#854F0B'); });

    // Load specs from Firebase too
    db.ref('specs').once('value', snap=>{
      const val = snap.val();
      if(val){ SPECS = {...SPECS, ...val}; loadSpecsToForm(); }
    });
  }catch(e){ toast('Offline mode','#854F0B'); }
}

function syncPending(){
  if(!db||!pendingSync.length) return;
  const toSync=[...pendingSync]; pendingSync=[];
  toSync.forEach(entry=>{
    db.ref('layings').push(entry)
      .catch(()=>{ pendingSync.push(entry); });
  });
}

/* ================================================================
   MONTH SELECT
   ================================================================ */
function buildMonthSelect(){
  const sel = document.getElementById('sel-month');
  if(!sel) return;
  const cur = sel.value;
  const months = new Set(layings.map(d=>(d.dateLaid||'').slice(0,7)).filter(Boolean));
  const now = new Date();
  const thisMonth = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  months.add(thisMonth);
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value='all'; allOpt.textContent='All Months';
  if(cur==='all') allOpt.selected=true;
  sel.appendChild(allOpt);
  [...months].sort().reverse().forEach(m=>{
    const [y,mo]=m.split('-');
    const lbl=new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'});
    const o=document.createElement('option');
    o.value=m; o.textContent=lbl;
    if(m===(cur||thisMonth)) o.selected=true;
    sel.appendChild(o);
  });
}

function selMonth(){ const s=document.getElementById('sel-month'); return s?s.value:''; }
function monthLayings(){
  const m=selMonth();
  if(m==='all') return [...layings];
  return layings.filter(d=>(d.dateLaid||'').startsWith(m));
}

/* ================================================================
   SPECS
   ================================================================ */
function loadSpecsToForm(){
  setVal('sp-stability-min', SPECS.stability.min);
  setVal('sp-stability-max', SPECS.stability.max);
  setVal('sp-flow-min',      SPECS.flow.min);
  setVal('sp-flow-max',      SPECS.flow.max);
  setVal('sp-av-min',        SPECS.airVoids.min);
  setVal('sp-av-max',        SPECS.airVoids.max);
  setVal('sp-vma-min',       SPECS.vma.min);
  setVal('sp-vma-max',       SPECS.vma.max);
  setVal('sp-vfa-min',       SPECS.vfa.min);
  setVal('sp-vfa-max',       SPECS.vfa.max);
  setVal('sp-core-min',      SPECS.coreMin);
  setVal('sp-core-max',      SPECS.coreMax);
  setVal('sp-days-ontime',   SPECS.daysOnTime);
}

function saveSpecs(){
  SPECS = {
    stability: { min: parseFloat(getVal('sp-stability-min'))||3.3, max: parseFloat(getVal('sp-stability-max'))||8.0 },
    flow:      { min: parseFloat(getVal('sp-flow-min'))||2.0,      max: parseFloat(getVal('sp-flow-max'))||3.5 },
    airVoids:  { min: parseFloat(getVal('sp-av-min'))||3.0,        max: parseFloat(getVal('sp-av-max'))||5.0 },
    vma:       { min: parseFloat(getVal('sp-vma-min'))||13.0,      max: parseFloat(getVal('sp-vma-max'))||16.0 },
    vfa:       { min: parseFloat(getVal('sp-vfa-min'))||65.0,      max: parseFloat(getVal('sp-vfa-max'))||75.0 },
    coreMin:   parseInt(getVal('sp-core-min'))||3,
    coreMax:   parseInt(getVal('sp-core-max'))||30,
    daysOnTime:parseInt(getVal('sp-days-ontime'))||3,
  };
  try{ localStorage.setItem(LS_SPECS, JSON.stringify(SPECS)); }catch(e){}
  if(db) db.ref('specs').set(SPECS);
  toast('Specs saved!','#639922');
}

/* ================================================================
   PASS/FAIL LOGIC
   ================================================================ */
function evalTestResult(test){
  const type = test.testType;
  if(type==='Marshall Test'){
    const sOk = test.stability!=='' && test.stability!==undefined
      ? inRange(test.stability, SPECS.stability.min, SPECS.stability.max) : null;
    const fOk = test.flow!=='' && test.flow!==undefined
      ? inRange(test.flow, SPECS.flow.min, SPECS.flow.max) : null;
    if(sOk===null&&fOk===null) return 'Pending';
    return (sOk!==false && fOk!==false) ? 'Passed' : 'Failed';
  }
  if(type==='Air Voids/VMA/VFA'){
    const avOk  = test.airVoids!==''&&test.airVoids!==undefined ? inRange(test.airVoids, SPECS.airVoids.min, SPECS.airVoids.max) : null;
    const vmaOk = test.vma!==''&&test.vma!==undefined ? inRange(test.vma, SPECS.vma.min, SPECS.vma.max) : null;
    const vfaOk = test.vfa!==''&&test.vfa!==undefined ? inRange(test.vfa, SPECS.vfa.min, SPECS.vfa.max) : null;
    if(avOk===null&&vmaOk===null&&vfaOk===null) return 'Pending';
    return (avOk!==false && vmaOk!==false && vfaOk!==false) ? 'Passed' : 'Failed';
  }
  if(type==='Coring'){
    const count = parseInt(test.coreCount)||0;
    if(!count) return 'Pending';
    return (count>=SPECS.coreMin && count<=SPECS.coreMax) ? 'Passed' : 'Failed';
  }
  if(type==='Extraction Test'){
    if(test.bitumen===''||test.bitumen===undefined) return 'Pending';
    const target = parseFloat(test.bitumenTarget)||0;
    const val    = parseFloat(test.bitumen)||0;
    if(!target) return 'Pending';
    const tol = 0.4;
    return Math.abs(val-target)<=tol ? 'Passed' : 'Failed';
  }
  return 'Pending';
}

function getLayingOverallStatus(laying){
  const tests = Object.values(laying.tests||{});
  if(!tests.length) return 'Pending';
  if(tests.some(t=>evalTestResult(t)==='Failed')) return 'Failed';
  if(tests.every(t=>evalTestResult(t)==='Passed')) return 'Passed';
  return 'Pending';
}

/* ================================================================
   TABS
   ================================================================ */
function setTab(name, btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  const tab=document.getElementById('tab-'+name);
  if(tab) tab.classList.add('active');
  activeTab=name;
  if(name==='kpi') setTimeout(renderCharts,80);
  if(name==='specs') loadSpecsToForm();
}

/* ================================================================
   RENDER
   ================================================================ */
function render(){
  const now=new Date();
  const dateEl=document.getElementById('cur-date');
  if(dateEl) dateEl.textContent=now.toLocaleDateString('en-PH',{weekday:'short',year:'numeric',month:'short',day:'numeric'});

  const m=selMonth();
  let lbl=m==='all'?'All Months':'';
  if(!lbl){ const [y,mo]=(m||'').split('-'); lbl=y&&mo?new Date(+y,+mo-1,1).toLocaleDateString('en-PH',{year:'numeric',month:'long'}):''; }

  ['s1-month-lbl','s2-month-lbl','s3-month-lbl','trend-lbl'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.textContent=lbl;
  });

  const md=monthLayings();
  renderKPI(md);
  renderSheet1();
  renderSheet2();
  renderSheet3();
}

/* -- KPI -- */
function renderKPI(md){
  let tot=0, pass=0, fail=0, pend=0, ontime=0, late=0, tlpend=0;

  md.forEach(lay=>{
    const tests=Object.values(lay.tests||{});
    // Timeliness
    const tld = computeTimelinessStatus(lay.dateLaid, lay.dateFirstTest || '');
    if(!tests.length) tlpend++;
    else if(tld==='On Time') ontime++;
    else if(tld==='Late') late++;
    else tlpend++;

    tests.forEach(t=>{
      tot++;
      const r=evalTestResult(t);
      if(r==='Passed') pass++;
      else if(r==='Failed') fail++;
      else pend++;
    });
    if(!tests.length) pend++;
  });

  const pct=tot?Math.round(pass/tot*100):0;
  const color=pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
  const barColor=pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';

  const pctEl=document.querySelector('#overall-card .overall-big span:first-child');
  if(pctEl){pctEl.textContent=pct+'%';pctEl.style.color=color;}
  const bar=document.getElementById('overall-bar');
  if(bar){bar.style.width=pct+'%';bar.style.background=barColor;}
  const noteEl=document.getElementById('overall-note');
  if(noteEl) noteEl.textContent=pct===100?'All '+tot+' tests passed!':(100-pct)+'% gap - '+fail+' failed'+( pend?' - '+pend+' pending':'');

  const setMini=(id,val,color)=>{const el=document.querySelector('#'+id+' .ms-val');if(el){el.textContent=val;if(color)el.style.color=color;}};
  setMini('mini-total',tot);
  setMini('mini-pass',pass,'#3B6D11');
  setMini('mini-rej',fail,'#A32D2D');
  setMini('mini-pend',pend,'#854F0B');
  setMini('tl-ontime',ontime,'#3B6D11');
  setMini('tl-late',late,'#A32D2D');
  setMini('tl-pend',tlpend,'#854F0B');

  // Per test type
  const types=['Marshall Test','Extraction Test','Air Voids/VMA/VFA','Coring'];
  const typeKpi=document.getElementById('test-type-kpi');
  if(typeKpi){
    typeKpi.innerHTML=types.map(type=>{
      let tp=0,tf=0;
      md.forEach(lay=>Object.values(lay.tests||{}).forEach(t=>{
        if(t.testType===type){ const r=evalTestResult(t); if(r==='Passed')tp++; else if(r==='Failed')tf++; }
      }));
      const color=tf?'#A32D2D':tp?'#3B6D11':'#999';
      return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:0.5px solid var(--border)">'+
        '<span>'+type+'</span>'+
        '<span style="color:'+color+';font-weight:600">'+tp+' Passed / '+tf+' Failed</span>'+
        '</div>';
    }).join('');
  }
}

/* -- Gauges per test type -- */
function renderGauges(md){
  const grid=document.getElementById('gauge-grid');
  if(!grid) return;
  grid.innerHTML='';
  const types=['Marshall Test','Extraction Test','Air Voids/VMA/VFA','Coring'];
  types.forEach(function(type,i){
    let tot=0,pass=0;
    md.forEach(lay=>Object.values(lay.tests||{}).forEach(t=>{
      if(t.testType===type){tot++;if(evalTestResult(t)==='Passed')pass++;}
    }));
    const pct=tot?Math.round(pass/tot*100):null;
    const color=pct===null?'#999':pct===100?'#3B6D11':pct>=80?'#854F0B':'#A32D2D';
    const fillColor=pct===null?'#ddd':pct===100?'#639922':pct>=80?'#EF9F27':'#E24B4A';
    const cls=pct===null?'':pct===100?'hit':pct>=80?'warn':'critical';
    const pillCls=pct===null?'p-pend':pct===100?'p-pass':pct>=80?'p-pend':'p-rej';
    const pillLbl=pct===null?'no data':pct===100?'on target':'needs attention';
    const card=document.createElement('div');
    card.className='gauge-card '+cls;
    card.innerHTML='<div class="gauge-mat">'+type+'</div>'+
      '<div class="gauge-wrap"><canvas id="gc-'+i+'" width="90" height="50"></canvas></div>'+
      '<div class="gauge-pct" style="color:'+color+'">'+(pct!==null?pct+'%':'--')+'</div>'+
      '<div class="gauge-det">'+pass+'/'+tot+' passed</div>'+
      '<span class="gauge-pill badge '+pillCls+'">'+pillLbl+'</span>';
    grid.appendChild(card);
    setTimeout(function(){
      const ctx=document.getElementById('gc-'+i);
      if(!ctx) return;
      if(gaugeCharts[i]) try{gaugeCharts[i].destroy();}catch(e){}
      gaugeCharts[i]=new Chart(ctx,{type:'doughnut',
        data:{datasets:[{data:[pct||0,100-(pct||0)],backgroundColor:[fillColor,'rgba(128,128,128,0.1)'],borderWidth:0,circumference:180,rotation:270}]},
        options:{responsive:false,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:500}}
      });
    },100+i*30);
  });
}

/* -- Trend chart -- */
function renderCharts(){
  const md=monthLayings();
  renderGauges(md);
  const monthStr=selMonth();
  if(!monthStr||monthStr==='all') return;
  if(trendChart){try{trendChart.destroy();}catch(e){}trendChart=null;}
  const [y,mo]=monthStr.split('-');
  const days=Array.from({length:new Date(+y,+mo,0).getDate()},(_,i)=>monthStr+'-'+String(i+1).padStart(2,'0'));
  const rates=days.map(date=>{
    let tot=0,pass=0;
    md.forEach(lay=>{
      if((lay.dateLaid||'').startsWith(date)){
        Object.values(lay.tests||{}).forEach(t=>{tot++;if(evalTestResult(t)==='Passed')pass++;});
      }
    });
    return tot?Math.round(pass/tot*100):null;
  });
  const ctx=document.getElementById('chartTrend');
  if(!ctx) return;
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

/* -- Sheet 1 -- */
function renderSheet1(){
  const md=monthLayings();
  const search=(getVal('s1-search')||'').toLowerCase();
  let rows=[...md].sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));
  if(search) rows=rows.filter(r=>[r.client,r.project,r.location,r.mixType,r.siteCoord].join(' ').toLowerCase().includes(search));
  const tbody=document.getElementById('s1-body');
  if(!tbody) return;
  tbody.innerHTML=!rows.length
    ?'<tr class="empty-row"><td colspan="12">No layings logged. Click "+ Log Laying" to start.</td></tr>'
    :rows.map(lay=>{
      const idx=layings.findIndex(x=>x._id===lay._id);
      const status=getLayingOverallStatus(lay);
      const pc=status==='Passed'?'p-pass':status==='Failed'?'p-rej':'p-pend';
      return '<tr>'+
        '<td>'+fmtDate(lay.dateLaid)+'</td>'+
        '<td title="'+(lay.client||'')+'">'+( lay.client||'--')+'</td>'+
        '<td title="'+(lay.project||'')+'">'+( lay.project||'--')+'</td>'+
        '<td title="'+(lay.location||'')+'">'+( lay.location||'--')+'</td>'+
        '<td>'+(lay.mixType||'--')+'</td>'+
        '<td style="text-align:center">'+(lay.thickness||'--')+'</td>'+
        '<td style="text-align:center">'+(lay.area||'--')+'</td>'+
        '<td style="text-align:center">'+(lay.tonnage||'--')+'</td>'+
        '<td>'+(lay.siteCoord||'--')+'</td>'+
        '<td>'+(lay.testCoord||'--')+'</td>'+
        '<td>'+(lay.remarks||'--')+'</td>'+
        '<td style="white-space:nowrap">'+
          '<button class="act-btn" onclick="openTestModal('+idx+')" title="Log Test" style="color:#378ADD">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><circle cx="18" cy="6" r="3"/></svg></button>'+
          '<button class="act-btn" onclick="openEditLaying('+idx+')" title="Edit">'+
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'+
        '</td></tr>';
    }).join('');
  const footer=document.getElementById('s1-footer');
  if(footer) footer.textContent='Showing '+rows.length+' of '+md.length+' layings';
}

/* -- Sheet 2 -- */
function renderSheet2(){
  const md=monthLayings();
  const fStat=getVal('s2-filter-status');
  let rows=[...md].sort((a,b)=>(b.dateLaid||'').localeCompare(a.dateLaid||''));

  const tbody=document.getElementById('s2-body');
  if(!tbody) return;

  const tlRows=rows.map(lay=>{
    const tests=Object.values(lay.tests||{});
    const dueDate=lay.dateLaid?addDays(lay.dateLaid,SPECS.daysOnTime):'--';
    // Per test type timeliness
    const types=['Marshall Test','Extraction Test','Air Voids/VMA/VFA','Coring'];
    const testCells=types.map(type=>{
      const t=tests.find(x=>x.testType===type);
      if(!t) return '<td style="text-align:center;color:var(--text-2)">--</td>';
      const tl=computeTimelinessStatus(lay.dateLaid, t.dateTested);
      const color=tl==='On Time'?'#3B6D11':tl==='Late'?'#A32D2D':'#854F0B';
      const bg=tl==='On Time'?'#EAF3DE':tl==='Late'?'#FCEBEB':'#FAEEDA';
      return '<td style="text-align:center"><div style="font-size:10px">'+fmtDate(t.dateTested)+'</div>'+
        '<span style="font-size:9px;padding:1px 6px;border-radius:6px;background:'+bg+';color:'+color+';font-weight:600">'+tl+'</span></td>';
    }).join('');

    // Overall timeliness
    const firstTest=tests.length?tests.sort((a,b)=>(a.dateTested||'').localeCompare(b.dateTested||''))[0]:null;
    const overallTl=firstTest?computeTimelinessStatus(lay.dateLaid,firstTest.dateTested):'Pending';
    const otlColor=overallTl==='On Time'?'#3B6D11':overallTl==='Late'?'#A32D2D':'#854F0B';
    const otlBg=overallTl==='On Time'?'#EAF3DE':overallTl==='Late'?'#FCEBEB':'#FAEEDA';

    if(fStat && overallTl!==fStat) return null;
    return '<tr>'+
      '<td>'+fmtDate(lay.dateLaid)+'</td>'+
      '<td>'+(lay.client||'--')+'</td>'+
      '<td>'+(lay.project||'--')+'</td>'+
      '<td>'+(lay.mixType||'--')+'</td>'+
      '<td>'+dueDate+'</td>'+
      testCells+
      '<td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:6px;background:'+otlBg+';color:'+otlColor+';font-weight:600">'+overallTl+'</span></td>'+
      '</tr>';
  }).filter(Boolean);

  tbody.innerHTML=!tlRows.length?'<tr class="empty-row"><td colspan="10">No data found.</td></tr>':tlRows.join('');
  const footer=document.getElementById('s2-footer');
  if(footer) footer.textContent='Showing '+tlRows.length+' records';
}

/* -- Sheet 3 -- */
function renderSheet3(){
  const md=monthLayings();
  const fType=getVal('s3-filter-type');
  const fStat=getVal('s3-filter-status');
  const tbody=document.getElementById('s3-body');
  if(!tbody) return;

  const testRows=[];
  md.forEach(lay=>{
    Object.values(lay.tests||{}).forEach(t=>{
      if(fType && t.testType!==fType) return;
      const result=evalTestResult(t);
      if(fStat && result!==fStat) return;
      const pc=result==='Passed'?'p-pass':result==='Failed'?'p-rej':'p-pend';
      const rc=result==='Passed'?'#3B6D11':result==='Failed'?'#A32D2D':'#854F0B';
      const rb=result==='Passed'?'#EAF3DE':result==='Failed'?'#FCEBEB':'#FAEEDA';

      const cellVal=(val,min,max)=>{
        if(val===''||val===undefined) return '<td class="result-cell" style="color:var(--text-2)">--</td>';
        const v=parseFloat(val);
        const ok=inRange(v,min,max);
        const c=ok?'#3B6D11':'#A32D2D';
        return '<td class="result-cell"><span class="val" style="color:'+c+'">'+v+'</span>'+
          '<div class="req">'+min+'-'+max+'</div></td>';
      };

      const coreCell=()=>{
        if(!t.coreCount) return '<td class="result-cell" style="color:var(--text-2)">--</td>';
        const avg=parseFloat(t.coreAvg)||0;
        return '<td class="result-cell"><span class="val">'+t.coreCount+' cores</span>'+
          '<div class="req">Avg: '+avg.toFixed(1)+' mm</div></td>';
      };

      const bitCell=()=>{
        if(t.bitumen===''||t.bitumen===undefined) return '<td class="result-cell" style="color:var(--text-2)">--</td>';
        const v=parseFloat(t.bitumen);
        const target=parseFloat(t.bitumenTarget)||0;
        const ok=target?Math.abs(v-target)<=0.4:true;
        return '<td class="result-cell"><span class="val" style="color:'+(ok?'#3B6D11':'#A32D2D')+'">'+v+'%</span>'+
          (target?'<div class="req">Target: '+target+'%</div>':'')+'</td>';
      };

      const idx=layings.findIndex(x=>x._id===lay._id);
      testRows.push('<tr>'+
        '<td>'+fmtDate(lay.dateLaid)+'</td>'+
        '<td>'+fmtDate(t.dateTested)+'</td>'+
        '<td>'+(lay.client||'--')+'</td>'+
        '<td>'+(lay.project||'--')+'</td>'+
        '<td>'+(t.testType||'--')+'</td>'+
        '<td>'+(t.labNo||'--')+'</td>'+
        (t.testType==='Marshall Test'?cellVal(t.stability,SPECS.stability.min,SPECS.stability.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Marshall Test'?cellVal(t.flow,SPECS.flow.min,SPECS.flow.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Air Voids/VMA/VFA'?cellVal(t.airVoids,SPECS.airVoids.min,SPECS.airVoids.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Air Voids/VMA/VFA'?cellVal(t.vma,SPECS.vma.min,SPECS.vma.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Air Voids/VMA/VFA'?cellVal(t.vfa,SPECS.vfa.min,SPECS.vfa.max):'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        (t.testType==='Coring'?coreCell():'<td class="result-cell" style="color:var(--text-2)">--</td>')+
        '<td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:6px;background:'+rb+';color:'+rc+';font-weight:600">'+result+'</span></td>'+
        '<td>'+(lay.testCoord||'--')+'</td>'+
        '<td>'+(t.remarks||'--')+'</td>'+
        '<td><button class="act-btn" onclick="deleteTest('+idx+',\''+t._key+'\')" title="Delete">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A32D2D" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></td>'+
        '</tr>');
    });
  });

  tbody.innerHTML=!testRows.length?'<tr class="empty-row"><td colspan="16">No test results found.</td></tr>':testRows.join('');
  const footer=document.getElementById('s3-footer');
  if(footer) footer.textContent='Showing '+testRows.length+' test results';
}

/* ================================================================
   LAYING MODAL
   ================================================================ */
function openLayingForm(){
  try{
    editLayIdx=null; modalIsOpen=true;
    setVal('laying-modal-title','Log New Laying');
    const delBtn=document.getElementById('laying-delete-btn');
    if(delBtn) delBtn.style.display='none';
    setVal('laying-save-btn','Save');
    setVal('l-date',new Date().toISOString().split('T')[0]);
    ['l-client','l-project','l-location','l-thickness','l-area','l-tonnage','l-sitecoord','l-remarks','l-mixtype-other','l-testcoord-other'].forEach(id=>setVal(id,''));
    setVal('l-mixtype',''); setVal('l-testcoord','');
    const mow=document.getElementById('mixtype-other-wrap'); if(mow) mow.style.display='none';
    const tow=document.getElementById('testcoord-other-wrap'); if(tow) tow.style.display='none';
    const modal=document.getElementById('laying-modal');
    if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function openEditLaying(idx){
  try{
    editLayIdx=idx; modalIsOpen=true;
    const lay=layings[idx]; if(!lay) return;
    const titleEl=document.getElementById('laying-modal-title'); if(titleEl) titleEl.textContent='Edit Laying';
    const delBtn=document.getElementById('laying-delete-btn'); if(delBtn) delBtn.style.display='inline-flex';
    setVal('l-date',     lay.dateLaid);
    setVal('l-client',   lay.client);
    setVal('l-project',  lay.project);
    setVal('l-location', lay.location);
    setVal('l-thickness',lay.thickness);
    setVal('l-area',     lay.area);
    setVal('l-tonnage',  lay.tonnage);
    setVal('l-sitecoord',lay.siteCoord);
    setVal('l-remarks',  lay.remarks);
    const knownMix=['BCBC (Bituminous Concrete Base Course)','BCWC (Bituminous Concrete Wearing Course)','Overlay'];
    const mixIsOther=lay.mixType&&!knownMix.includes(lay.mixType);
    setVal('l-mixtype', mixIsOther?'__other__':lay.mixType||'');
    setVal('l-mixtype-other', mixIsOther?lay.mixType:'');
    const mow=document.getElementById('mixtype-other-wrap'); if(mow) mow.style.display=mixIsOther?'':'none';
    const knownCoords=['Dio Balili','Joshua Facun','Roni Aguilar','JM Buitizon','Teodoro Taysa'];
    const coordIsOther=lay.testCoord&&!knownCoords.includes(lay.testCoord);
    setVal('l-testcoord', coordIsOther?'__other__':lay.testCoord||'');
    setVal('l-testcoord-other', coordIsOther?lay.testCoord:'');
    const tow=document.getElementById('testcoord-other-wrap'); if(tow) tow.style.display=coordIsOther?'':'none';
    const modal=document.getElementById('laying-modal');
    if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function closeLayingModal(){
  modalIsOpen=false;
  const modal=document.getElementById('laying-modal');
  if(modal) modal.classList.remove('open');
  editLayIdx=null;
}

function toggleMixTypeOther(){
  const wrap=document.getElementById('mixtype-other-wrap');
  if(wrap) wrap.style.display=getVal('l-mixtype')==='__other__'?'':'none';
}

function toggleTestCoordOther(){
  const wrap=document.getElementById('testcoord-other-wrap');
  if(wrap) wrap.style.display=getVal('l-testcoord')==='__other__'?'':'none';
}

function saveLaying(){
  const date=getVal('l-date'), client=getVal('l-client').trim(), project=getVal('l-project').trim();
  if(!date||!client||!project){ toast('Please fill in Date, Client and Project.','#E24B4A'); return; }

  const mixType=getVal('l-mixtype')==='__other__'?getVal('l-mixtype-other').trim():getVal('l-mixtype');
  const testCoord=getVal('l-testcoord')==='__other__'?getVal('l-testcoord-other').trim():getVal('l-testcoord');
  const existing=editLayIdx!==null&&layings[editLayIdx]?(layings[editLayIdx].tests||{}):{};

  const entry={
    dateLaid:  date,
    client,
    project,
    location:  getVal('l-location').trim(),
    mixType,
    thickness: getVal('l-thickness'),
    area:      getVal('l-area'),
    tonnage:   getVal('l-tonnage'),
    siteCoord: getVal('l-sitecoord').trim(),
    testCoord,
    remarks:   getVal('l-remarks').trim(),
    tests:     existing,
  };

  const btn=document.getElementById('laying-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  const save=()=>{
    if(!isOnline||!db){
      const off={...entry,_id:'offline_'+Date.now(),_pending:true};
      layings.unshift(off); saveLocal(); pendingSync.push(entry);
      return Promise.resolve();
    }
    if(editLayIdx!==null&&layings[editLayIdx]&&layings[editLayIdx]._id)
      return db.ref('layings/'+layings[editLayIdx]._id).set(entry);
    return db.ref('layings').push(entry);
  };

  save()
    .then(()=>{
      closeLayingModal();
      buildMonthSelect();
      const sel=document.getElementById('sel-month');
      if(sel&&sel.value!=='all') sel.value=date.slice(0,7);
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast(editLayIdx!==null?'Laying updated!':'Laying logged: '+client+' - '+project,'#639922');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{if(btn){btn.textContent=editLayIdx!==null?'Save Changes':'Save';btn.disabled=false;}});
}

function deleteLaying(){
  if(editLayIdx===null) return;
  if(!confirm('Delete this laying record and all its test results?')) return;
  const id=layings[editLayIdx]._id;
  if(!isOnline||!db){toast('Cannot delete while offline','#E24B4A');return;}
  db.ref('layings/'+id).remove()
    .then(()=>{closeLayingModal();toast('Laying deleted.','#E24B4A');})
    .catch(err=>toast('Delete failed: '+err.message,'#E24B4A'));
}

/* ================================================================
   TEST RESULT MODAL
   ================================================================ */
function openTestModal(idx){
  try{
    testLayIdx=idx; modalIsOpen=true;
    const lay=layings[idx]; if(!lay) return;
    const info=document.getElementById('test-laying-info');
    if(info) info.innerHTML='<strong>'+lay.client+'</strong> - '+lay.project+' | Date Laid: <strong>'+lay.dateLaid+'</strong> | Mix: '+(lay.mixType||'--');
    setVal('t-type',''); setVal('t-date',new Date().toISOString().split('T')[0]);
    setVal('t-labno',''); setVal('t-stability',''); setVal('t-flow','');
    setVal('t-airvoids',''); setVal('t-vma',''); setVal('t-vfa','');
    setVal('t-corecount',''); setVal('t-coreavg','');
    setVal('t-bitumen',''); setVal('t-bitumentarget','');
    setVal('t-timeliness',''); setVal('t-result',''); setVal('t-remarks','');
    document.getElementById('core-inputs').innerHTML='';
    toggleTestFields();
    computeTimeliness();
    const modal=document.getElementById('test-modal');
    if(modal) modal.classList.add('open');
  }catch(e){ toast('Error: '+e.message,'#E24B4A'); }
}

function closeTestModal(){
  modalIsOpen=false;
  const modal=document.getElementById('test-modal');
  if(modal) modal.classList.remove('open');
  testLayIdx=null;
}

function toggleTestFields(){
  const type=getVal('t-type');
  document.getElementById('marshall-fields').style.display    = type==='Marshall Test'?'':'none';
  document.getElementById('volumetric-fields').style.display  = type==='Air Voids/VMA/VFA'?'':'none';
  document.getElementById('coring-fields').style.display      = type==='Coring'?'':'none';
  document.getElementById('extraction-fields').style.display  = type==='Extraction Test'?'':'none';

  // Update requirement labels
  document.getElementById('stability-req').textContent = '('+SPECS.stability.min+'-'+SPECS.stability.max+' kN)';
  document.getElementById('flow-req').textContent      = '('+SPECS.flow.min+'-'+SPECS.flow.max+' mm)';
  document.getElementById('av-req').textContent        = '('+SPECS.airVoids.min+'-'+SPECS.airVoids.max+'%)';
  document.getElementById('vma-req').textContent       = '('+SPECS.vma.min+'-'+SPECS.vma.max+'%)';
  document.getElementById('vfa-req').textContent       = '('+SPECS.vfa.min+'-'+SPECS.vfa.max+'%)';
  document.getElementById('core-count-req').textContent = '('+SPECS.coreMin+'-'+SPECS.coreMax+' cores)';
  computeTestResult();
}

function computeTimeliness(){
  const lay=testLayIdx!==null?layings[testLayIdx]:null;
  if(!lay) return;
  const dateTested=getVal('t-date');
  const tl=computeTimelinessStatus(lay.dateLaid, dateTested);
  const el=document.getElementById('t-timeliness');
  if(el){
    el.value=tl;
    el.style.color=tl==='On Time'?'#3B6D11':tl==='Late'?'#A32D2D':'#854F0B';
  }
}

function computeTestResult(){
  const type=getVal('t-type');
  const t={
    testType: type,
    stability: getVal('t-stability'),
    flow:      getVal('t-flow'),
    airVoids:  getVal('t-airvoids'),
    vma:       getVal('t-vma'),
    vfa:       getVal('t-vfa'),
    coreCount: getVal('t-corecount'),
    bitumen:   getVal('t-bitumen'),
    bitumenTarget: getVal('t-bitumentarget'),
  };
  const result=evalTestResult(t);
  const el=document.getElementById('t-result');
  if(el){
    el.value=result;
    el.style.color=result==='Passed'?'#3B6D11':result==='Failed'?'#A32D2D':'#854F0B';
  }
}

function buildCoreInputs(){
  const count=parseInt(getVal('t-corecount'))||0;
  const container=document.getElementById('core-inputs');
  if(!container) return;
  if(!count){container.innerHTML='';return;}
  let html='<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">Core Thickness Readings (mm)</div>';
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">';
  for(let i=1;i<=Math.min(count,30);i++){
    html+='<div class="form-group"><label>Core '+i+'</label>'+
      '<input type="number" id="core-'+i+'" placeholder="mm" step="0.1" oninput="computeCoreAvg()"></div>';
  }
  html+='</div>';
  container.innerHTML=html;
  computeTestResult();
}

function computeCoreAvg(){
  const count=parseInt(getVal('t-corecount'))||0;
  const vals=[];
  for(let i=1;i<=count;i++){
    const el=document.getElementById('core-'+i);
    if(el&&el.value) vals.push(parseFloat(el.value));
  }
  const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  setVal('t-coreavg', avg?avg.toFixed(1):'');
  computeTestResult();
}

function saveTestResult(){
  const type=getVal('t-type'), date=getVal('t-date');
  if(!type||!date){ toast('Please select Test Type and Date Tested.','#E24B4A'); return; }

  const count=parseInt(getVal('t-corecount'))||0;
  const coreReadings=[];
  for(let i=1;i<=count;i++){
    const el=document.getElementById('core-'+i);
    if(el&&el.value) coreReadings.push(parseFloat(el.value));
  }

  const lay=layings[testLayIdx];
  const testEntry={
    testType:      type,
    dateTested:    date,
    labNo:         getVal('t-labno').trim(),
    stability:     getVal('t-stability'),
    flow:          getVal('t-flow'),
    airVoids:      getVal('t-airvoids'),
    vma:           getVal('t-vma'),
    vfa:           getVal('t-vfa'),
    coreCount:     count,
    coreReadings,
    coreAvg:       getVal('t-coreavg'),
    bitumen:       getVal('t-bitumen'),
    bitumenTarget: getVal('t-bitumentarget'),
    timeliness:    getVal('t-timeliness'),
    result:        evalTestResult({testType:type,stability:getVal('t-stability'),flow:getVal('t-flow'),airVoids:getVal('t-airvoids'),vma:getVal('t-vma'),vfa:getVal('t-vfa'),coreCount:count,bitumen:getVal('t-bitumen'),bitumenTarget:getVal('t-bitumentarget')}),
    remarks:       getVal('t-remarks').trim(),
    _key:          type.replace(/[^a-zA-Z]/g,'_'),
  };

  const btn=document.getElementById('test-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}

  const pourId=lay._id;
  const testKey=type.replace(/[^a-zA-Z]/g,'_');

  db.ref('layings/'+pourId+'/tests/'+testKey).set(testEntry)
    .then(()=>{
      if(!layings[testLayIdx].tests) layings[testLayIdx].tests={};
      layings[testLayIdx].tests[testKey]=testEntry;
      saveLocal();
      closeTestModal();
      render();
      if(activeTab==='kpi') setTimeout(renderCharts,80);
      toast('Test result saved! '+testEntry.result,'#639922');
    })
    .catch(err=>toast('Save failed: '+err.message,'#E24B4A'))
    .finally(()=>{if(btn){btn.textContent='Save Result';btn.disabled=false;}});
}

function deleteTest(layIdx, testKey){
  if(!confirm('Delete this test result?')) return;
  const lay=layings[layIdx];
  if(!lay||!lay._id) return;
  db.ref('layings/'+lay._id+'/tests/'+testKey).remove()
    .then(()=>toast('Test deleted.','#E24B4A'))
    .catch(err=>toast('Delete failed: '+err.message,'#E24B4A'));
}

/* ================================================================
   AUTOCOMPLETE
   ================================================================ */
function updateAutocomplete(){
  const fields={
    'ac-client':  [...new Set(layings.map(d=>d.client).filter(Boolean))],
    'ac-project': [...new Set(layings.map(d=>d.project).filter(Boolean))],
    'ac-location':[...new Set(layings.map(d=>d.location).filter(Boolean))],
    'ac-sitecoord':[...new Set(layings.map(d=>d.siteCoord).filter(Boolean))],
    'ac-labno':   [...new Set(Object.values(layings.reduce((acc,l)=>({...acc,...(l.tests||{})}),{})).map(t=>t.labNo).filter(Boolean))],
  };
  Object.entries(fields).forEach(([id,values])=>{
    let dl=document.getElementById(id);
    if(!dl){dl=document.createElement('datalist');dl.id=id;document.body.appendChild(dl);}
    dl.innerHTML=values.map(v=>'<option value="'+v.replace(/"/g,'&quot;')+'">').join('');
  });
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
function exportCSV(){
  const md=monthLayings();
  if(!md.length){toast('No data to export.','#E24B4A');return;}
  const hdrs=['Date Laid','Client','Project','Location','Mix Type','Thickness','Area','Tonnage','Site Coord','Test Coord',
    'Test Type','Date Tested','Lab No.','Stability (kN)','Flow (mm)','Air Voids (%)','VMA (%)','VFA (%)','Core Count','Core Avg (mm)','Bitumen (%)','Timeliness','Result','Remarks'];
  const rows=[];
  md.forEach(lay=>{
    const tests=Object.values(lay.tests||{});
    if(!tests.length){
      rows.push([lay.dateLaid,lay.client,lay.project,lay.location,lay.mixType,lay.thickness,lay.area,lay.tonnage,lay.siteCoord,lay.testCoord,'','','','','','','','','','','','Pending','Pending',''].map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
    } else {
      tests.forEach(t=>{
        rows.push([lay.dateLaid,lay.client,lay.project,lay.location,lay.mixType,lay.thickness,lay.area,lay.tonnage,lay.siteCoord,lay.testCoord,
          t.testType,t.dateTested,t.labNo,t.stability,t.flow,t.airVoids,t.vma,t.vfa,t.coreCount,t.coreAvg,t.bitumen,t.timeliness,t.result,t.remarks]
          .map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
      });
    }
  });
  const csv=[hdrs.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const [y,mo]=(selMonth()||'').split('-');
  a.download='BigBen_Asphalt_QC_'+(y&&mo?y+'_'+mo:'export')+'.csv';
  a.click();
  toast('CSV exported.','#378ADD');
}

function printPage(){ window.print(); }

/* ================================================================
   TOAST
   ================================================================ */
function toast(msg,color){
  color=color||'#639922';
  const el=document.getElementById('toast');
  const dot=document.getElementById('toast-dot');
  const msgEl=document.getElementById('toast-msg');
  if(!el) return;
  if(dot) dot.style.background=color;
  if(msgEl) msgEl.textContent=msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),4000);
}

/* ================================================================
   KEYBOARD
   ================================================================ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){ closeLayingModal(); closeTestModal(); }
});

/* ================================================================
   EVENT LISTENERS
   ================================================================ */
document.addEventListener('DOMContentLoaded',function(){
  const sel=document.getElementById('sel-month');
  if(sel) sel.addEventListener('change',function(){render();if(activeTab==='kpi')setTimeout(renderCharts,80);});
  const mt=document.getElementById('l-mixtype');
  if(mt) mt.addEventListener('change',toggleMixTypeOther);
  const tc=document.getElementById('l-testcoord');
  if(tc) tc.addEventListener('change',toggleTestCoordOther);

  loadLocal();
  loadSpecsToForm();
  buildMonthSelect();
  render();
  initFirebase();
  updateOnlineStatus();
  setTimeout(renderCharts,200);
});

/* ============================================================
   GREKO EGYPT – SALES DASHBOARD  •  app.js  (v4)
   Modified to add: theme toggle, month filter, SKU YTD merge,
   Channel Performance, Year Comparison improvements, clickable
   Customer segments, table column re-orders.
   ============================================================ */
'use strict';

let curM = 'ton';
let currentPage = 'home';
let qFilter = 'ytd';           // Quarterly page: 'ytd','q1','q2'
let curMonths = [];            // Month filter: [] = YTD, else array of month_id numbers
let currentSort = { field: 's26', desc: true };
let custSegment = 'gold';      // Customer Analysis selected segment
let channelTab = 'overview';   // Channel Performance active tab
let custSearch = '';

Chart.register(ChartDataLabels);
Chart.defaults.color = '#8899bb';
Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
Chart.defaults.plugins.datalabels.display = true;
Chart.defaults.plugins.datalabels.color = '#fff';
Chart.defaults.plugins.datalabels.font = { size: 10, weight: '600' };
Chart.defaults.plugins.datalabels.formatter = v => (v===0||v==null) ? '' : v.toLocaleString('en',{minimumFractionDigits:1,maximumFractionDigits:1});

const C = {
  blue:'#003087', blueL:'#0052CC', cyan:'#00B4D8', teal:'#0077B6',
  green:'#06D6A0', red:'#EF476F', gold:'#F4A261', orange:'#FFB703',
  purple:'#7B2D8B', gray:'#8899bb',
};
const CAT_COLORS = {
  'Plain':C.blueL,'Tart & Fruit':C.green,'Yopolis PRO':C.cyan,
  'Labneh':C.gold,'Double Zero':C.purple,'Greko':C.teal,
  'Cream Cheese':C.orange,'Creams':C.red,'Yopo Flip':'#3AE8FF',
  'Dips':'#A78BFA','Bucket':'#34D399','Delights':'#F472B6'
};
const catColor = c => CAT_COLORS[c] || C.gray;

const _charts = {};
function mkChart(id, cfg){
  _charts[id]?.destroy();
  const el = document.getElementById(id);
  if(!el) return null;
  return (_charts[id] = new Chart(el, cfg));
}

const fmt = n => n==null||isNaN(n)?'–':n.toLocaleString('en',{minimumFractionDigits:1,maximumFractionDigits:1});
const fmtP = n => n==null||isNaN(n)?'–':(n>=0?'+':'')+n.toFixed(1)+'%';
const trunc = (s,n=22) => !s?'':s.length>n?s.slice(0,n)+'…':s;

const barOpts=(iH=false)=>({
  indexAxis: iH?'y':'x',
  responsive:true, maintainAspectRatio:false,
  plugins:{legend:{display:false}},
  scales:{
    x:{grid:{color:'rgba(255,255,255,0.05)',display:!iH},ticks:{font:{size:10}}},
    y:{grid:{color:'rgba(255,255,255,0.05)',display:iH}, ticks:{font:{size:iH?11:10},autoSkip:false}}
  }
});
const lineOpts=()=>({
  responsive:true,maintainAspectRatio:false,
  plugins:{legend:{position:'bottom'}},
  scales:{
    x:{grid:{display:false}},
    y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{font:{size:10}}}
  }
});

function kpi(icon,label,value,change,accent,sub='',opts={}){
  const chg = change!=null ? `<span class="kpi-change ${change>=0?'up':'down'}">${change>=0?'▲':'▼'} ${Math.abs(change).toFixed(1)}%</span>`:'';
  const cls = `kpi-card ${accent}${opts.click?' clickable':''}${opts.selected?' selected':''}`;
  const data = opts.click?`data-kpi="${opts.click}"`:'';
  return `<div class="${cls}" ${data}>
    <span class="kpi-icon">${icon}</span>
    <div class="kpi-value">${value}</div>
    <div class="kpi-label">${label}</div>
    ${sub?`<div class="kpi-sub">${sub}</div>`:''}
    ${chg}
  </div>`;
}
function card(title,sub,inner){
  return `<div class="chart-card"><div class="chart-header"><div><div class="chart-title">${title}</div>${sub?`<div class="chart-subtitle">${sub}</div>`:''}</div></div>${inner}</div>`;
}
function cw(id,h='280'){ return `<div class="chart-container" style="height:${h}px"><canvas id="${id}"></canvas></div>`; }
function badge(txt,cls){ return `<span class="badge ${cls}">${txt}</span>`; }

// ── Calculations ────────────────────────────────────────────────
function grow(v26, v25){ return v25>0 ? ((v26-v25)/v25*100) : (v26>0?100:0); }
function ach(v, t){ return t>0 ? (v/t*100) : 0; }
function retP(s, r){ return (s+r)>0 ? (r/(s+r)*100) : 0; }
function getSortHTML(label, field, cls=''){ return `<th data-sort="${field}"${cls?` class="${cls}"`:''}>${label}</th>`; }

// Month filter helpers ------------------------------------------------
// When curMonth==='ytd' we use meta totals (all YTD months).
// When a specific month is selected we compute from monthly_data.
function metaForCurrent(D){
  if(curMonth==='ytd') return D.meta[curM];
  const m = D.monthly_data.find(x=>x.month_id===+curMonth);
  if(!m) return D.meta[curM];
  return { s25:m[curM].s25, s26:m[curM].s26, r25:m[curM].r25, r26:m[curM].r26, tgt25:m[curM].tgt25||0, tgt26:m[curM].tgt26 };
}
function monthLabel(D){
  if(curMonth==='ytd') return D.meta.ytd_label;
  const m = D.monthly_data.find(x=>x.month_id===+curMonth);
  return m ? `${m.month_name} 2026 vs ${m.month_name} 2025` : D.meta.ytd_label;
}
function isMonthFiltered(){ return curMonth!=='ytd'; }
function filteredNote(text){
  if(!isMonthFiltered()) return '';
  return `<div class="filter-note">📅 Month filter active (${text}). Product/customer aggregates use YTD totals unless month-level data exists.</div>`;
}

// ── Page Routing ─────────────────────────────────────────────────
const PAGE_TITLES = {
  home:'Greko Company Dashboard', ytd:'SKU YTD Performance',
  channel:'Channel Performance',
  customers:'Customer Analysis', returns:'Returns Analysis',
  growth:'Growth Analysis', monthly:'Monthly Trend',
  quarterly:'Quarterly Dashboard', comparison:'Year Comparison'
};
function go(page){
  if(!PAGE_TITLES[page]) return;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.getElementById('page-title').textContent=PAGE_TITLES[page];
  currentPage=page;
  renderPage();
  document.getElementById('sidebar').classList.remove('open');
}

function renderPage(){
  const D = window.GREKO_DATA;
  if(!D) return;
  ({home:pgHome, ytd:pgYTD, channel:pgChannel, customers:pgCustomers,
    returns:pgReturns, growth:pgGrowth, monthly:pgMonthly,
    quarterly:pgQuarterly, comparison:pgComparison}[currentPage]||(()=>{}))(D);

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if(currentSort.field === field) currentSort.desc = !currentSort.desc;
      else { currentSort.field = field; currentSort.desc = true; }
      renderPage();
    });
  });
}

function sortData(arr, mk){
  return [...arr].sort((a,b) => {
    let va = a[mk][currentSort.field];
    let vb = b[mk][currentSort.field];
    if(currentSort.field==='name'){ va=a.name; vb=b.name; }
    if(currentSort.field==='cat'){ va=a.category||''; vb=b.category||''; }
    if(currentSort.field==='grow'){ va=grow(a[mk].s26,a[mk].s25); vb=grow(b[mk].s26,b[mk].s25); }
    if(currentSort.field==='growAbs'){ va=a[mk].s26-a[mk].s25; vb=b[mk].s26-b[mk].s25; }
    if(currentSort.field==='retP25'){ va=retP(a[mk].s25,a[mk].r25); vb=retP(b[mk].s25,b[mk].r25); }
    if(currentSort.field==='retP26'){ va=retP(a[mk].s26,a[mk].r26); vb=retP(b[mk].s26,b[mk].r26); }
    if(currentSort.field==='ach26'){ va=ach(a[mk].s26,a[mk].tgt26||0); vb=ach(b[mk].s26,b[mk].tgt26||0); }
    if(typeof va==='string') return currentSort.desc ? vb.localeCompare(va) : va.localeCompare(vb);
    return currentSort.desc ? (vb||0)-(va||0) : (va||0)-(vb||0);
  });
}

// ═══════════════════════════════════════════════════════════════
// HOME  (Executive Dashboard)
// ═══════════════════════════════════════════════════════════════
function pgHome(D){
  const m = metaForCurrent(D);
  const g = grow(m.s26, m.s25);
  const a26 = ach(m.s26, m.tgt26);
  const a25 = ach(m.s25, m.tgt25);
  const rp26 = retP(m.s26, m.r26);
  const rp25 = retP(m.s25, m.r25);

  const cats = [...D.category_data].filter(c=>c[curM].s26>0);

  document.getElementById('page-home').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="kpi-grid">
      ${kpi('💰',`Sales 2026 (${curM})`,fmt(m.s26),null,'cyan',`Target: ${fmt(m.tgt26)}`)}
      ${kpi('📅',`Sales 2025 (${curM})`,fmt(m.s25),null,'blue','')}
      ${kpi('📈','Growth %',fmtP(g),g,'green',`Δ ${fmt(m.s26-m.s25)}`)}
      ${kpi('🎯','Achievement 26',a26.toFixed(1)+'%',a26-100,'cyan',`25: ${a25.toFixed(1)}%`)}
      ${kpi('↩️','Returns 26',fmt(m.r26),null,'red',`25: ${fmt(m.r25)}`)}
      ${kpi('📉','Return Rate 26',rp26.toFixed(1)+'%',-(rp26-rp25),'red',`Was: ${rp25.toFixed(1)}%`)}
    </div>

    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📊 Sales by Category','Contribution 2026',cw('ch-h-cat','300'))}
      ${card('📅 Monthly Sales Trend','2025 vs 2026',cw('ch-h-mon','300'))}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📈 Category Growth Comparison','2025 vs 2026',cw('ch-h-catgrow','280'))}
      ${card('🎯 Achievement by Category','Ach% 2025 vs 2026',cw('ch-h-ach','320'))}
    </div>
  `;

  setTimeout(()=>{
    mkChart('ch-h-cat',{type:'doughnut',
      data:{labels:cats.map(c=>c.category),
        datasets:[{data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)),borderWidth:1,borderColor:'#0a1628'}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}
    });
    const md = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id).filter(m=>m.in_ytd);
    mkChart('ch-h-mon',{type:'line',
      data:{labels:md.map(m=>m.month_short),datasets:[
        {label:'2025',data:md.map(m=>m[curM].s25),borderColor:C.blueL,borderWidth:2,fill:false},
        {label:'2026',data:md.map(m=>m[curM].s26),borderColor:C.cyan,borderWidth:2.5,fill:false},
        {label:'Target 26',data:md.map(m=>m[curM].tgt26),borderColor:C.gold,borderDash:[4,4],borderWidth:1.5,fill:false}
      ]}, options:lineOpts()
    });
    cats.sort((a,b)=>b[curM].s26-a[curM].s26);
    mkChart('ch-h-catgrow',{type:'bar',
      data:{labels:cats.map(c=>c.category),datasets:[
        {label:'2025',data:cats.map(c=>c[curM].s25),backgroundColor:C.blueL+'BB',borderRadius:3},
        {label:'2026',data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)+'BB'),borderRadius:3}
      ]}, options:{...barOpts(),plugins:{legend:{display:true,position:'bottom'}}}
    });
    // Achievement % 2025 vs 2026 side-by-side per category
    mkChart('ch-h-ach',{type:'bar',
      data:{labels:cats.map(c=>c.category),datasets:[
        {label:'Ach% 2025',data:cats.map(c=>{const t=D.meta.ton && c[curM].s25 ? 0:0; return ach(c[curM].s25, (c[curM].tgt25||c[curM].s25));}), backgroundColor:C.blueL+'CC',borderRadius:4,datalabels:{formatter:v=>v.toFixed(0)+'%'}},
        {label:'Ach% 2026',data:cats.map(c=>ach(c[curM].s26, c[curM].tgt26)),backgroundColor:C.cyan+'CC',borderRadius:4,datalabels:{formatter:v=>v.toFixed(0)+'%'}}
      ]}, options:{...barOpts(),plugins:{legend:{display:true,position:'bottom'}}}
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// SKU YTD PERFORMANCE  (merged with Product Analysis)
// ═══════════════════════════════════════════════════════════════
function pgYTD(D){
  let items = sortData(D.product_data.map(p=>({...p,name:p.product})), curM);
  const active = items.filter(p=>p[curM].s25>0||p[curM].s26>0);
  const prods = [...active].sort((a,b)=>b[curM].s26-a[curM].s26);
  const top10 = prods.slice(0,10);
  const bot10 = [...prods].filter(p=>p[curM].s25>0).sort((a,b)=>grow(a[curM].s26,a[curM].s25)-grow(b[curM].s26,b[curM].s25)).slice(0,10);

  document.getElementById('page-ytd').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="chart-card">
      <div class="chart-header"><div class="chart-title">📋 SKU YTD Matrix</div></div>
      <div class="data-table-wrapper" style="max-height:520px;overflow:auto">
        <table class="data-table">
          <thead><tr>
            <th>#</th>
            ${getSortHTML('SKU','name')}
            ${getSortHTML('Product Category','cat')}
            ${getSortHTML('Sales 2025','s25','num')}
            ${getSortHTML('Return 25 %','retP25','num')}
            ${getSortHTML('Target 2026','tgt26','num')}
            ${getSortHTML('Sales 2026','s26','num')}
            ${getSortHTML('Return 26 %','retP26','num')}
            ${getSortHTML('Achievement 2026 %','ach26','num')}
            ${getSortHTML('Growth Ton','growAbs','num')}
            ${getSortHTML('Growth %','grow','num')}
          </tr></thead>
          <tbody>
            ${active.map((p,i)=>{
              const s25=p[curM].s25, s26=p[curM].s26, t26=p[curM].tgt26||0;
              const r25=p[curM].r25, r26=p[curM].r26;
              const rp25=retP(s25,r25), rp26=retP(s26,r26);
              const a=ach(s26,t26), g=grow(s26,s25), gAbs=s26-s25;
              return `<tr>
                <td>${i+1}</td>
                <td>${p.product}</td>
                <td style="color:${catColor(p.category)}">${p.category}</td>
                <td class="num">${fmt(s25)}</td>
                <td class="num" style="color:${rp25>10?C.red:rp25>5?C.gold:C.green}">${rp25.toFixed(1)}%</td>
                <td class="num">${fmt(t26)}</td>
                <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
                <td class="num" style="color:${rp26>10?C.red:rp26>5?C.gold:C.green}">${rp26.toFixed(1)}%</td>
                <td class="num" style="color:${a>=90?C.green:a>=70?C.gold:C.red}">${a.toFixed(1)}%</td>
                <td class="num">${(gAbs>=0?'+':'')+fmt(gAbs)}</td>
                <td class="num">${badge(fmtP(g),g>=0?'badge-up':'badge-down')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('🏆 Top 10 Products 2026','Full product names',cw('ch-p-top','460'))}
      ${card('📉 Bottom 10 Products','By Ton (2026)',cw('ch-p-bot','460'))}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📈 Category Growth %','',cw('ch-p-catmon','320'))}
    </div>
  `;

  setTimeout(()=>{
    // Top 10 full names — no truncation, generous left padding
    mkChart('ch-p-top',{type:'bar',
      data:{labels:top10.map(p=>p.product),
        datasets:[{data:top10.map(p=>p[curM].s26),backgroundColor:C.cyan+'BB',borderRadius:4}]},
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        layout:{padding:{left:0}},
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{font:{size:10}}},
          y:{grid:{display:false},ticks:{font:{size:11},autoSkip:false,callback:function(v){return this.getLabelForValue(v);}}}
        }
      }
    });
    // Bottom 10 — display Ton values (2026) instead of growth %
    mkChart('ch-p-bot',{type:'bar',
      data:{labels:bot10.map(p=>p.product),
        datasets:[{data:bot10.map(p=>p[curM].s26),backgroundColor:C.red+'BB',borderRadius:4,datalabels:{formatter:v=>fmt(v)}}]},
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{font:{size:10}}},
          y:{grid:{display:false},ticks:{font:{size:11},autoSkip:false}}
        }
      }
    });
    const cg = [...D.category_data].sort((a,b)=>grow(b[curM].s26,b[curM].s25)-grow(a[curM].s26,a[curM].s25));
    mkChart('ch-p-catmon',{type:'bar',
      data:{labels:cg.map(c=>c.category),datasets:[{label:'Growth%',data:cg.map(c=>grow(c[curM].s26,c[curM].s25)),backgroundColor:cg.map(c=>grow(c[curM].s26,c[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},
      options:barOpts(false)
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// CHANNEL PERFORMANCE  (categories used as channel proxy — dataset
// contains no channel field; UI ready to consume real channels)
// ═══════════════════════════════════════════════════════════════
function pgChannel(D){
  const m = metaForCurrent(D);
  const cats = [...D.category_data].filter(c=>c[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26);

  const tabs = ['overview','customers','products','returns'];
  const tabHTML = tabs.map(t=>`<button class="tab-btn ${channelTab===t?'active':''}" data-tab="${t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('');

  let inner='';
  if(channelTab==='overview'){
    const total26 = m.s26, total25 = m.s25;
    const g = grow(total26,total25);
    const rp26 = retP(total26, m.r26);
    inner = `
      <div class="kpi-grid">
        ${kpi('💰','Total Sales (Ton)',fmt(total26),null,'cyan','')}
        ${kpi('📈','Growth vs LY',fmtP(g),g,'green',`Δ ${fmt(total26-total25)}`)}
        ${kpi('↩️','Return Ton',fmt(m.r26),null,'red','')}
        ${kpi('📉','Return %',rp26.toFixed(1)+'%',null,'red','')}
        ${kpi('🥧','Categories',cats.length.toString(),null,'blue','Active categories')}
        ${kpi('👥','Active Customers',D.meta.customers_26.toString(),D.meta.customers_26-D.meta.customers_25,'gold','')}
      </div>
      <div class="chart-grid cols-2" style="margin-top:20px">
        ${card('📊 Sales by Category','Proxy for channel — dataset has no channel field',cw('ch-ch-bar','320'))}
        ${card('🥧 Category Contribution','',cw('ch-ch-donut','320'))}
      </div>
      <div class="chart-grid cols-1" style="margin-top:20px">
        ${card('📅 Monthly Trend','2025 vs 2026',cw('ch-ch-mon','300'))}
      </div>
    `;
  } else if(channelTab==='customers'){
    const cs = [...D.customer_data].filter(c=>c[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26);
    const top10 = cs.slice(0,10);
    inner = `
      <div class="chart-grid cols-2">
        ${card('🏆 Top 10 Customers','',cw('ch-ch-cust','380'))}
        ${card('📈 Customer Growth vs LY','Top 10',cw('ch-ch-custg','380'))}
      </div>
      <div class="chart-card" style="margin-top:20px">
        <div class="chart-header"><div class="chart-title">📋 All Customers</div></div>
        <div class="data-table-wrapper" style="max-height:420px;overflow:auto">
          <table class="data-table">
            <thead><tr><th>#</th><th>Customer</th><th class="num">Sales 25</th><th class="num">Sales 26</th><th class="num">Growth %</th></tr></thead>
            <tbody>${cs.slice(0,100).map((c,i)=>{
              const g=grow(c[curM].s26,c[curM].s25);
              return `<tr><td>${i+1}</td><td>${c.customer}</td><td class="num">${fmt(c[curM].s25)}</td><td class="num">${fmt(c[curM].s26)}</td><td class="num">${badge(fmtP(g),g>=0?'badge-up':'badge-down')}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } else if(channelTab==='products'){
    const prods = [...D.product_data].filter(p=>p[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26).slice(0,15);
    inner = `
      <div class="chart-grid cols-2">
        ${card('🏆 Top Products','',cw('ch-ch-prod','420'))}
        ${card('🥧 Brand (Category) Contribution','',cw('ch-ch-brand','420'))}
      </div>
      <div class="chart-grid cols-1" style="margin-top:20px">
        ${card('📈 Product Category Trend','Sales 26 by category',cw('ch-ch-prodt','300'))}
      </div>`;
  } else if(channelTab==='returns'){
    const rc = [...D.category_data].filter(c=>c[curM].r26>0).sort((a,b)=>b[curM].r26-a[curM].r26);
    const rp = [...D.product_data].filter(p=>p[curM].r26>0).sort((a,b)=>b[curM].r26-a[curM].r26).slice(0,10);
    inner = `
      <div class="chart-grid cols-2">
        ${card('↩️ Returns by Category','',cw('ch-ch-retc','340'))}
        ${card('📉 Return % by Category','',cw('ch-ch-retp','340'))}
      </div>
      <div class="chart-card" style="margin-top:20px">
        <div class="chart-header"><div class="chart-title">🏷️ Top Returned Products</div></div>
        <table class="data-table">
          <thead><tr><th>#</th><th>Product</th><th>Category</th><th class="num">Return 26</th><th class="num">Return %</th></tr></thead>
          <tbody>${rp.map((p,i)=>{
            const r=p[curM].r26, s=p[curM].s26;
            return `<tr><td>${i+1}</td><td>${p.product}</td><td style="color:${catColor(p.category)}">${p.category}</td><td class="num" style="color:${C.red}">${fmt(r)}</td><td class="num">${retP(s,r).toFixed(1)}%</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="chart-grid cols-1" style="margin-top:20px">
        ${card('📅 Monthly Returns Trend','',cw('ch-ch-retm','300'))}
      </div>`;
  }

  document.getElementById('page-channel').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="tabs">${tabHTML}</div>
    <div id="channel-body">${inner}</div>
  `;
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{channelTab=b.dataset.tab; renderPage();}));

  setTimeout(()=>{
    if(channelTab==='overview'){
      mkChart('ch-ch-bar',{type:'bar',
        data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)+'CC'),borderRadius:4}]},
        options:barOpts(false)});
      mkChart('ch-ch-donut',{type:'doughnut',
        data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)),borderWidth:1,borderColor:'#0a1628'}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});
      const md=[...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
      mkChart('ch-ch-mon',{type:'line',
        data:{labels:md.map(m=>m.month_short),datasets:[
          {label:'2025',data:md.map(m=>m[curM].s25),borderColor:C.blueL,borderWidth:2,fill:false},
          {label:'2026',data:md.map(m=>m[curM].s26),borderColor:C.cyan,borderWidth:2.5,fill:false}
        ]}, options:lineOpts()});
    } else if(channelTab==='customers'){
      const top10=[...D.customer_data].filter(c=>c[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26).slice(0,10);
      mkChart('ch-ch-cust',{type:'bar',data:{labels:top10.map(c=>c.customer),datasets:[{data:top10.map(c=>c[curM].s26),backgroundColor:C.gold+'CC',borderRadius:4}]},options:{...barOpts(true),scales:{...barOpts(true).scales,y:{...barOpts(true).scales.y,ticks:{font:{size:11},autoSkip:false}}}}});
      mkChart('ch-ch-custg',{type:'bar',data:{labels:top10.map(c=>c.customer),datasets:[{data:top10.map(c=>grow(c[curM].s26,c[curM].s25)),backgroundColor:top10.map(c=>grow(c[curM].s26,c[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},options:{...barOpts(true),scales:{...barOpts(true).scales,y:{...barOpts(true).scales.y,ticks:{font:{size:11},autoSkip:false}}}}});
    } else if(channelTab==='products'){
      const prods=[...D.product_data].filter(p=>p[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26).slice(0,15);
      mkChart('ch-ch-prod',{type:'bar',data:{labels:prods.map(p=>p.product),datasets:[{data:prods.map(p=>p[curM].s26),backgroundColor:C.cyan+'CC',borderRadius:4}]},options:{...barOpts(true),scales:{...barOpts(true).scales,y:{...barOpts(true).scales.y,ticks:{font:{size:11},autoSkip:false}}}}});
      const cts=[...D.category_data].filter(c=>c[curM].s26>0);
      mkChart('ch-ch-brand',{type:'doughnut',data:{labels:cts.map(c=>c.category),datasets:[{data:cts.map(c=>c[curM].s26),backgroundColor:cts.map(c=>catColor(c.category))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});
      mkChart('ch-ch-prodt',{type:'bar',data:{labels:cts.map(c=>c.category),datasets:[{label:'2025',data:cts.map(c=>c[curM].s25),backgroundColor:C.blueL+'AA'},{label:'2026',data:cts.map(c=>c[curM].s26),backgroundColor:C.cyan+'CC'}]},options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
    } else if(channelTab==='returns'){
      const rc=[...D.category_data].filter(c=>c[curM].r26>0).sort((a,b)=>b[curM].r26-a[curM].r26);
      mkChart('ch-ch-retc',{type:'bar',data:{labels:rc.map(c=>c.category),datasets:[{label:'2025',data:rc.map(c=>c[curM].r25),backgroundColor:C.blueL+'AA'},{label:'2026',data:rc.map(c=>c[curM].r26),backgroundColor:C.red+'CC'}]},options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
      mkChart('ch-ch-retp',{type:'bar',data:{labels:rc.map(c=>c.category),datasets:[{data:rc.map(c=>retP(c[curM].s26,c[curM].r26)),backgroundColor:C.red+'CC',borderRadius:4,datalabels:{formatter:v=>v.toFixed(1)+'%'}}]},options:barOpts(false)});
      const md=[...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
      mkChart('ch-ch-retm',{type:'line',data:{labels:md.map(m=>m.month_short),datasets:[{label:'2025',data:md.map(m=>m[curM].r25),borderColor:C.blueL,fill:false,borderWidth:2},{label:'2026',data:md.map(m=>m[curM].r26),borderColor:C.red,fill:false,borderWidth:2.5}]},options:lineOpts()});
    }
  },50);
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════
function pgCustomers(D){
  let cs = [...D.customer_data].filter(c=>c[curM].s26>0 && c.in_25).sort((a,b)=>b[curM].s26-a[curM].s26);
  const gold = cs.slice(0,10);
  const silver = cs.slice(10, Math.floor(10 + cs.length*0.3));
  const bronze = cs.slice(10 + silver.length);
  const lost = [...D.customer_data].filter(c=>c[curM].s25>0 && c[curM].s26===0).sort((a,b)=>b[curM].s25-a[curM].s25);

  const segMap = { gold, silver, bronze, lost };
  const seg = segMap[custSegment] || gold;

  // Top-returned/top-selling SKU per customer (best-effort proxy: uses top product in same period)
  // Since dataset has no customer×SKU breakdown, we surface the overall top-selling and top-returned SKU as reference.
  const topSellingSKU = [...D.product_data].sort((a,b)=>b[curM].s26-a[curM].s26)[0];
  const topReturnedSKU = [...D.product_data].sort((a,b)=>b[curM].r26-a[curM].r26)[0];

  const top20 = [...D.customer_data].filter(c=>c[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26).slice(0,20);

  const isLost = custSegment==='lost';
  const segRows = seg.map((c,i)=>`<tr>
    <td>${i+1}</td>
    <td>${c.customer}</td>
    <td class="num">${fmt(isLost?c[curM].s25:c[curM].s26)}</td>
    <td class="num">${fmt(isLost?c[curM].r25:c[curM].r26)}</td>
  </tr>`).join('');

  document.getElementById('page-customers').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('🥇','Gold (Top 10)','10',null,'gold','Best returning customers',{click:'gold',selected:custSegment==='gold'})}
      ${kpi('🥈','Silver',silver.length.toString(),null,'cyan','Next 30%',{click:'silver',selected:custSegment==='silver'})}
      ${kpi('🥉','Bronze',bronze.length.toString(),null,'blue','Remaining returning',{click:'bronze',selected:custSegment==='bronze'})}
      ${kpi('❌','Lost Customers',lost.length.toString(),null,'red','Purchased 25, zero 26',{click:'lost',selected:custSegment==='lost'})}
    </div>

    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 ${custSegment[0].toUpperCase()+custSegment.slice(1)} Customers</div></div>
      <input class="search-input" id="cust-search" placeholder="Search customers…" value="${custSearch.replace(/"/g,'&quot;')}">
      <div class="data-table-wrapper" style="max-height:360px;overflow:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Customer Name</th><th class="num">Sales Ton</th><th class="num">Return Ton</th></tr></thead>
          <tbody id="seg-body">${segRows}</tbody>
        </table>
      </div>
    </div>

    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">🏆 Top 20 Customers</div><div class="chart-subtitle">Top selling & top returned SKU shown as overall dataset reference (customer×SKU detail not in dataset)</div></div>
      <div class="data-table-wrapper" style="max-height:520px;overflow:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Customer Name</th><th class="num">Sales Ton</th><th>Top Selling SKU (Ton)</th><th>Top Returned SKU (Ton)</th></tr></thead>
          <tbody>${top20.map((c,i)=>`<tr>
            <td>${i+1}</td>
            <td>${c.customer}</td>
            <td class="num">${fmt(c[curM].s26)}</td>
            <td>${topSellingSKU?topSellingSKU.product:'–'} <span style="color:${C.gray};font-size:11px">(${topSellingSKU?fmt(topSellingSKU[curM].s26):'–'})</span></td>
            <td>${topReturnedSKU?topReturnedSKU.product:'–'} <span style="color:${C.gray};font-size:11px">(${topReturnedSKU?fmt(topReturnedSKU[curM].r26):'–'})</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;

  // Wire clickable KPIs
  document.querySelectorAll('[data-kpi]').forEach(el=>{
    el.addEventListener('click', ()=>{ custSegment = el.dataset.kpi; custSearch=''; renderPage(); });
  });
  const search = document.getElementById('cust-search');
  if(search){
    search.addEventListener('input', e=>{
      custSearch = e.target.value.toLowerCase();
      const body = document.getElementById('seg-body');
      const filtered = seg.filter(c=>c.customer.toLowerCase().includes(custSearch));
      body.innerHTML = filtered.map((c,i)=>`<tr>
        <td>${i+1}</td><td>${c.customer}</td>
        <td class="num">${fmt(isLost?c[curM].s25:c[curM].s26)}</td>
        <td class="num">${fmt(isLost?c[curM].r25:c[curM].r26)}</td>
      </tr>`).join('');
    });
    // Restore cursor at end
    search.focus(); search.setSelectionRange(search.value.length, search.value.length);
  }
}

// ═══════════════════════════════════════════════════════════════
// RETURNS
// ═══════════════════════════════════════════════════════════════
function pgReturns(D){
  const cats = [...D.category_data].filter(c=>c[curM].r25>0||c[curM].r26>0).sort((a,b)=>b[curM].r26-a[curM].r26);
  document.getElementById('page-returns').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="chart-grid cols-2">
      ${card('📅 Monthly Return Trend','2025 vs 2026',cw('ch-r-mon','300'))}
      ${card('🗂️ Return Volume by Category','',cw('ch-r-cat','300'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 Return Details (Category Level)</div></div>
      <table class="data-table">
        <thead><tr><th>Category</th><th class="num">Return 25</th><th class="num">Return 26</th><th class="num">Ret% 25</th><th class="num">Ret% 26</th></tr></thead>
        <tbody>${cats.map(c=>{
          const r25=c[curM].r25, r26=c[curM].r26, rp25=retP(c[curM].s25,r25), rp26=retP(c[curM].s26,r26);
          return `<tr><td>${c.category}</td><td class="num">${fmt(r25)}</td><td class="num" style="color:${C.red}">${fmt(r26)}</td>
          <td class="num">${rp25.toFixed(1)}%</td><td class="num" style="color:${rp26>rp25?C.red:C.green}">${rp26.toFixed(1)}%</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(()=>{
    const md=[...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
    mkChart('ch-r-mon',{type:'line',data:{labels:md.map(m=>m.month_short),datasets:[
      {label:'2025',data:md.map(m=>m[curM].r25),borderColor:C.blueL,fill:false,borderWidth:2},
      {label:'2026',data:md.map(m=>m[curM].r26),borderColor:C.red,fill:false,borderWidth:2.5}
    ]}, options:lineOpts()});
    mkChart('ch-r-cat',{type:'bar',data:{labels:cats.map(c=>c.category),datasets:[
      {label:'2025',data:cats.map(c=>c[curM].r25),backgroundColor:C.blueL+'AA'},
      {label:'2026',data:cats.map(c=>c[curM].r26),backgroundColor:C.red+'CC'}
    ]}, options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
  },50);
}

// ═══════════════════════════════════════════════════════════════
// GROWTH
// ═══════════════════════════════════════════════════════════════
function pgGrowth(D){
  const cats = [...D.category_data].filter(c=>c[curM].s25>0||c[curM].s26>0).sort((a,b)=>(b[curM].s26-b[curM].s25)-(a[curM].s26-a[curM].s25));
  document.getElementById('page-growth').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="chart-grid cols-2">
      ${card('📊 Growth Variance by Category','Absolute Difference',cw('ch-g-cat','350'))}
      ${card('📈 Growth % by Category','Relative Difference',cw('ch-g-catp','350'))}
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-g-cat',{type:'bar',data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>c[curM].s26-c[curM].s25),backgroundColor:cats.map(c=>c[curM].s26>=c[curM].s25?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>(v>=0?'+':'')+fmt(v)}}]},options:barOpts(true)});
    mkChart('ch-g-catp',{type:'bar',data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>grow(c[curM].s26,c[curM].s25)),backgroundColor:cats.map(c=>grow(c[curM].s26,c[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},options:barOpts(true)});
  },50);
}

// ═══════════════════════════════════════════════════════════════
// MONTHLY  (table columns re-ordered)
// ═══════════════════════════════════════════════════════════════
function pgMonthly(D){
  let md = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id);
  if(isMonthFiltered()) md = md.filter(m=>m.month_id===+curMonth);
  document.getElementById('page-monthly').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="chart-grid cols-1">
      ${card('📅 Monthly Detail','Sales 2025 vs 2026 vs Target',cw('ch-m-bar','350'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <table class="data-table">
        <thead><tr>
          <th>Month</th>
          <th class="num">Sales 2025</th>
          <th class="num">Target 2026</th>
          <th class="num">Sales 2026</th>
          <th class="num">Achievement 2026 %</th>
          <th class="num">Growth %</th>
        </tr></thead>
        <tbody>${md.map(m=>{
          const s25=m[curM].s25, s26=m[curM].s26, t26=m[curM].tgt26;
          const g=grow(s26,s25), a=ach(s26,t26);
          return `<tr>
            <td><strong>${m.month_name}</strong> ${m.in_ytd?badge('YTD','badge-new'):''}</td>
            <td class="num">${fmt(s25)}</td>
            <td class="num">${fmt(t26)}</td>
            <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
            <td class="num" style="color:${a>=90?C.green:a>=70?C.gold:C.red}">${a.toFixed(1)}%</td>
            <td class="num">${badge(fmtP(g),g>=0?'badge-up':'badge-down')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-m-bar',{type:'bar',data:{labels:md.map(m=>m.month_short),datasets:[
      {label:'2025',data:md.map(m=>m[curM].s25),backgroundColor:C.blueL+'AA'},
      {label:'2026',data:md.map(m=>m[curM].s26),backgroundColor:C.cyan+'CC'},
      {label:'Target 26',data:md.map(m=>m[curM].tgt26),type:'line',borderColor:C.gold,borderDash:[4,4],fill:false,pointRadius:0,datalabels:{display:false}}
    ]}, options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
  },50);
}

// ═══════════════════════════════════════════════════════════════
// QUARTERLY
// ═══════════════════════════════════════════════════════════════
function pgQuarterly(D){
  document.getElementById('page-quarterly').innerHTML=`
    <div class="q-slicer">
      <button class="q-btn ${qFilter==='q1'?'active':''}" data-q="q1">Q1</button>
      <button class="q-btn ${qFilter==='q2'?'active':''}" data-q="q2">Q2</button>
      <button class="q-btn ${qFilter==='ytd'?'active':''}" data-q="ytd">YTD</button>
    </div>
    <div id="q-content"></div>
  `;
  document.querySelectorAll('.q-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{ qFilter=e.target.dataset.q; renderPage(); });
  });
  const mds=[...D.monthly_data].sort((a,b)=>a.month_id-b.month_id);
  const fil = qFilter==='q1' ? mds.slice(0,3) : qFilter==='q2' ? mds.slice(3,6) : mds.filter(m=>m.in_ytd);
  let s25=0,s26=0,t26=0,r25=0,r26=0;
  fil.forEach(m=>{s25+=m[curM].s25;s26+=m[curM].s26;t26+=m[curM].tgt26;r25+=m[curM].r25;r26+=m[curM].r26;});
  const g=grow(s26,s25), a=ach(s26,t26);
  document.getElementById('q-content').innerHTML=`
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('💰','Sales 2026',fmt(s26),null,'cyan',`Target: ${fmt(t26)}`)}
      ${kpi('📅','Sales 2025',fmt(s25),null,'blue','')}
      ${kpi('📈','Growth',fmtP(g),g,'green','')}
      ${kpi('🎯','Achievement',a.toFixed(1)+'%',a-100,'cyan','')}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📊 Sales by Month','',cw('ch-q-sales','300'))}
      ${card('↩️ Returns by Month','',cw('ch-q-ret','300'))}
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-q-sales',{type:'bar',data:{labels:fil.map(m=>m.month_short),datasets:[
      {label:'2025',data:fil.map(m=>m[curM].s25),backgroundColor:C.blueL+'AA'},
      {label:'2026',data:fil.map(m=>m[curM].s26),backgroundColor:C.cyan+'CC'}
    ]}, options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
    mkChart('ch-q-ret',{type:'bar',data:{labels:fil.map(m=>m.month_short),datasets:[
      {label:'2025',data:fil.map(m=>m[curM].r25),backgroundColor:C.blueL+'AA'},
      {label:'2026',data:fil.map(m=>m[curM].r26),backgroundColor:C.red+'CC'}
    ]}, options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
  },50);
}

// ═══════════════════════════════════════════════════════════════
// YEAR COMPARISON  (expanded executive view)
// ═══════════════════════════════════════════════════════════════
function pgComparison(D){
  const m = metaForCurrent(D);
  const g = grow(m.s26, m.s25);
  const gR = grow(m.r26, m.r25);
  const cats = [...D.category_data];

  // Best/worst growing products
  const prods = D.product_data.filter(p=>p[curM].s25>0);
  const bestP = [...prods].sort((a,b)=>grow(b[curM].s26,b[curM].s25)-grow(a[curM].s26,a[curM].s25)).slice(0,5);
  const worstP = [...prods].sort((a,b)=>grow(a[curM].s26,a[curM].s25)-grow(b[curM].s26,b[curM].s25)).slice(0,5);

  // Best performing customers by growth
  const cs = D.customer_data.filter(c=>c[curM].s25>0 && c[curM].s26>0);
  const bestC = [...cs].sort((a,b)=>grow(b[curM].s26,b[curM].s25)-grow(a[curM].s26,a[curM].s25)).slice(0,5);

  document.getElementById('page-comparison').innerHTML=`
    ${filteredNote(monthLabel(D))}
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('💰','Total Sales 2026',fmt(m.s26),g,'cyan',`2025: ${fmt(m.s25)}`)}
      ${kpi('🎯','Target Variance',fmt(m.tgt26-m.tgt25),null,'gold',`26T: ${fmt(m.tgt26)}`)}
      ${kpi('↩️','Total Returns 26',fmt(m.r26),gR,'red',`2025: ${fmt(m.r25)}`)}
      ${kpi('👥','Customers 26',D.meta.customers_26.toString(),grow(D.meta.customers_26,D.meta.customers_25),'blue',`2025: ${D.meta.customers_25}`)}
    </div>

    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📊 Sales Comparison by Month','',cw('ch-cmp-mon','320'))}
      ${card('📈 Growth % by Month','',cw('ch-cmp-mong','320'))}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('🥧 Category Contribution 2025','',cw('ch-cmp-c25','300'))}
      ${card('🥧 Category Contribution 2026','',cw('ch-cmp-c26','300'))}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📊 Cumulative Sales Trend','YTD Accumulation',cw('ch-cmp-cum','350'))}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('↩️ Return Trend Comparison','',cw('ch-cmp-ret','300'))}
      ${card('📈 Total vs Target 2026','',cw('ch-cmp-tt','300'))}
    </div>

    <div class="chart-grid cols-2" style="margin-top:20px">
      <div class="chart-card">
        <div class="chart-header"><div class="chart-title">🌟 Best Growing Products</div></div>
        <table class="data-table"><thead><tr><th>Product</th><th class="num">Sales 25</th><th class="num">Sales 26</th><th class="num">Growth</th></tr></thead>
        <tbody>${bestP.map(p=>`<tr><td>${p.product}</td><td class="num">${fmt(p[curM].s25)}</td><td class="num">${fmt(p[curM].s26)}</td><td class="num">${badge(fmtP(grow(p[curM].s26,p[curM].s25)),'badge-up')}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="chart-card">
        <div class="chart-header"><div class="chart-title">📉 Worst Performing Products</div></div>
        <table class="data-table"><thead><tr><th>Product</th><th class="num">Sales 25</th><th class="num">Sales 26</th><th class="num">Growth</th></tr></thead>
        <tbody>${worstP.map(p=>`<tr><td>${p.product}</td><td class="num">${fmt(p[curM].s25)}</td><td class="num">${fmt(p[curM].s26)}</td><td class="num">${badge(fmtP(grow(p[curM].s26,p[curM].s25)),'badge-down')}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>

    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">🏆 Best Performing Customers (by growth)</div></div>
      <table class="data-table"><thead><tr><th>Customer</th><th class="num">Sales 25</th><th class="num">Sales 26</th><th class="num">Growth</th></tr></thead>
      <tbody>${bestC.map(c=>`<tr><td>${c.customer}</td><td class="num">${fmt(c[curM].s25)}</td><td class="num">${fmt(c[curM].s26)}</td><td class="num">${badge(fmtP(grow(c[curM].s26,c[curM].s25)),'badge-up')}</td></tr>`).join('')}</tbody></table>
    </div>
  `;

  setTimeout(()=>{
    const md=[...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
    mkChart('ch-cmp-mon',{type:'bar',data:{labels:md.map(m=>m.month_short),datasets:[
      {label:'2025',data:md.map(m=>m[curM].s25),backgroundColor:C.blueL+'AA'},
      {label:'2026',data:md.map(m=>m[curM].s26),backgroundColor:C.cyan+'CC'}
    ]}, options:{...barOpts(false),plugins:{legend:{display:true,position:'bottom'}}}});
    mkChart('ch-cmp-mong',{type:'bar',data:{labels:md.map(m=>m.month_short),datasets:[{data:md.map(m=>grow(m[curM].s26,m[curM].s25)),backgroundColor:md.map(m=>grow(m[curM].s26,m[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},options:barOpts(false)});
    const c25 = cats.filter(c=>c[curM].s25>0);
    const c26 = cats.filter(c=>c[curM].s26>0);
    mkChart('ch-cmp-c25',{type:'doughnut',data:{labels:c25.map(c=>c.category),datasets:[{data:c25.map(c=>c[curM].s25),backgroundColor:c25.map(c=>catColor(c.category))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});
    mkChart('ch-cmp-c26',{type:'doughnut',data:{labels:c26.map(c=>c.category),datasets:[{data:c26.map(c=>c[curM].s26),backgroundColor:c26.map(c=>catColor(c.category))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});
    let a25=0,a26=0; const cd25=[],cd26=[];
    md.forEach(m=>{a25+=m[curM].s25;a26+=m[curM].s26;cd25.push(a25);cd26.push(a26);});
    mkChart('ch-cmp-cum',{type:'line',data:{labels:md.map(m=>m.month_short),datasets:[
      {label:'2025 Cum',data:cd25,borderColor:C.blueL,backgroundColor:C.blueL+'11',fill:true,borderWidth:2},
      {label:'2026 Cum',data:cd26,borderColor:C.cyan,backgroundColor:C.cyan+'11',fill:true,borderWidth:2.5}
    ]}, options:lineOpts()});
    mkChart('ch-cmp-ret',{type:'line',data:{labels:md.map(m=>m.month_short),datasets:[
      {label:'Ret 25',data:md.map(m=>m[curM].r25),borderColor:C.blueL,fill:false,borderWidth:2},
      {label:'Ret 26',data:md.map(m=>m[curM].r26),borderColor:C.red,fill:false,borderWidth:2.5}
    ]}, options:lineOpts()});
    mkChart('ch-cmp-tt',{type:'bar',data:{labels:['2025','Target 26','Actual 26'],datasets:[{data:[m.s25,m.tgt26,m.s26],backgroundColor:[C.blueL+'AA',C.gold+'CC',C.cyan+'CC'],borderRadius:4,datalabels:{formatter:v=>fmt(v)}}]},options:barOpts(false)});
  },50);
}

// ═══════════════════════════════════════════════════════════════
// THEME + MONTH FILTER + INIT
// ═══════════════════════════════════════════════════════════════
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if(btn) btn.textContent = t==='light' ? '☀️' : '🌙';
  try{ localStorage.setItem('greko-theme', t); }catch(e){}
  // Re-render so chart colors update contrast if needed
  Chart.defaults.color = t==='light' ? '#495a75' : '#8899bb';
  Chart.defaults.borderColor = t==='light' ? 'rgba(10,22,40,0.08)' : 'rgba(255,255,255,0.05)';
  Chart.defaults.plugins.datalabels.color = t==='light' ? '#0a1628' : '#fff';
  renderPage();
}

function buildMonthFilter(D){
  const sel = document.getElementById('month-filter');
  if(!sel) return;
  const months = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id);
  sel.innerHTML = `<option value="ytd">YTD (Auto — All 2026 Months)</option>` +
    months.map(m=>`<option value="${m.month_id}">${m.month_name}</option>`).join('');
  sel.value = curMonth;
  sel.addEventListener('change', e=>{ curMonth = e.target.value; renderPage(); });
}

function init(){
  const D=window.GREKO_DATA;
  if(!D){ document.getElementById('loading-overlay').innerHTML='<h2>Error: data.js not found</h2>'; return; }

  document.getElementById('last-update').textContent=new Date().toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('ytd-label-top').textContent = D.meta.ytd_label;

  document.querySelectorAll('.measure-btn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      document.querySelectorAll('.measure-btn').forEach(b=>b.classList.remove('active'));
      e.target.classList.add('active');
      curM = e.target.dataset.measure;
      renderPage();
    });
  });

  document.querySelectorAll('.nav-item').forEach(el=>{
    el.addEventListener('click',e=>{e.preventDefault(); go(el.dataset.page);});
  });

  const mt = document.getElementById('menu-toggle');
  if(mt) mt.addEventListener('click', ()=>document.getElementById('sidebar').classList.toggle('open'));

  // Theme
  let theme = 'dark';
  try{ theme = localStorage.getItem('greko-theme') || 'dark'; }catch(e){}
  applyTheme(theme);
  document.getElementById('theme-toggle').addEventListener('click', ()=>{
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur==='dark' ? 'light' : 'dark');
  });

  // Month filter
  buildMonthFilter(D);

  go('home');

  setTimeout(()=>{
    const ov=document.getElementById('loading-overlay');
    if(ov){ov.classList.add('hidden'); setTimeout(()=>ov.remove(),600);}
  },500);
}
document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',init) : init();

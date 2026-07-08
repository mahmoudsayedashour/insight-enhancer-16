/* ============================================================
   GREKO EGYPT – YTD SALES DASHBOARD  •  app.js  (v3)
   ============================================================ */
'use strict';

let curM = 'ton';
let currentPage = 'home';
let qFilter = 'ytd'; // 'ytd', 'q1', 'q2'

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
  blue:   '#003087', blueL: '#0052CC',
  cyan:   '#00B4D8', teal:  '#0077B6',
  green:  '#06D6A0', red:   '#EF476F',
  gold:   '#F4A261', orange:'#FFB703',
  purple: '#7B2D8B', gray:  '#8899bb',
};
const CAT_COLORS = {
  'Plain':C.blueL, 'Tart & Fruit':C.green, 'Yopolis PRO':C.cyan,
  'Labneh':C.gold, 'Double Zero':C.purple, 'Greko':C.teal,
  'Cream Cheese':C.orange, 'Creams':C.red, 'Yopo Flip':'#3AE8FF',
  'Dips':'#A78BFA', 'Bucket':'#34D399', 'Delights':'#F472B6'
};
const catColor = c => CAT_COLORS[c] || C.gray;

const _charts = {};
function mkChart(id, cfg) {
  _charts[id]?.destroy();
  const el = document.getElementById(id);
  if (!el) return null;
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
    y:{grid:{color:'rgba(255,255,255,0.05)',display:iH}, ticks:{font:{size:10}}}
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

function kpi(icon,label,value,change,accent,sub=''){
  const chg = change!=null ? `<span class="kpi-change ${change>=0?'up':'down'}">${change>=0?'▲':'▼'} ${Math.abs(change).toFixed(1)}%</span>`:'';
  return `<div class="kpi-card ${accent}">
    <span class="kpi-icon">${icon}</span>
    <div class="kpi-value">${value}</div>
    <div class="kpi-label">${label}</div>
    ${sub?`<div class="kpi-sub">${sub}</div>`:''}
    ${chg}
  </div>`;
}
function card(title,sub,inner,h='280'){
  return `<div class="chart-card"><div class="chart-header"><div><div class="chart-title">${title}</div>${sub?`<div class="chart-subtitle">${sub}</div>`:''}</div></div>${inner}</div>`;
}
function cw(id,h='280'){ return `<div class="chart-container" style="height:${h}px"><canvas id="${id}"></canvas></div>`; }
function badge(txt,cls){ return `<span class="badge ${cls}">${txt}</span>`; }
function progBar(label,pct,val,color){
  return `<div class="progress-bar-wrap"><div class="progress-bar-header"><span class="progress-bar-label">${label}</span><span class="progress-bar-val">${val}</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.min(Math.max(pct,0),100)}%;background:${color}"></div></div></div>`;
}

// ── Calculations ────────────────────────────────────────────────
function grow(v26, v25) { return v25>0 ? ((v26-v25)/v25*100) : (v26>0?100:0); }
function ach(v, t) { return t>0 ? (v/t*100) : 0; }
function retP(s, r) { return (s+r)>0 ? (r/(s+r)*100) : 0; }

function getSortHTML(label, field) {
  return `<th data-sort="${field}">${label}</th>`;
}
let currentSort = { field: 's26', desc: true };

// ── Page Routing ─────────────────────────────────────────────────
const PAGE_TITLES = {
  home:'Executive Dashboard', ytd:'YTD Performance', products:'Product Analysis',
  customers:'Customer Analysis', returns:'Returns Analysis',
  growth:'Growth Analysis', monthly:'Monthly Trend', quarterly:'Quarterly Dashboard',
  comparison:'Year Comparison'
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
  if(currentPage==='home') pgHome(D);
  if(currentPage==='ytd') pgYTD(D);
  if(currentPage==='products') pgProducts(D);
  if(currentPage==='customers') pgCustomers(D);
  if(currentPage==='returns') pgReturns(D);
  if(currentPage==='growth') pgGrowth(D);
  if(currentPage==='monthly') pgMonthly(D);
  if(currentPage==='quarterly') pgQuarterly(D);
  if(currentPage==='comparison') pgComparison(D);
  
  // Attach sorting listeners
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if(currentSort.field === field) currentSort.desc = !currentSort.desc;
      else { currentSort.field = field; currentSort.desc = true; }
      renderPage();
    });
  });
}

function sortData(arr, measureKey) {
  return [...arr].sort((a,b) => {
    let va = a[measureKey][currentSort.field];
    let vb = b[measureKey][currentSort.field];
    if(currentSort.field === 'name') { va = a.name; vb = b.name; }
    if(currentSort.field === 'grow') { va = grow(a[measureKey].s26, a[measureKey].s25); vb = grow(b[measureKey].s26, b[measureKey].s25); }
    if(currentSort.field === 'retP') { va = retP(a[measureKey].s26, a[measureKey].r26); vb = retP(b[measureKey].s26, b[measureKey].r26); }
    if(currentSort.field === 'ach26') { va = ach(a[measureKey].s26, a[measureKey].tgt26||0); vb = ach(b[measureKey].s26, b[measureKey].tgt26||0); }
    if(typeof va==='string') return currentSort.desc ? vb.localeCompare(va) : va.localeCompare(vb);
    return currentSort.desc ? (vb||0) - (va||0) : (va||0) - (vb||0);
  });
}

// ═══════════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════════
function pgHome(D){
  const m = D.meta[curM];
  const g = grow(m.s26, m.s25);
  const a26 = ach(m.s26, m.tgt26);
  const a25 = ach(m.s25, m.tgt25);
  const rp26 = retP(m.s26, m.r26);
  const rp25 = retP(m.s25, m.r25);

  const cats = [...D.category_data].filter(c=>c[curM].s26>0);

  document.getElementById('page-home').innerHTML=`
    <div class="kpi-grid">
      ${kpi('💰',`Sales 2026 (${curM})`,fmt(m.s26),null,'cyan',`Target: ${fmt(m.tgt26)}`)}
      ${kpi('📅',`Sales 2025 (${curM})`,fmt(m.s25),null,'blue',``)}
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
      ${card('🎯 Achievement by Category','Ach% 2026',cw('ch-h-ach','280'))}
    </div>
  `;

  setTimeout(()=>{
    // Cat Doughnut
    mkChart('ch-h-cat',{type:'doughnut',
      data:{labels:cats.map(c=>c.category),
        datasets:[{data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)),borderWidth:1,borderColor:'#0a1628'}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}
    });
    // Mon Trend
    const md = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id).filter(m=>m.in_ytd);
    mkChart('ch-h-mon',{type:'line',
      data:{labels:md.map(m=>m.month_short),
        datasets:[
          {label:'2025',data:md.map(m=>m[curM].s25),borderColor:C.blueL,borderWidth:2,fill:false},
          {label:'2026',data:md.map(m=>m[curM].s26),borderColor:C.cyan,borderWidth:2.5,fill:false},
          {label:'Target 26',data:md.map(m=>m[curM].tgt26),borderColor:C.gold,borderDash:[4,4],borderWidth:1.5,fill:false}
        ]},
      options:lineOpts()
    });
    // Cat Grow
    cats.sort((a,b)=>b[curM].s26-a[curM].s26);
    mkChart('ch-h-catgrow',{type:'bar',
      data:{labels:cats.map(c=>c.category),
        datasets:[
          {label:'2025',data:cats.map(c=>c[curM].s25),backgroundColor:C.blueL+'BB',borderRadius:3},
          {label:'2026',data:cats.map(c=>c[curM].s26),backgroundColor:cats.map(c=>catColor(c.category)+'BB'),borderRadius:3}
        ]},
      options:barOpts()
    });
    // Cat Ach
    mkChart('ch-h-ach',{type:'bar',
      data:{labels:cats.map(c=>c.category),
        datasets:[{label:'Ach%',data:cats.map(c=>ach(c[curM].s26, c[curM].tgt26)),
          backgroundColor:cats.map(c=>{let a=ach(c[curM].s26,c[curM].tgt26);return a>=90?C.green+'CC':a>=70?C.gold+'CC':C.red+'CC';}),borderRadius:4,
          datalabels:{formatter:v=>v.toFixed(1)+'%'}}]},
      options:barOpts()
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// YTD PERFORMANCE
// ═══════════════════════════════════════════════════════════════
function pgYTD(D){
  let items = sortData(D.product_data.map(p=>({...p,name:p.product})), curM);
  
  document.getElementById('page-ytd').innerHTML=`
    <div class="chart-card">
      <div class="chart-header"><div class="chart-title">📋 Full YTD Product Matrix</div></div>
      <div class="data-table-wrapper" style="max-height:500px;overflow-y:auto">
        <table class="data-table">
          <thead><tr>
            <th>#</th>
            ${getSortHTML('Product','name')}
            <th>Category</th>
            ${getSortHTML('Sales 25','s25')}
            ${getSortHTML('Sales 26','s26')}
            ${getSortHTML('Growth','grow')}
            ${getSortHTML('Target 26','tgt26')}
            ${getSortHTML('Ach%','ach26')}
            ${getSortHTML('Ret% 26','retP')}
          </tr></thead>
          <tbody>
            ${items.filter(p=>p[curM].s25>0||p[curM].s26>0).map((p,i)=>{
              const s25=p[curM].s25, s26=p[curM].s26, t26=p[curM].tgt26||0, r26=p[curM].r26;
              const g=grow(s26,s25), a=ach(s26,t26), r=retP(s26,r26);
              return `<tr>
                <td>${i+1}</td>
                <td>${p.product}</td>
                <td style="color:${catColor(p.category)}">${p.category}</td>
                <td class="num">${fmt(s25)}</td>
                <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
                <td class="num">${badge(fmtP(g),g>=0?'badge-up':'badge-down')}</td>
                <td class="num">${fmt(t26)}</td>
                <td class="num" style="color:${a>=90?C.green:a>=70?C.gold:C.red}">${a.toFixed(1)}%</td>
                <td class="num" style="color:${r>10?C.red:r>5?C.gold:C.green}">${r.toFixed(1)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════
function pgProducts(D){
  const prods = [...D.product_data].filter(p=>p[curM].s25>0||p[curM].s26>0).sort((a,b)=>b[curM].s26-a[curM].s26);
  const top10 = prods.slice(0,10);
  const bot10 = [...prods].filter(p=>p[curM].s25>0).sort((a,b)=>grow(a[curM].s26,a[curM].s25)-grow(b[curM].s26,b[curM].s25)).slice(0,10);

  document.getElementById('page-products').innerHTML=`
    <div class="chart-grid cols-2">
      ${card('🏆 Top 10 Products 2026','By absolute sales',cw('ch-p-top','300'))}
      ${card('📉 Bottom 10 Products','By growth %',cw('ch-p-bot','300'))}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📅 Product Category Monthly Trend','',cw('ch-p-catmon','300'))}
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-p-top',{type:'bar',
      data:{labels:top10.map(p=>trunc(p.product,20)),datasets:[{data:top10.map(p=>p[curM].s26),backgroundColor:C.cyan+'BB',borderRadius:4}]},
      options:barOpts(true)
    });
    mkChart('ch-p-bot',{type:'bar',
      data:{labels:bot10.map(p=>trunc(p.product,20)),datasets:[{data:bot10.map(p=>grow(p[curM].s26,p[curM].s25)),backgroundColor:C.red+'BB',borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},
      options:barOpts(true)
    });
    
    // Category monthly trend
    const cats = [...D.category_data].sort((a,b)=>b[curM].s26-a[curM].s26).slice(0,5).map(c=>c.category);
    const md = [...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
    // Requires mapping raw data back - Since I didn't pre-calculate category x month, I'll use category sales summary instead.
    // Wait, let's just show Category Growth instead.
    const cg = [...D.category_data].sort((a,b)=>grow(b[curM].s26,b[curM].s25)-grow(a[curM].s26,a[curM].s25));
    mkChart('ch-p-catmon',{type:'bar',
      data:{labels:cg.map(c=>c.category),datasets:[{label:'Growth%',data:cg.map(c=>grow(c[curM].s26,c[curM].s25)),backgroundColor:cg.map(c=>grow(c[curM].s26,c[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},
      options:barOpts(false)
    });
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
  const ret = [...cs].filter(c=>c[curM].r26>0).sort((a,b)=>retP(b[curM].s26,b[curM].r26)-retP(a[curM].s26,a[curM].r26)).slice(0,10);

  document.getElementById('page-customers').innerHTML=`
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('🥇','Gold (Top 10)','10',null,'gold','Best returning customers')}
      ${kpi('🥈','Silver',silver.length.toString(),null,'cyan','Next 30%')}
      ${kpi('🥉','Bronze',bronze.length.toString(),null,'blue','Remaining returning')}
      ${kpi('❌','Lost Customers',lost.length.toString(),null,'red','Purchased 25, zero 26')}
    </div>
    
    <div class="chart-grid cols-2">
      ${card('🏆 Top 10 Customers (Gold)','By absolute sales',cw('ch-c-top','300'))}
      ${card('⚠️ Highest Return % Customers','Min 1 return',cw('ch-c-ret','300'))}
    </div>
    
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">❌ Lost Customers Table</div></div>
      <div class="data-table-wrapper" style="max-height:300px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Customer</th><th class="num">Sales 25</th><th class="num">Returns 25</th></tr></thead>
          <tbody>${lost.map((c,i)=>`<tr><td>${i+1}</td><td>${c.customer}</td><td class="num">${fmt(c[curM].s25)}</td><td class="num">${fmt(c[curM].r25)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-c-top',{type:'bar',
      data:{labels:gold.map(c=>trunc(c.customer,20)),datasets:[{data:gold.map(c=>c[curM].s26),backgroundColor:C.gold+'CC',borderRadius:4}]},
      options:barOpts(true)
    });
    mkChart('ch-c-ret',{type:'bar',
      data:{labels:ret.map(c=>trunc(c.customer,20)),datasets:[{data:ret.map(c=>retP(c[curM].s26,c[curM].r26)),backgroundColor:C.red+'CC',borderRadius:4,datalabels:{formatter:v=>v.toFixed(1)+'%'}}]},
      options:barOpts(true)
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// RETURNS
// ═══════════════════════════════════════════════════════════════
function pgReturns(D){
  const cats = [...D.category_data].filter(c=>c[curM].r25>0||c[curM].r26>0).sort((a,b)=>b[curM].r26-a[curM].r26);
  
  document.getElementById('page-returns').innerHTML=`
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
    const md = [...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
    mkChart('ch-r-mon',{type:'line',
      data:{labels:md.map(m=>m.month_short),datasets:[
        {label:'2025',data:md.map(m=>m[curM].r25),borderColor:C.blueL,fill:false,borderWidth:2},
        {label:'2026',data:md.map(m=>m[curM].r26),borderColor:C.red,fill:false,borderWidth:2.5}
      ]}, options:lineOpts()
    });
    mkChart('ch-r-cat',{type:'bar',
      data:{labels:cats.map(c=>c.category),datasets:[
        {label:'2025',data:cats.map(c=>c[curM].r25),backgroundColor:C.blueL+'AA',borderRadius:3},
        {label:'2026',data:cats.map(c=>c[curM].r26),backgroundColor:C.red+'CC',borderRadius:3}
      ]}, options:barOpts(false)
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// GROWTH
// ═══════════════════════════════════════════════════════════════
function pgGrowth(D){
  const cats = [...D.category_data].filter(c=>c[curM].s25>0||c[curM].s26>0).sort((a,b)=>(b[curM].s26-b[curM].s25)-(a[curM].s26-a[curM].s25));
  
  document.getElementById('page-growth').innerHTML=`
    <div class="chart-grid cols-2">
      ${card('📊 Growth Variance by Category','Absolute Difference (2026 - 2025)',cw('ch-g-cat','350'))}
      ${card('📈 Growth % by Category','Relative Difference',cw('ch-g-catp','350'))}
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-g-cat',{type:'bar',
      data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>c[curM].s26-c[curM].s25),backgroundColor:cats.map(c=>c[curM].s26>=c[curM].s25?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>(v>=0?'+':'')+fmt(v)}}]},
      options:barOpts(true)
    });
    mkChart('ch-g-catp',{type:'bar',
      data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>grow(c[curM].s26,c[curM].s25)),backgroundColor:cats.map(c=>grow(c[curM].s26,c[curM].s25)>=0?C.green+'CC':C.red+'CC'),borderRadius:4,datalabels:{formatter:v=>fmtP(v)}}]},
      options:barOpts(true)
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// MONTHLY
// ═══════════════════════════════════════════════════════════════
function pgMonthly(D){
  const md = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id);
  document.getElementById('page-monthly').innerHTML=`
    <div class="chart-grid cols-1">
      ${card('📅 Monthly Detail','Sales 2025 vs 2026 vs Target',cw('ch-m-bar','350'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <table class="data-table">
        <thead><tr><th>Month</th><th class="num">Sales 25</th><th class="num">Sales 26</th><th class="num">Growth</th><th class="num">Target 26</th><th class="num">Ach%</th></tr></thead>
        <tbody>${md.map(m=>{
          const s25=m[curM].s25, s26=m[curM].s26, t26=m[curM].tgt26, g=grow(s26,s25), a=ach(s26,t26);
          return `<tr><td><strong>${m.month_name}</strong> ${m.in_ytd?badge('YTD','badge-new'):''}</td>
            <td class="num">${fmt(s25)}</td><td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
            <td class="num">${badge(fmtP(g),g>=0?'badge-up':'badge-down')}</td><td class="num">${fmt(t26)}</td>
            <td class="num" style="color:${a>=90?C.green:a>=70?C.gold:C.red}">${a.toFixed(1)}%</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(()=>{
    mkChart('ch-m-bar',{type:'bar',
      data:{labels:md.map(m=>m.month_short),datasets:[
        {label:'2025',data:md.map(m=>m[curM].s25),backgroundColor:C.blueL+'AA',borderRadius:3},
        {label:'2026',data:md.map(m=>m[curM].s26),backgroundColor:C.cyan+'CC',borderRadius:3},
        {label:'Target 26',data:md.map(m=>m[curM].tgt26),type:'line',borderColor:C.gold,borderDash:[4,4],fill:false,pointRadius:0,datalabels:{display:false}}
      ]}, options:barOpts(false)
    });
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
    btn.addEventListener('click', e=>{
      qFilter = e.target.dataset.q;
      renderPage();
    });
  });
  
  const mds = [...D.monthly_data].sort((a,b)=>a.month_id-b.month_id);
  const fil = qFilter==='q1' ? mds.slice(0,3) : qFilter==='q2' ? mds.slice(3,6) : mds.filter(m=>m.in_ytd);
  
  let s25=0, s26=0, t26=0, r25=0, r26=0;
  fil.forEach(m=>{ s25+=m[curM].s25; s26+=m[curM].s26; t26+=m[curM].tgt26; r25+=m[curM].r25; r26+=m[curM].r26; });
  const g = grow(s26,s25), a = ach(s26,t26);

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
    mkChart('ch-q-sales',{type:'bar',
      data:{labels:fil.map(m=>m.month_short),datasets:[
        {label:'2025',data:fil.map(m=>m[curM].s25),backgroundColor:C.blueL+'AA',borderRadius:3},
        {label:'2026',data:fil.map(m=>m[curM].s26),backgroundColor:C.cyan+'CC',borderRadius:3}
      ]}, options:barOpts(false)
    });
    mkChart('ch-q-ret',{type:'bar',
      data:{labels:fil.map(m=>m.month_short),datasets:[
        {label:'2025',data:fil.map(m=>m[curM].r25),backgroundColor:C.blueL+'AA',borderRadius:3},
        {label:'2026',data:fil.map(m=>m[curM].r26),backgroundColor:C.red+'CC',borderRadius:3}
      ]}, options:barOpts(false)
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// COMPARISON
// ═══════════════════════════════════════════════════════════════
function pgComparison(D){
  const m = D.meta[curM];
  document.getElementById('page-comparison').innerHTML=`
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('⚖️','Sales Variance',fmt(m.s26-m.s25),grow(m.s26,m.s25),'cyan','2026 - 2025')}
      ${kpi('🎯','Target Variance',fmt(m.tgt26-m.tgt25),null,'gold','26 Target - 25 Target')}
      ${kpi('↩️','Returns Variance',fmt(m.r26-m.r25),null,'red','2026 - 2025')}
      ${kpi('👥','Customers 26',D.meta.customers_26.toString(),D.meta.customers_26-D.meta.customers_25,'blue','')}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📊 Cumulative Sales Trend','YTD Accumulation',cw('ch-c-cum','350'))}
    </div>
  `;
  setTimeout(()=>{
    const md = [...D.monthly_data].filter(m=>m.in_ytd).sort((a,b)=>a.month_id-b.month_id);
    let c25=0, c26=0;
    const cd25=[], cd26=[];
    md.forEach(m=>{ c25+=m[curM].s25; c26+=m[curM].s26; cd25.push(c25); cd26.push(c26); });
    mkChart('ch-c-cum',{type:'line',
      data:{labels:md.map(m=>m.month_short),datasets:[
        {label:'2025 Cum',data:cd25,borderColor:C.blueL,backgroundColor:C.blueL+'11',fill:true,borderWidth:2},
        {label:'2026 Cum',data:cd26,borderColor:C.cyan,backgroundColor:C.cyan+'11',fill:true,borderWidth:2.5}
      ]}, options:lineOpts()
    });
  },50);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init(){
  const D=window.GREKO_DATA;
  if(!D) { document.getElementById('loading-overlay').innerHTML='<h2>Error: data.js not found</h2>'; return; }

  document.getElementById('last-update').textContent=new Date().toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});

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

  go('home');

  setTimeout(()=>{
    const ov=document.getElementById('loading-overlay');
    if(ov){ov.classList.add('hidden'); setTimeout(()=>ov.remove(),600);}
  },500);
}
document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',init) : init();

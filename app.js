// ---- Tonneklinker app v60 ----

// Auto-detect base URL (no hardcoding needed)
(function(){ const link = document.querySelector('link[rel="stylesheet"]');
  if(link && !link.href.includes('v=')) link.href += (link.href.includes('?')?'&':'?')+'v=60';
})();

// Local settings
const S = {
  get base(){ return localStorage.getItem('tk_base') || ''; },
  set base(v){ localStorage.setItem('tk_base', v); },
  get token(){ return localStorage.getItem('tk_token') || ''; },
  set token(v){ localStorage.setItem('tk_token', v); },
  get wines(){ return localStorage.getItem('tk_wines') || 'Wines'; },
  set wines(v){ localStorage.setItem('tk_wines', v); },
  get inv(){ return localStorage.getItem('tk_inv') || 'Inventory'; },
  set inv(v){ localStorage.setItem('tk_inv', v); },
  get loc(){ return localStorage.getItem('tk_loc') || 'Locations'; },
  set loc(v){ localStorage.setItem('tk_loc', v); }
};

const q = sel => document.querySelector(sel);
const byId = id => document.getElementById(id);
const H = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

// Load UI settings
document.addEventListener('DOMContentLoaded', () => {
  const set = (id,val)=>{ const el=byId(id); if(el) el.value=val; };
  set('airtableBase', S.base);
  set('airtableToken', S.token);
  set('winesTable', S.wines);
  set('inventoryTable', S.inv);
  set('locationsTable', S.loc);

  byId('btn-save').addEventListener('click', () => {
    S.base = byId('airtableBase').value.trim();
    S.token = byId('airtableToken').value.trim();
    S.wines = byId('winesTable').value.trim() || 'Wines';
    S.inv   = byId('inventoryTable').value.trim() || 'Inventory';
    S.loc   = byId('locationsTable').value.trim() || 'Locations';
    const ok = byId('save-ok');
    if(ok){ ok.style.display='inline-flex'; setTimeout(()=>ok.style.display='none', 1200); }
    // reload cellar map with new settings
    buildCellarMap();
  });

  byId('btn-search').addEventListener('click', search);
  byId('q').addEventListener('keydown', e => { if(e.key==='Enter') search(); });

  // Initial map
  buildCellarMap();
});

// ---- Utilities ----
function escAT(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
function baseURL(table){ return `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}`; }

// ---- Search ----
let _abort;
async function search(){
  const term = (byId('q').value||'').trim();
  const out = byId('results');
  if(!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if(!term){ out.innerHTML=''; return; }

  try{ _abort?.abort(); }catch{} _abort = new AbortController();

  // AND-only, server first
  const fields = ["Name","Vintage","Country","Region","Producer","Grape","Taste","Food Pairing","Drinkable from","Drinkable to","Price (€)","Label Image"];
  const within = `CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Producer},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})`;
  const pieces = term.split(/\s+/).filter(Boolean).map(t => `SEARCH('${escAT(t)}', ${within})>0`);
  const formula = pieces.length? `AND(${pieces.join(',')})` : '1=1';
  const url = `${baseURL(S.wines)}?${fields.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&')}&filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  let data;
  try{
    const r = await fetch(url, { headers:H(), signal:_abort.signal });
    data = await r.json();
    if(!Array.isArray(data.records) || data.records.length===0) throw new Error('fallback');
    out.innerHTML = renderSearchCards(data.records);
  }catch{
    // client fallback (accent-insensitive AND)
    const r2 = await fetch(`${baseURL(S.wines)}?maxRecords=200`, { headers:H(), signal:_abort.signal });
    const d2 = await r2.json();
    const needle = term.split(/\s+/).map(norm);
    const rows = (d2.records||[]).filter(rec=>{
      const f = rec.fields||{};
      const hay = norm([f.Name,f.Vintage,f.Country,f.Region,f.Producer,f.Grape,f.Taste,f['Food Pairing'],f['Drinkable from'],f['Drinkable to']].filter(Boolean).join(' '));
      return needle.every(t => hay.includes(t));
    });
    out.innerHTML = rows.length? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  }
}

function chip(text, cls=''){ return text?`<span class="badge ${cls}">${text}</span>`:''; }
function fmtWindow(a,b){ if(!a && !b) return ''; if(a&&b) return `${a} – ${b}`; return a? `from ${a}`:`until ${b}`; }
function fmtPrice(p){ if(p==null||p==='') return ''; const n=Number(String(p).replace(',','.')); return isFinite(n)? `€ ${n.toFixed(2)}`: String(p); }

function renderSearchCards(records){
  const out = records.map(rec=>{
    const f = rec.fields||{};
    const labelUrl = Array.isArray(f['Label Image']) ? f['Label Image'][0]?.url : (f['Label Image']?.url||'');
    const labelImg = labelUrl? `<img class="label-img" src="${labelUrl}" alt="label">`:'';

    const chips = [
      chip([f.Country,f.Region].filter(Boolean).join(' – '),'chip-country'),
      chip(f.Producer,'chip-producer'),
      chip(f.Grape,'chip-grape'),
    ].join(' ');

    const body = [
      f.Taste? `<div class="badge chip-taste">${f.Taste}</div>`:'',
      f['Food Pairing']? `<div class="badge">🍽️ ${f['Food Pairing']}</div>`:''
    ].join('');

    const bottom = [
      fmtWindow(f['Drinkable from'], f['Drinkable to'])? `<span class="badge">⏱️ ${fmtWindow(f['Drinkable from'], f['Drinkable to'])}</span>`:'',
      f['Price (€)']!=null && f['Price (€)']!==''? `<span class="badge">💶 ${fmtPrice(f['Price (€)'])}</span>`:'',
      `<span class="badge cellar-chip" data-wine="${rec.id}">📍 cellar</span>`
    ].join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info" style="flex:1; position:relative">
          <b>${f.Name||''}</b>${f.Vintage?` — ${f.Vintage}`:''}
          <div class="meta" style="margin-top:6px">${chips}</div>
          <p style="margin:10px 0 8px">${body}</p>
          <div class="meta">${bottom}</div>
        </div>
      </div>`;
  }).join('');

  // attach tooltip listeners after render
  queueMicrotask(()=> bindCellarChips(records.map(r=>r.id)));
  return out || '<p class="badge">No matches.</p>';
}

// ---- Tooltip + highlight integration ----
let locationIndex = null; // wineId -> [{rack,row,col,qty,name}]
let cellIndex = null;     // "Rack|Row|Col" -> cell element

async function bindCellarChips(wineIds){
  // ensure index loaded
  if(!locationIndex) await buildLocationIndex();

  document.querySelectorAll('.cellar-chip').forEach(el=>{
    const wineId = el.getAttribute('data-wine');
    const locs = locationIndex[wineId] || [];
    el.addEventListener('mouseenter', (ev)=> showTooltip(ev.currentTarget, locs));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click', (ev)=> showTooltip(ev.currentTarget, locs, true));
  });
}

let tip;
function showTooltip(target, locs, click=false){
  hideTooltip();
  tip = document.createElement('div');
  tip.className = 'tooltip';
  if(locs.length===0){
    tip.textContent = 'No cellar location found.';
  }else{
    tip.innerHTML = locs.map(l =>
      `<div class="line" data-key="${l.key}">
        Rack ${l.rack} · Row ${l.row} · Col ${l.col} — Qty: ${l.qty}
      </div>`
    ).join('');
    // hover highlight
    tip.querySelectorAll('.line').forEach(line=>{
      line.addEventListener('mouseenter', ()=>{
        const k = line.getAttribute('data-key');
        const cell = cellIndex[k]; if(!cell) return;
        cell.classList.add('highlight');
      });
      line.addEventListener('mouseleave', ()=>{
        const k = line.getAttribute('data-key');
        const cell = cellIndex[k]; if(!cell) return;
        cell.classList.remove('highlight');
      });
      line.addEventListener('click', ()=>{
        const k = line.getAttribute('data-key');
        const cell = cellIndex[k]; if(!cell) return;
        cell.scrollIntoView({behavior:'smooth', block:'center'});
        cell.classList.add('blink');
        setTimeout(()=>cell.classList.remove('blink'), 1600);
      });
    });
  }
  document.body.appendChild(tip);
  const r = target.getBoundingClientRect();
  tip.style.left = (r.left + r.width/2) + 'px';
  tip.style.top  = (r.bottom + window.scrollY) + 'px';
  if(click){ // keep visible on click
    tip.style.pointerEvents = 'auto';
  }
}
function hideTooltip(){ if(tip){ tip.remove(); tip=null; } }

// ---- Cellar map (dynamic from Locations & Inventory) ----
async function buildLocationIndex(){
  locationIndex = {}; // wineId -> list
  if(!S.base || !S.token) return;

  // pull Inventory (wine + location + qty)
  let records = [];
  let offset = '';
  do{
    const url = `${baseURL(S.inv)}?fields[]=Wine%20(Link%20to%20Wines)&fields[]=Location%20(Link%20to%20Locations)&fields[]=Quantity${offset?`&offset=${offset}`:''}`;
    const r = await fetch(url, { headers:H() });
    const d = await r.json();
    records = records.concat(d.records||[]);
    offset = d.offset || '';
  }while(offset);

  // also load Locations rows we need for rack/row/col
  const locIds = new Set();
  for(const rec of records){
    (rec.fields['Location (Link to Locations)']||[]).forEach(id => locIds.add(id));
  }
  const locMap = await fetchLocationMap(Array.from(locIds)); // id -> {rack,row,col}
  // build
  for(const rec of records){
    const wineArr = rec.fields['Wine (Link to Wines)']||[];
    const locArr  = rec.fields['Location (Link to Locations)']||[];
    const qty     = Number(rec.fields['Quantity']||0);
    for(const wid of wineArr){
      for(const lid of locArr){
        const l = locMap[lid]; if(!l) continue;
        const key = `${l.rack}|${l.row}|${l.col}`;
        (locationIndex[wid] ||= []).push({ ...l, qty, key });
      }
    }
  }
}

async function fetchLocationMap(ids){
  const map = {};
  if(ids.length===0) return map;
  for(let i=0;i<ids.length;i+=50){
    const chunk = ids.slice(i,i+50);
    const formula = `OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const url = `${baseURL(S.loc)}?fields[]=Rack&fields[]=Row&fields[]=Column&filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
    const r = await fetch(url, { headers:H() }); const d = await r.json();
    (d.records||[]).forEach(rec=>{
      const f = rec.fields||{};
      map[rec.id] = { rack:String(f.Rack||'1'), row: Number(f.Row||1), col: Number(f.Column||1) };
    });
  }
  return map;
}

async function buildCellarMap(){
  const host = byId('cellar-map');
  host.innerHTML = '<p class="badge">Loading…</p>';
  if(!S.base || !S.token){ host.innerHTML = '<p class="badge">Add Base ID and Token, then Save.</p>'; return; }

  // Load ALL locations (for shape) and ALL inventory (for occupancy)
  const [locs, inv] = await Promise.all([loadAllLocations(), loadAllInventory()]);

  // Group locations by rack; also compute max row/col per rack
  const byRack = new Map();
  for(const L of locs){
    const rack = String(L.rack||'1');
    const list = byRack.get(rack) || [];
    list.push(L);
    byRack.set(rack, list);
  }
  // occupancy: set of keys
  const full = new Set();
  for(const item of inv){
    if(item.qty>0 && item.rack && item.row && item.col){
      full.add(`${item.rack}|${item.row}|${item.col}`);
    }
  }

  // Build DOM
  cellIndex = {};
  const frag = document.createDocumentFragment();

  for(const [rack, list] of byRack.entries()){
    const maxRow = Math.max(...list.map(l=>Number(l.row||1)));
    const maxCol = Math.max(...list.map(l=>Number(l.col||1)));

    const title = document.createElement('div');
    title.className='rack-title';
    title.textContent = `Rack ${rack}`;
    frag.appendChild(title);

    const grid = document.createElement('div');
    grid.className='rack-grid';
    grid.style.gridTemplateColumns = `repeat(${maxCol}, minmax(70px,1fr))`;

    for(let r=1;r<=maxRow;r++){
      for(let c=1;c<=maxCol;c++){
        const cell = document.createElement('div');
        cell.className='cell';
        cell.textContent = `${r}-${c}`;
        const key = `${rack}|${r}|${c}`;
        if(full.has(key)) cell.classList.add('has');
        cell.dataset.key = key;
        cell.addEventListener('click', ()=> showWinesAtCell(rack,r,c));
        grid.appendChild(cell);
        cellIndex[key]=cell;
      }
    }
    frag.appendChild(grid);
  }

  host.innerHTML='';
  host.appendChild(frag);

  // Refresh tooltip index for new cellIndex
  await buildLocationIndex();
}

async function loadAllLocations(){
  const list=[]; let offset='';
  do{
    const url = `${baseURL(S.loc)}?fields[]=Rack&fields[]=Row&fields[]=Column&fields[]=Name${offset?`&offset=${offset}`:''}`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    (d.records||[]).forEach(rec=>{
      const f=rec.fields||{};
      list.push({ id:rec.id, rack:String(f.Rack||'1'), row:Number(f.Row||1), col:Number(f.Column||1), name:f.Name||'' });
    });
    offset = d.offset||'';
  }while(offset);
  return list;
}

async function loadAllInventory(){
  const list=[]; let offset='';
  do{
    const url = `${baseURL(S.inv)}?fields[]=Wine%20(Link%20to%20Wines)&fields[]=Location%20(Link%20to%20Locations)&fields[]=Quantity${offset?`&offset=${offset}`:''}`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    (d.records||[]).forEach(rec=>{
      const f=rec.fields||{};
      const qty = Number(f.Quantity||0);
      const lids = f['Location (Link to Locations)']||[];
      // need rack/row/col; we’ll fill via fetchLocationMap when building tooltip index
      // for occupancy here we only mark after we know loc coords; simplest: skip, use index (buildLocationIndex) to compute full
    });
    offset = d.offset||'';
  }while(offset);

  // For the occupancy we’ll reuse buildLocationIndex (already fetched)
  // To keep it simple: fetch locations & inventory to compute occupancy now:
  // build a quick set by calling buildLocationIndex and merging
  await buildLocationIndex();
  const occ = [];
  Object.values(locationIndex).forEach(arr => arr.forEach(l => occ.push(l)));
  return occ.map(x => ({ rack:x.rack, row:x.row, col:x.col, qty:x.qty }));
}

async function showWinesAtCell(rack,row,col){
  // list wines at that cell (using locationIndex)
  await buildLocationIndex();
  const key = `${rack}|${row}|${col}`;
  const names = [];
  for(const [wid, arr] of Object.entries(locationIndex)){
    for(const l of arr){ if(l.key===key){ names.push(`${l.name||''}`); } }
  }
  alert(`Rack ${rack} · Row ${row} · Column ${col}\n\n` + (names.length? names.join('\n'): '(Empty)'));
}

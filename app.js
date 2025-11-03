// ---- Tonneklinker app v61 ----

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

const q = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const H = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });
const baseURL = (tbl) => `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(tbl)}`;

// Robust text extractor (fixes [object Object])
function getText(val){
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (Array.isArray(val)) return val.map(getText).filter(Boolean).join(', ');
  if (typeof val === 'object'){
    // common AI field shapes
    if ('value' in val) return getText(val.value);
    if ('text' in val) return getText(val.text);
    if ('content' in val) return getText(val.content);
    if ('name' in val) return getText(val.name);
    if ('url' in val) return getText(val.url);
    return Object.values(val).map(getText).filter(Boolean).join(', ');
  }
  return String(val);
}
function escAT(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
function fmtWindow(a,b){ if(!a&&!b) return ''; if(a&&b) return `${a} – ${b}`; return a?`from ${a}`:`until ${b}`; }
function fmtPrice(p){ if(p==null||p==='') return ''; const n=Number(String(p).replace(',','.')); return isFinite(n)? `€ ${n.toFixed(2)}`: String(p); }
function chip(text, cls=''){ return text?`<span class="badge ${cls}">${text}</span>`:''; }

// Global indexes for Cellar integration
let locationIndexByWine = null; // wineId -> [{rack,row,col,qty,key,name}]
let cellToWines = null;         // "Rack|Row|Col" -> [{wineId,name,qty}]
let cellIndex = null;           // key -> DOM element

// SETTINGS UI
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
    buildCellarMap(); // refresh with new settings
  });

  byId('btn-search').addEventListener('click', search);
  byId('q').addEventListener('keydown', e => { if(e.key==='Enter') search(); });

  buildCellarMap(); // initial
});

// ---------- SEARCH ----------
let _abort;
async function search(){
  const term = (byId('q').value||'').trim();
  const out = byId('results');
  if(!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if(!term){ out.innerHTML=''; return; }

  try{ _abort?.abort(); }catch{}; _abort = new AbortController();

  const fields = ["Name","Vintage","Country","Region","Producer","Grape","Taste","Food Pairing","Drinkable from","Drinkable to","Price (€)","Label Image"];
  const within = `CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Producer},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})`;
  const pieces = term.split(/\s+/).filter(Boolean).map(t => `SEARCH('${escAT(t)}', ${within})>0`);
  const formula = pieces.length? `AND(${pieces.join(',')})` : '1=1';
  const url = `${baseURL(S.wines)}?${fields.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&')}&filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, { headers:H(), signal:_abort.signal });
    const data = await r.json();
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }
    throw new Error('fallback');
  }catch{
    // Client fallback (accent-insensitive AND)
    const r2 = await fetch(`${baseURL(S.wines)}?maxRecords=200`, { headers:H(), signal:_abort.signal });
    const d2 = await r2.json();
    const needles = term.split(/\s+/).map(norm);
    const rows = (d2.records||[]).filter(rec=>{
      const f = rec.fields||{};
      const hay = norm([f.Name,f.Vintage,f.Country,f.Region,f.Producer,f.Grape,f.Taste,f['Food Pairing'],f['Drinkable from'],f['Drinkable to']]
        .map(getText).filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });
    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  }
}

function renderSearchCards(records){
  const html = records.map(rec=>{
    const f = rec.fields||{};
    const labelUrl = Array.isArray(f['Label Image']) ? f['Label Image'][0]?.url : (f['Label Image']?.url||'');
    const labelImg = labelUrl? `<img class="label-img" src="${labelUrl}" alt="label">`:'';

    const chips = [
      chip([getText(f.Country),getText(f.Region)].filter(Boolean).join(' – '),'chip-country'),
      chip(getText(f.Producer),'chip-producer'),
      chip(getText(f.Grape),'chip-grape')
    ].join(' ');

    const body = [
      getText(f.Taste)? `<div class="badge chip-taste">${getText(f.Taste)}</div>`:'',
      getText(f['Food Pairing'])? `<div class="badge">🍽️ ${getText(f['Food Pairing'])}</div>`:''
    ].join('');

    const bottom = [
      fmtWindow(getText(f['Drinkable from']), getText(f['Drinkable to']))? `<span class="badge">⏱️ ${fmtWindow(getText(f['Drinkable from']), getText(f['Drinkable to']))}</span>`:'',
      f['Price (€)']!=null && f['Price (€)']!==''? `<span class="badge">💶 ${fmtPrice(getText(f['Price (€)']))}</span>`:'',
      `<span class="badge cellar-chip" data-wine="${rec.id}">📍 cellar</span>`
    ].join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info" style="flex:1; position:relative">
          <b>${getText(f.Name)||''}</b>${getText(f.Vintage)?` — ${getText(f.Vintage)}`:''}
          <div class="meta" style="margin-top:6px">${chips}</div>
          <p style="margin:10px 0 8px">${body}</p>
          <div class="meta">${bottom}</div>
        </div>
      </div>`;
  }).join('');

  queueMicrotask(()=> bindCellarChips(records.map(r=>r.id)));
  return html || '<p class="badge">No matches.</p>';
}

// ---------- Tooltip -> Cell highlight logic ----------
let tooltipEl;
function hideTooltip(){ if(tooltipEl){ tooltipEl.remove(); tooltipEl=null; } }

async function bindCellarChips(wineIds){
  if(!locationIndexByWine) await buildIndexes(); // make sure indexes exist

  document.querySelectorAll('.cellar-chip').forEach(el=>{
    const wid = el.getAttribute('data-wine');
    const locs = locationIndexByWine[wid] || [];

    const show = (sticky=false) => {
      hideTooltip();
      tooltipEl = document.createElement('div');
      tooltipEl.className='tooltip';
      if (locs.length===0){
        tooltipEl.textContent = 'No cellar location found.';
      }else{
        tooltipEl.innerHTML = locs.map(l=>
          `<div class="line" data-key="${l.key}">
             Rack ${l.rack} · Row ${l.row} · Col ${l.col} — Qty: ${l.qty}
           </div>`).join('');
        tooltipEl.querySelectorAll('.line').forEach(line=>{
          line.addEventListener('mouseenter', ()=>{
            const k=line.dataset.key, cell=cellIndex[k]; if(cell) cell.classList.add('highlight');
          });
          line.addEventListener('mouseleave', ()=>{
            const k=line.dataset.key, cell=cellIndex[k]; if(cell) cell.classList.remove('highlight');
          });
          line.addEventListener('click', ()=>{
            const k=line.dataset.key, cell=cellIndex[k]; if(!cell) return;
            cell.scrollIntoView({behavior:'smooth', block:'center'});
            cell.classList.add('blink'); setTimeout(()=>cell.classList.remove('blink'), 1500);
          });
        });
      }
      document.body.appendChild(tooltipEl);
      const r = el.getBoundingClientRect();
      tooltipEl.style.left = (r.left + r.width/2) + 'px';
      tooltipEl.style.top  = (r.bottom + window.scrollY) + 'px';
      tooltipEl.style.pointerEvents = sticky ? 'auto';
    };

    el.addEventListener('mouseenter', ()=> show(false));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click', ()=> show(true));
  });
}

// ---------- Cellar Map ----------
async function buildCellarMap(){
  const host = byId('cellar-map');
  host.innerHTML = '<p class="badge">Loading…</p>';
  if(!S.base || !S.token){ host.innerHTML='<p class="badge">Add Base ID and Token, then Save.</p>'; return; }

  // load all locations to define the grids
  const locs = await loadAllLocations();
  // group by rack and compute dimensions
  const byRack = new Map();
  locs.forEach(L=>{
    const list = byRack.get(L.rack) || [];
    list.push(L); byRack.set(L.rack, list);
  });

  // Build DOM structure
  cellIndex = {};
  const frag = document.createDocumentFragment();

  for (const [rack, list] of byRack.entries()){
    const maxRow = Math.max(...list.map(l=>l.row));
    const maxCol = Math.max(...list.map(l=>l.col));

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
        const key = `${rack}|${r}|${c}`;
        cell.className = 'cell';
        cell.dataset.key = key;
        cell.textContent = `${r}-${c}`;
        cell.addEventListener('click', ()=> showWinesAtCell(rack,r,c));
        grid.appendChild(cell);
        cellIndex[key] = cell;
      }
    }

    frag.appendChild(grid);
  }
  host.innerHTML='';
  host.appendChild(frag);

  // After cells exist, (re)build indexes and paint occupancy
  await buildIndexes();
  paintOccupancy();
}

async function loadAllLocations(){
  const list=[]; let offset='';
  do{
    const url = `${baseURL(S.loc)}?fields[]=Rack&fields[]=Row&fields[]=Column&fields[]=Name${offset?`&offset=${offset}`:''}`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    (d.records||[]).forEach(rec=>{
      const f=rec.fields||{};
      list.push({
        id:rec.id,
        rack:String(getText(f.Rack)||'1'),
        row:Number(getText(f.Row)||1),
        col:Number(getText(f.Column)||1),
        name:getText(f.Name)||''
      });
    });
    offset = d.offset||'';
  }while(offset);
  return list;
}

async function buildIndexes(){
  // load all inventory (wine id, location id, qty)
  const invRows=[]; let offset='';
  do{
    const url = `${baseURL(S.inv)}?fields[]=Wine%20(Link%20to%20Wines)&fields[]=Location%20(Link%20to%20Locations)&fields[]=Quantity${offset?`&offset=${offset}`:''}`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    invRows.push(...(d.records||[]));
    offset = d.offset||'';
  }while(offset);

  // collect IDs we must resolve
  const wineIds = new Set(); const locIds = new Set();
  invRows.forEach(rec=>{
    (rec.fields['Wine (Link to Wines)']||[]).forEach(id=> wineIds.add(id));
    (rec.fields['Location (Link to Locations)']||[]).forEach(id=> locIds.add(id));
  });

  // resolve maps
  const [wineMap, locMap] = await Promise.all([
    fetchWineMap(Array.from(wineIds)),
    fetchLocationMap(Array.from(locIds))
  ]);

  // build indexes
  locationIndexByWine = {};
  cellToWines = {};

  invRows.forEach(rec=>{
    const qty = Number(rec.fields.Quantity||0);
    const wines = rec.fields['Wine (Link to Wines)']||[];
    const locs  = rec.fields['Location (Link to Locations)']||[];
    wines.forEach(wid=>{
      const wName = wineMap[wid] || wid;
      locs.forEach(lid=>{
        const lc = locMap[lid]; if(!lc) return;
        const key = `${lc.rack}|${lc.row}|${lc.col}`;
        (locationIndexByWine[wid] ||= []).push({ ...lc, qty, key, name:wName });
        (cellToWines[key] ||= []).push({ wineId:wid, name:wName, qty });
      });
    });
  });
}

async function fetchWineMap(ids){
  const map={}; if(ids.length===0) return map;
  for(let i=0;i<ids.length;i+=50){
    const chunk=ids.slice(i,i+50);
    const formula = `OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const url = `${baseURL(S.wines)}?fields[]=Name&filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    (d.records||[]).forEach(rec=> map[rec.id]=getText(rec.fields?.Name)||rec.id);
  }
  return map;
}

async function fetchLocationMap(ids){
  const map={}; if(ids.length===0) return map;
  for(let i=0;i<ids.length;i+=50){
    const chunk=ids.slice(i,i+50);
    const formula = `OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const url = `${baseURL(S.loc)}?fields[]=Rack&fields[]=Row&fields[]=Column&filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
    const r = await fetch(url,{headers:H()}); const d=await r.json();
    (d.records||[]).forEach(rec=>{
      const f=rec.fields||{};
      map[rec.id] = {
        rack:String(getText(f.Rack)||'1'),
        row:Number(getText(f.Row)||1),
        col:Number(getText(f.Column)||1)
      };
    });
  }
  return map;
}

function paintOccupancy(){
  if(!cellIndex || !cellToWines) return;
  Object.keys(cellIndex).forEach(k=>{
    const cell = cellIndex[k];
    if((cellToWines[k]||[]).some(x=>Number(x.qty)>0)) cell.classList.add('has');
    else cell.classList.remove('has');
  });
}

async function showWinesAtCell(rack,row,col){
  if(!cellToWines) await buildIndexes();
  const key = `${rack}|${row}|${col}`;
  const list = (cellToWines[key]||[]).map(x => `${x.name} — Qty: ${x.qty}`);
  alert(`Rack ${rack} · Row ${row} · Column ${col}\n\n` + (list.length? list.join('\n'):'(Empty)'));
}

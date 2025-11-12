/* ---------------- Tonneklinker app.js v65 ---------------- */

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
  set loc(v){ localStorage.setItem('tk_loc', v); },
};

const q  = sel => document.querySelector(sel);
const qa = sel => [...document.querySelectorAll(sel)];
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

/* ---------- Field name maps (edit if your Airtable uses other names) ---------- */
const F = {
  INV: {
    wine:     'Wine (Link to Wines)',
    location: 'Location (Link to Locations)',
    qty:      'Quantity',
  },
  LOC: {
    rack:   'Rack',
    row:    'Row',
    col:    'Column',
    name:   'Name',
  },
  // If your price field is literally "Price (€)" change this entry to that string
  WINES_PICK: ['Name','Vintage','Country','Region','Producer','Grape','Taste','Food Pairing','Drinkable from','Drinkable to','Price','Label Image']
};

/* ---------- Utilities ---------- */
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
function escAirtable(s){ return String(s||'').replace(/'/g, "''"); }
function getText(val){
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(getText).join(', ');
  if (val.value) return getText(val.value);
  if (val.text)  return getText(val.text);
  if (val.content) return getText(val.content);
  try { return Object.values(val).map(getText).join(', '); } catch { return String(val); }
}

/* ---------- Global indices (filled after we fetch data) ---------- */
window.cellIndex = {};               // key "rack-row-col" => {rack,row,col,locId,name}
window.locationIndexByWine = {};     // wineId => [{cellKey, rack,row,col,qty,locId}]

/* ---------- Debug helpers ---------- */
function logGroup(title, fn){
  console.groupCollapsed(title);
  try { fn(); } finally { console.groupEnd(); }
}
function info(msg, obj){ console.info(msg, obj ?? ''); }
function warn(msg, obj){ console.warn(msg, obj ?? ''); }
function err (msg, obj){ console.error(msg, obj ?? ''); }

/* ---------- Initial wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // Fill settings inputs if they exist
  const set = (sel, val)=>{ const el=q(sel); if (el) el.value = val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable',   S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  const saveBtn = q('#btn-save');
  if (saveBtn) saveBtn.addEventListener('click', e=>{
    e.preventDefault();
    S.base  = q('#airtableBase')?.value.trim() || S.base;
    S.token = q('#airtableToken')?.value.trim() || S.token;
    S.wines = q('#winesTable')?.value.trim() || S.wines;
    S.inv   = q('#inventoryTable')?.value.trim() || S.inv;
    S.loc   = q('#locationsTable')?.value.trim() || S.loc;
    const ok = q('#save-ok'); if (ok){ ok.style.display='inline-flex'; setTimeout(()=>ok.style.display='none', 1000); }
    refreshData(); // reload data immediately after save
  });

  const btn = q('#btn-search');
  const inp = q('#q');
  if (btn) btn.addEventListener('click', e=>{ e.preventDefault(); search(); });
  if (inp)  inp.addEventListener('keydown', e=>{ if (e.key === 'Enter'){ e.preventDefault(); search(); }});

  // Initial empty map
  renderCellarMap([]);

  // Pull data once we have credentials
  if (S.base && S.token) refreshData();
});

/* -------------------- Data fetch & index build -------------------- */
async function refreshData(){
  if (!S.base || !S.token){
    warn('Missing Base/Token; set them in Settings to enable data.');
    return;
  }

  try{
    const [locations, inventory] = await Promise.all([ fetchLocations(), fetchInventory() ]);
    buildIndices(locations, inventory);
    // Re-render the map with the discovered rack/row/col layout, then paint occupancy
    renderCellarMap(locations);
    paintMapHasBottles();
  }catch(e){
    err('refreshData failed', e);
  }
}

async function fetchLocations(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?` +
    ['fields[]='+encodeURIComponent(F.LOC.rack),
     'fields[]='+encodeURIComponent(F.LOC.row),
     'fields[]='+encodeURIComponent(F.LOC.col),
     'fields[]='+encodeURIComponent(F.LOC.name),
     'maxRecords=500'
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  logGroup('Locations fetched', ()=>{
    info('URL', url);
    info('Count', data.records?.length || 0);
    console.table((data.records||[]).map(rec=>({
      id: rec.id,
      rack: rec.fields?.[F.LOC.rack],
      row:  rec.fields?.[F.LOC.row],
      col:  rec.fields?.[F.LOC.col],
      name: rec.fields?.[F.LOC.name],
    })));
  });

  return (data.records||[]).map(rec=>{
    const f = rec.fields||{};
    const rack = Number(f[F.LOC.rack]) || String(f[F.LOC.rack]||'');
    const row  = Number(f[F.LOC.row])  || String(f[F.LOC.row]||'');
    const col  = Number(f[F.LOC.col])  || String(f[F.LOC.col]||'');
    return {
      id: rec.id,
      rack, row, col,
      name: getText(f[F.LOC.name])
    };
  }).filter(x => x.rack && x.row && x.col);
}

async function fetchInventory(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?` +
    ['fields[]='+encodeURIComponent(F.INV.wine),
     'fields[]='+encodeURIComponent(F.INV.location),
     'fields[]='+encodeURIComponent(F.INV.qty),
     'maxRecords=500'
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  logGroup('Inventory fetched', ()=>{
    info('URL', url);
    info('Count', data.records?.length || 0);
    console.table((data.records||[]).map(rec=>({
      id: rec.id,
      wine: (rec.fields?.[F.INV.wine]||[]).join(','),
      loc:  (rec.fields?.[F.INV.location]||[]).join(','),
      qty:  rec.fields?.[F.INV.qty]
    })));
  });

  return (data.records||[]).map(rec=>{
    const f = rec.fields||{};
    const wineIds = Array.isArray(f[F.INV.wine]) ? f[F.INV.wine] : [];
    const locIds  = Array.isArray(f[F.INV.location]) ? f[F.INV.location] : [];
    const qty     = Number(f[F.INV.qty] ?? 0);
    return { id: rec.id, wineIds, locIds, qty };
  }).filter(r => r.wineIds.length && r.locIds.length);
}

function buildIndices(locations, inventory){
  // cellIndex
  window.cellIndex = {};
  for (const loc of locations){
    const key = `${loc.rack}-${loc.row}-${loc.col}`;
    window.cellIndex[key] = { rack:loc.rack, row:loc.row, col:loc.col, locId:loc.id, name:loc.name };
  }

  // locationIndexByWine
  window.locationIndexByWine = {};
  for (const rec of inventory){
    if (!rec.qty || rec.qty <= 0) continue;
    for (const w of rec.wineIds){
      for (const l of rec.locIds){
        const found = Object.values(window.cellIndex).find(c => c.locId === l);
        if (!found) continue;
        const cellKey = `${found.rack}-${found.row}-${found.col}`;
        (window.locationIndexByWine[w] ||= []).push({
          cellKey, rack:found.rack, row:found.row, col:found.col, qty: rec.qty, locId:l
        });
      }
    }
  }

  logGroup('Index result', ()=>{
    info('cellIndex size', Object.keys(window.cellIndex).length);
    info('locationIndexByWine size', Object.keys(window.locationIndexByWine).length);
  });
}

/* -------------------- Cellar map rendering & paint -------------------- */
function renderCellarMap(/* locations not used directly; uses window.cellIndex */){
  // If we have locations, derive racks/rows/cols from them; else show an empty Rack 1.
  let racks = new Map();
  for (const k of Object.keys(window.cellIndex)){
    const {rack,row,col} = window.cellIndex[k];
    const rr = racks.get(String(rack)) || { rows:new Set(), cols:new Set() };
    rr.rows.add(String(row));
    rr.cols.add(String(col));
    racks.set(String(rack), rr);
  }
  if (racks.size === 0){
    racks.set('1', {rows:new Set(['1','2','3','4','5','6']), cols:new Set(['1','2','3','4','5','6'])});
  }

  const container = q('#cellar-map');
  if (!container) return;
  container.innerHTML = '';

  racks = [...racks.entries()].sort((a,b)=> Number(a[0]) - Number(b[0]));

  for (const [rackId, rc] of racks){
    const rows = [...rc.rows].sort((a,b)=>Number(a)-Number(b));
    const cols = [...rc.cols].sort((a,b)=>Number(a)-Number(b));

    const card = document.createElement('section');
    card.className = 'card';

    const h = document.createElement('h3');
    h.textContent = `Rack ${rackId}`;
    card.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'rack-grid';

    for (const r of rows){
      for (const c of cols){
        const key = `${rackId}-${r}-${c}`;
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.key = key;
        div.textContent = `${r}-${c}`;
        div.addEventListener('click', ()=> showCellWines(key));
        grid.appendChild(div);
      }
    }
    card.appendChild(grid);
    container.appendChild(card);
  }
}

function paintMapHasBottles(){
  // Remove old marks
  qa('.cell.has-bottle').forEach(el => el.classList.remove('has-bottle'));
  // Mark cells that have any qty
  const usedKeys = new Set();
  for (const wineId of Object.keys(window.locationIndexByWine)){
    for (const p of window.locationIndexByWine[wineId]){
      usedKeys.add(p.cellKey);
    }
  }
  usedKeys.forEach(key=>{
    const el = q(`.cell[data-key="${key}"]`);
    if (el) el.classList.add('has-bottle');
  });
}

function showCellWines(cellKey){
  // Build a tiny list of wines for that cell from the reverse mapping
  const winesAtCell = [];
  for (const [wid, arr] of Object.entries(window.locationIndexByWine)){
    for (const pos of arr){
      if (pos.cellKey === cellKey){
        winesAtCell.push({wineId: wid, qty: pos.qty});
      }
    }
  }
  const label = cellKey.replace(/-/g,' · ');
  if (!winesAtCell.length){
    alert(`${label}\n\n(Empty)`);
    return;
  }
  const lines = winesAtCell.map(x => `• ${x.wineId} — Qty: ${x.qty}`);
  alert(`${label}\n\n${lines.join('\n')}`);
}

/* -------------------- Search -------------------- */
let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  try { _searchAbort?.abort(); } catch {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl   = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };

  const pieces = raw.split(/\s+/).filter(Boolean);
  const concat = "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Producer},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const formula = pieces.length ? `AND(${pieces.map(t=>`SEARCH('${escAirtable(t)}', ${concat})>0`).join(',')})` : '1=1';
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&${F.WINES_PICK.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&')}&maxRecords=50`;

  try{
    // 1) Server AND
    const r = await fetch(url, headersObj);
    const data = await r.json();

    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      wireCellarChips();               // <-- enables highlight/blink
      return;
    }

    // 2) Client AND (accent-insensitive)
    const rAll = await fetch(`${baseUrl}?maxRecords=200&${F.WINES_PICK.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&')}`, headersObj);
    const all  = await rAll.json();
    const needles = pieces.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name,f.Vintage,f.Country,f.Region,f.Producer,f.Grape,f.Taste,f['Food Pairing'],f['Drinkable from'],f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });

    q('#results').innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    wireCellarChips();

  }catch(e){
    if (e.name !== 'AbortError'){
      err('search failed', e);
      out.innerHTML = `<p class="badge">Search error: ${e.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

function renderSearchCards(records){
  const html = (records||[]).map(rec=>{
    const f = rec.fields || {};
    const imgUrl = Array.isArray(f['Label Image']) ? f['Label Image'][0]?.url : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const bits = [
      [getText(f.Country), getText(f.Region)].filter(Boolean).join(' – ') || null,
      f.Producer ? `🏷️ ${getText(f.Producer)}` : null,
      f.Grape ? `🍇 ${getText(f.Grape)}` : null,
      f.Taste ? `🍷 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null,
      // cellar chip carries the wine id
      `<span class="badge cellar-chip" data-wine="${rec.id}" title="Show cellar position(s)">📍 cellar</span>`
    ].filter(Boolean);

    const chips = bits.map(x => {
      // avoid double-wrapping the cellar chip badge
      if (typeof x === 'string' && x.includes('cellar-chip')) return x;
      return `<span class="badge">${x}</span>`;
    }).join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">${chips}</div>
        </div>
      </div>`;
  }).join('');
  return html || '<p class="badge">No matches.</p>';
}

/* ---------- Hover/click wiring for “📍 cellar” chip ---------- */
function wireCellarChips(){
  qa('.cellar-chip').forEach(chip=>{
    chip.addEventListener('mouseenter', onCellarHover);
    chip.addEventListener('mouseleave', onCellarLeave);
    chip.addEventListener('click', onCellarClick);
  });
}

function onCellarHover(e){
  const wineId = e.currentTarget.getAttribute('data-wine');
  const pos = window.locationIndexByWine[wineId] || [];
  if (!pos.length){
    console.info('No cellar positions for wine', wineId, {locationIndexByWine: window.locationIndexByWine});
    return;
  }
  pos.forEach(p=>{
    const el = q(`.cell[data-key="${p.cellKey}"]`);
    if (el) el.classList.add('hover-target');
  });
}
function onCellarLeave(){
  qa('.cell.hover-target').forEach(el=> el.classList.remove('hover-target'));
}
function onCellarClick(e){
  const wineId = e.currentTarget.getAttribute('data-wine');
  const pos = window.locationIndexByWine[wineId] || [];
  if (!pos.length){ alert('No cellar location found.'); return; }
  const target = pos[0]; // first position
  const el = q(`.cell[data-key="${target.cellKey}"]`);
  if (el){
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('blink');
    setTimeout(()=> el.classList.remove('blink'), 1500);
  }
}

/* -------------- expose quick console probes -------------- */
window._probe = ()=>{
  console.log('cellIndex size:', Object.keys(window.cellIndex||{}).length);
  console.log('locationIndexByWine size:', Object.keys(window.locationIndexByWine||{}).length);
};

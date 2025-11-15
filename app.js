/* ---------------- Tonneklinker app.js v72 ---------------- */

/* ========== Tiny state helper around localStorage ========== */

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
const headers = () => ({
  'Authorization': 'Bearer ' + S.token,
  'Content-Type': 'application/json'
});

/* ---------- Airtable field names (adjust here if they change) ---------- */

const F = {
  INV: {
    wine:     'Wine (Link to Wines)',
    location: 'Location (Link to Locations)',
    qty:      'Quantity',
  },
  LOC: {
    rack: 'Rack',
    row:  'Row',
    col:  'Column',
    name: 'Name',
  },
  // all fields we show in cards / search
  WINES_PICK: [
    'Name',
    'Vintage',
    'Country',
    'Region',
    'Producer',
    'Grape',
    'Taste',
    'Food Pairing',
    'Drinkable from',
    'Drinkable to',
    'Price',
    'Label Image'
  ]
};

/* -------------------- Helpers -------------------- */

function norm(str){
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function escAirtable(s){
  // escape single quotes for Airtable formulas
  return String(s || '').replace(/'/g, "''");
}

function getText(val){
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val.map(getText).join(', ');
  }
  if (val.value)   return getText(val.value);
  if (val.text)    return getText(val.text);
  if (val.content) return getText(val.content);
  try {
    return Object.values(val).map(getText).join(', ');
  } catch {
    return String(val);
  }
}

/* -------------------- Global indices -------------------- */
// key "rack-row-col" => {rack,row,col,locId,name}
window.cellIndex = {};
// wineId => [ {cellKey,rack,row,col,qty,locId} ]
window.locationIndexByWine = {};
// wineId => { name }
window.wineIndex = {};

/* small logging helpers (optional) */
function logGroup(title, fn){ console.groupCollapsed(title); try{fn();}finally{console.groupEnd();} }
const info = console.info.bind(console);
const warn = console.warn.bind(console);
const err  = console.error.bind(console);

/* -------------------- DOM wiring -------------------- */

document.addEventListener('DOMContentLoaded', () => {
  // fill settings fields
  const set = (sel, val)=>{ const el=q(sel); if (el) el.value = val; };
  set('#airtableBase',  S.base);
  set('#airtableToken', S.token);
  set('#winesTable',    S.wines);
  set('#inventoryTable',S.inv);
  set('#locationsTable',S.loc);

  const saveBtn = q('#btn-save');
  if (saveBtn){
    saveBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      S.base  = q('#airtableBase')?.value.trim()  || S.base;
      S.token = q('#airtableToken')?.value.trim() || S.token;
      S.wines = q('#winesTable')?.value.trim()    || S.wines;
      S.inv   = q('#inventoryTable')?.value.trim()|| S.inv;
      S.loc   = q('#locationsTable')?.value.trim()|| S.loc;

      const badge = q('#save-ok');
      if (badge){
        badge.style.display = 'inline-block';
        setTimeout(()=> badge.style.display='none', 1500);
      }

      refreshData();
    });
  }

  const btn = q('#btn-search');
  const inp = q('#q');
  if (btn) btn.addEventListener('click', (e)=>{ e.preventDefault(); search(); });
  if (inp)  inp.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); search(); } });

  // initial empty map (6x6 Rack 1)
  renderCellarMap([]);

  // load data if we already have credentials stored
  if (S.base && S.token) refreshData();
});

/* -------------------- Data loading -------------------- */

async function refreshData(){
  if (!S.base || !S.token){
    warn('Missing base or token; fill Settings first.');
    return;
  }

  try{
    const [locations, inventory, wines] = await Promise.all([
      fetchLocations(),
      fetchInventory(),
      fetchWines()
    ]);

    buildIndices(locations, inventory);
    paintMapHasBottles();

    logGroup('Index summary', ()=>{
      info('cellIndex size', Object.keys(window.cellIndex).length);
      info('locationIndexByWine size', Object.keys(window.locationIndexByWine).length);
      info('wineIndex size', Object.keys(window.wineIndex).length);
    });
  }catch(e){
    err('refreshData failed', e);
  }
}

/* --- Locations --- */

async function fetchLocations(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?` +
    [
      'fields[]='+encodeURIComponent(F.LOC.rack),
      'fields[]='+encodeURIComponent(F.LOC.row),
      'fields[]='+encodeURIComponent(F.LOC.col),
      'fields[]='+encodeURIComponent(F.LOC.name),
      'maxRecords=500'
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  return (data.records || []).map(rec=>{
    const f = rec.fields || {};
    const rack = f[F.LOC.rack];
    const row  = f[F.LOC.row];
    const col  = f[F.LOC.col];
    return {
      id: rec.id,
      rack: String(rack),
      row:  String(row),
      col:  String(col),
      name: getText(f[F.LOC.name])
    };
  }).filter(x => x.rack && x.row && x.col);
}

/* --- Inventory --- */

async function fetchInventory(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?` +
    [
      'fields[]='+encodeURIComponent(F.INV.wine),
      'fields[]='+encodeURIComponent(F.INV.location),
      'fields[]='+encodeURIComponent(F.INV.qty),
      'maxRecords=500'
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  return (data.records || []).map(rec=>{
    const f = rec.fields || {};
    const wineIds = Array.isArray(f[F.INV.wine]) ? f[F.INV.wine].map(x=>x) : [];
    const locIds  = Array.isArray(f[F.INV.location]) ? f[F.INV.location].map(x=>x) : [];
    const qty     = Number(f[F.INV.qty] ?? 0);
    return { id: rec.id, wineIds, locIds, qty };
  }).filter(r => r.qty > 0 && r.wineIds.length && r.locIds.length);
}

/* --- Wines for name lookup (and later maybe more) --- */

async function fetchWines(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?` +
    ['fields[]='+encodeURIComponent('Name'),'maxRecords=500'].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  window.wineIndex = {};
  for (const rec of (data.records || [])){
    window.wineIndex[rec.id] = { name: getText(rec.fields?.Name) };
  }
  return data.records || [];
}

/* --- Build indices --- */

function buildIndices(locations, inventory){
  window.cellIndex = {};
  for (const loc of locations){
    const key = `${loc.rack}-${loc.row}-${loc.col}`;
    window.cellIndex[key] = {
      rack: loc.rack,
      row:  loc.row,
      col:  loc.col,
      locId: loc.id,
      name: loc.name
    };
  }

  window.locationIndexByWine = {};
  for (const rec of inventory){
    for (const w of rec.wineIds){
      for (const l of rec.locIds){
        const found = Object.values(window.cellIndex).find(c => c.locId === l);
        if (!found) continue;
        const cellKey = `${found.rack}-${found.row}-${found.col}`;
        (window.locationIndexByWine[w] ||= []).push({
          cellKey,
          rack: found.rack,
          row:  found.row,
          col:  found.col,
          qty:  rec.qty,
          locId: l
        });
      }
    }
  }

  // re-render map based on known racks/rows/cols
  renderCellarMap(locations);
}

/* -------------------- Cellar map -------------------- */

function renderCellarMap(locations){
  let racks = new Map();

  for (const loc of locations){
    const id = String(loc.rack);
    const rr = racks.get(id) || { rows:new Set(), cols:new Set() };
    rr.rows.add(String(loc.row));
    rr.cols.add(String(loc.col));
    racks.set(id, rr);
  }

  // default 1 rack 6x6 if nothing yet
  if (racks.size === 0){
    racks.set('1', {rows:new Set(['1','2','3','4','5','6']), cols:new Set(['1','2','3','4','5','6'])});
  }

  const container = q('#cellar-map');
  if (!container) return;
  container.innerHTML = '';

  const orderedRacks = [...racks.entries()].sort((a,b)=>Number(a[0]) - Number(b[0]));

  for (const [rackId, rc] of orderedRacks){
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

  paintMapHasBottles();
}

function paintMapHasBottles(){
  qa('.cell.has-bottle').forEach(el=> el.classList.remove('has-bottle'));

  const usedKeys = new Set();
  for (const arr of Object.values(window.locationIndexByWine)){
    for (const pos of arr){
      usedKeys.add(pos.cellKey);
    }
  }
  usedKeys.forEach(key=>{
    const el = q(`.cell[data-key="${key}"]`);
    if (el) el.classList.add('has-bottle');
  });
}

function showCellWines(cellKey){
  const winesAtCell = [];
  const idx = window.wineIndex || {};

  for (const [wid, arr] of Object.entries(window.locationIndexByWine)){
    for (const pos of arr){
      if (pos.cellKey === cellKey){
        winesAtCell.push({
          wineId: wid,
          qty: pos.qty,
          name: idx[wid]?.name || wid
        });
      }
    }
  }

  const label = cellKey.replace(/-/g, ' · ');
  if (!winesAtCell.length){
    alert(`${label}\n\n(Empty)`);
    return;
  }
  const lines = winesAtCell.map(w => `• ${w.name} — Qty: ${w.qty}`);
  alert(`${label}\n\n${lines.join('\n')}`);
}

/* -------------------- Search (full-field) -------------------- */

let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){
    alert('Set Base ID and Token in Settings first.');
    return;
  }
  if (!out) return;

  if (!raw){
    out.innerHTML = '<p class="badge">No matches.</p>';
    return;
  }

  try { _searchAbort?.abort(); } catch {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const reqOpts = { headers: headers(), signal: _searchAbort.signal };

  const pieces = raw.split(/\s+/).filter(Boolean);

  // CONCATENATE of all searchable fields
  const concat =
    "CONCATENATE(" +
    "{Name},' '," +
    "{Vintage},' '," +
    "{Country},' '," +
    "{Region},' '," +
    "{Producer},' '," +
    "{Grape},' '," +
    "{Taste},' '," +
    "{Food Pairing},' '," +
    "{Drinkable from},' '," +
    "{Drinkable to},' '," +
    "{Price}" +
    ")";

  const formula = pieces.length
    ? "AND(" + pieces.map(t => `SEARCH('${escAirtable(t)}', ${concat})>0`).join(',') + ")"
    : '1=1';

  const fieldsParam = F.WINES_PICK.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&${fieldsParam}&maxRecords=50`;

  try{
    // 1) server-side AND search
    const r = await fetch(url, reqOpts);
    const data = await r.json();

    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      wireCellarChips();
      return;
    }

    // 2) client-side fallback (accent-insensitive) over all fields
    const rAll = await fetch(`${baseUrl}?maxRecords=200&${fieldsParam}`, reqOpts);
    const all  = await rAll.json();
    const needles = pieces.map(norm);

    const rows = (all.records || []).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name,
        f.Vintage,
        f.Country,
        f.Region,
        f.Producer,
        f.Grape,
        f.Taste,
        f['Food Pairing'],
        f['Drinkable from'],
        f['Drinkable to'],
        f.Price
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
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
  if (!records || !records.length){
    return '<p class="badge">No matches.</p>';
  }

  return records.map(rec=>{
    const f = rec.fields || {};

    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const chips = [];

    const countryRegion = [getText(f.Country), getText(f.Region)].filter(Boolean).join(' – ');
    if (countryRegion) chips.push(countryRegion);

    if (f.Producer)      chips.push(`🏷️ ${getText(f.Producer)}`);
    if (f.Grape)         chips.push(`🍇 ${getText(f.Grape)}`);
    if (f.Taste)         chips.push(`🍷 ${getText(f.Taste)}`);
    if (f['Food Pairing']) chips.push(`🍽️ ${getText(f['Food Pairing'])}`);

    if (f['Drinkable from'] || f['Drinkable to']){
      const range = [getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ');
      chips.push(`🕰️ ${range}`);
    }

    if (f.Price !== '' && f.Price != null){
      const price = Number(f.Price);
      chips.push(`💶 € ${price.toFixed(2)}`);
    }

    // cellar chip
    chips.push(`<span class="badge cellar-chip" data-wine="${rec.id}" title="Show cellar position(s)">📍 cellar</span>`);

    const chipsHtml = chips.map(x => x.startsWith('<span') ? x : `<span class="badge">${x}</span>`).join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">${chipsHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- cellar chip hover/click -> highlight / blink ---------- */

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
  if (!pos.length){
    alert('No cellar location found.');
    return;
  }
  const target = pos[0];
  const el = q(`.cell[data-key="${target.cellKey}"]`);
  if (el){
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('blink');
    setTimeout(()=> el.classList.remove('blink'), 1500);
  }
}

/* quick console helper */
window._probe = ()=>{
  console.log('cellIndex size:', Object.keys(window.cellIndex||{}).length);
  console.log('locationIndexByWine size:', Object.keys(window.locationIndexByWine||{}).length);
  console.log('wineIndex size:', Object.keys(window.wineIndex||{}).length);
};

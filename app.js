// ---------------- Tonneklinker app.js v71 ----------------

// --------- settings in localStorage ----------
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

// --------- Airtable field names (adapt only if you rename columns) ---------
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
  // fields we *try* to fetch for search cards; if some don’t exist, that’s ok
  WINES_PICK: [
    'Name','Vintage','Country','Region','Producer','Grape',
    'Taste','Food Pairing','Drinkable from','Drinkable to','Label Image'
  ]
};

// --------- helpers ----------
function norm(s){
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu,'')
    .toLowerCase();
}

function getText(val){
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'){
    return String(val);
  }
  if (Array.isArray(val)) return val.map(getText).join(', ');
  if (val.value)   return getText(val.value);
  if (val.text)    return getText(val.text);
  if (val.content) return getText(val.content);
  try { return Object.values(val).map(getText).join(', '); }
  catch { return String(val); }
}

// --------- global indices ----------
window.cellIndex = {};             // "rack-row-col" -> {rack,row,col,locId,name}
window.locationIndexByWine = {};   // wineId -> [{cellKey,rack,row,col,qty,locId}]

// simple probe for you in console
window._probe = () => {
  console.log('cellIndex size:', Object.keys(window.cellIndex || {}).length);
  console.log('locationIndexByWine size:', Object.keys(window.locationIndexByWine || {}).length);
};

// --------- startup ----------
document.addEventListener('DOMContentLoaded', () => {
  // restore settings
  const set = (sel, val)=>{ const el=q(sel); if (el) el.value = val; };
  set('#airtableBase',  S.base);
  set('#airtableToken', S.token);
  set('#winesTable',    S.wines);
  set('#inventoryTable',S.inv);
  set('#locationsTable',S.loc);

  // save button
  const saveBtn = q('#btn-save');
  if (saveBtn){
    saveBtn.addEventListener('click', e=>{
      e.preventDefault();
      S.base  = q('#airtableBase')?.value.trim() || S.base;
      S.token = q('#airtableToken')?.value.trim() || S.token;
      S.wines = q('#winesTable')?.value.trim() || S.wines;
      S.inv   = q('#inventoryTable')?.value.trim() || S.inv;
      S.loc   = q('#locationsTable')?.value.trim() || S.loc;
      alert('Saved locally.');
      refreshData(); // reload map indices
    });
  }

  // search wiring
  const btn = q('#btn-search');
  const inp = q('#q');
  if (btn) btn.addEventListener('click', e => { e.preventDefault(); search(); });
  if (inp) inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); search(); }
  });

  // initial empty map
  renderCellarMap(null);

  // kick off data load if we already have credentials
  if (S.base && S.token) refreshData();
});

// ===================================================================
//  DATA LOADING & INDICES
// ===================================================================
async function refreshData(){
  if (!S.base || !S.token){
    console.warn('Set Base ID and Token to enable data.');
    return;
  }

  try{
    const [locations, inventory] = await Promise.all([
      fetchLocations(),
      fetchInventory()
    ]);

    // rebuild map & indices
    renderCellarMap(locations);
    buildIndices(locations, inventory);
    paintMapHasBottles();

  }catch(e){
    console.error('refreshData failed', e);
  }
}

async function fetchLocations(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?` +
    [
      'maxRecords=500',
      `fields[]=${encodeURIComponent(F.LOC.rack)}`,
      `fields[]=${encodeURIComponent(F.LOC.row)}`,
      `fields[]=${encodeURIComponent(F.LOC.col)}`,
      `fields[]=${encodeURIComponent(F.LOC.name)}`
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  if (data.error){
    console.error('Locations error:', data.error);
    return [];
  }

  return (data.records || []).map(rec => {
    const f = rec.fields || {};
    const rack = Number(f[F.LOC.rack]) || String(f[F.LOC.rack] || '');
    const row  = Number(f[F.LOC.row])  || String(f[F.LOC.row]  || '');
    const col  = Number(f[F.LOC.col])  || String(f[F.LOC.col]  || '');
    return {
      id: rec.id,
      rack, row, col,
      name: getText(f[F.LOC.name])
    };
  }).filter(x => x.rack && x.row && x.col);
}

async function fetchInventory(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?` +
    [
      'maxRecords=500',
      `fields[]=${encodeURIComponent(F.INV.wine)}`,
      `fields[]=${encodeURIComponent(F.INV.location)}`,
      `fields[]=${encodeURIComponent(F.INV.qty)}`
    ].join('&');

  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  if (data.error){
    console.error('Inventory error:', data.error);
    return [];
  }

  return (data.records || []).map(rec => {
    const f = rec.fields || {};
    const wineIds = Array.isArray(f[F.INV.wine])     ? f[F.INV.wine]     : [];
    const locIds  = Array.isArray(f[F.INV.location]) ? f[F.INV.location] : [];
    const qty     = Number(f[F.INV.qty] ?? 0);
    return { id: rec.id, wineIds, locIds, qty };
  }).filter(r => r.qty > 0 && r.wineIds.length && r.locIds.length);
}

function buildIndices(locations, inventory){
  // cellIndex: key -> location info
  window.cellIndex = {};
  (locations || []).forEach(loc => {
    const key = `${loc.rack}-${loc.row}-${loc.col}`;
    window.cellIndex[key] = {
      rack: loc.rack,
      row:  loc.row,
      col:  loc.col,
      locId: loc.id,
      name: loc.name
    };
  });

  // locationIndexByWine: wineId -> list of positions
  window.locationIndexByWine = {};
  (inventory || []).forEach(rec => {
    rec.wineIds.forEach(wid => {
      rec.locIds.forEach(lid => {
        const found = Object.values(window.cellIndex).find(c => c.locId === lid);
        if (!found) return;
        const cellKey = `${found.rack}-${found.row}-${found.col}`;
        (window.locationIndexByWine[wid] ||= []).push({
          cellKey,
          rack: found.rack,
          row:  found.row,
          col:  found.col,
          qty:  rec.qty,
          locId: lid
        });
      });
    });
  });

  console.log('Indices built:',
    'cellIndex size', Object.keys(window.cellIndex).length,
    'locationIndexByWine size', Object.keys(window.locationIndexByWine).length
  );
}

// ===================================================================
//  CELLAR MAP RENDERING
// ===================================================================
function renderCellarMap(locations){
  const container = q('#cellar-map');
  if (!container) return;
  container.innerHTML = '';

  const racks = new Map();

  if (Array.isArray(locations) && locations.length){
    locations.forEach(loc => {
      const rackId = String(loc.rack);
      if (!racks.has(rackId)) racks.set(rackId, { rows:new Set(), cols:new Set() });
      racks.get(rackId).rows.add(String(loc.row));
      racks.get(rackId).cols.add(String(loc.col));
    });
  }else{
    // default grid if we have no locations yet
    racks.set('1', {
      rows: new Set(['1','2','3','4','5','6']),
      cols: new Set(['1','2','3','4','5','6'])
    });
  }

  const sortedRacks = [...racks.entries()].sort((a,b)=>Number(a[0])-Number(b[0]));

  sortedRacks.forEach(([rackId, rc]) => {
    const rows = [...rc.rows].sort((a,b)=>Number(a)-Number(b));
    const cols = [...rc.cols].sort((a,b)=>Number(a)-Number(b));

    const section = document.createElement('section');
    section.className = 'cellar-rack';

    const h = document.createElement('h3');
    h.textContent = `Rack ${rackId}`;
    section.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'rack-grid';

    rows.forEach(r => {
      cols.forEach(c => {
        const key = `${rackId}-${r}-${c}`;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.key = key;
        cell.textContent = `${r}-${c}`;
        cell.addEventListener('click', () => showCellWines(key));
        grid.appendChild(cell);
      });
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

function paintMapHasBottles(){
  qa('.cell.has-bottle').forEach(el => el.classList.remove('has-bottle'));

  const usedKeys = new Set();
  Object.values(window.locationIndexByWine || {}).forEach(arr => {
    arr.forEach(p => usedKeys.add(p.cellKey));
  });

  usedKeys.forEach(key => {
    const el = q(`.cell[data-key="${key}"]`);
    if (el) el.classList.add('has-bottle');
  });
}

// simple alert listing for now
function showCellWines(cellKey){
  const winesAtCell = [];
  Object.entries(window.locationIndexByWine || {}).forEach(([wid, arr]) => {
    arr.forEach(p => {
      if (p.cellKey === cellKey) winesAtCell.push({ wineId: wid, qty: p.qty });
    });
  });

  const label = cellKey.replace(/-/g,' · ');
  if (!winesAtCell.length){
    alert(`${label}\n\n(Empty)`);
    return;
  }
  const lines = winesAtCell.map(x => `• ${x.wineId} — Qty: ${x.qty}`);
  alert(`${label}\n\n${lines.join('\n')}`);
}

// ===================================================================
//  SEARCH (CLIENT-SIDE ONLY)
// ===================================================================
let _searchAbort;

async function search(){
  const out = q('#results');
  const raw = q('#q')?.value.trim() || '';

  if (!S.base || !S.token){
    alert('Set Base ID and Token in Settings.');
    return;
  }
  if (!raw){
    if (out) out.innerHTML = '';
    return;
  }

  // cancel any earlier search (for safety, though we don’t use Abort now)
  try{ _searchAbort?.abort(); }catch{}

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  try{
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?maxRecords=200`;
    const r = await fetch(url, { headers: headers() });
    const data = await r.json();

    if (data.error){
      console.error('Wines error:', data.error);
      if (out) out.innerHTML = `<p class="badge">Search error: ${data.error.message}</p>`;
      return;
    }

    const records = data.records || [];
    const terms = raw.split(/\s+/).filter(Boolean).map(norm);

    const filtered = records.filter(rec => {
      const f = rec.fields || {};
      const hay = norm([
        f.Name,
        f.Producer,
        f.Grape,
        f.Country,
        f.Region,
        f.Vintage,
        f.Taste,
        f['Food Pairing'],
        f['Drinkable from'],
        f['Drinkable to']
      ].filter(Boolean).join(' '));
      return terms.every(t => hay.includes(t));
    });

    if (out) out.innerHTML = filtered.length
      ? renderSearchCards(filtered)
      : '<p class="badge">No matches.</p>';

    wireCellarChips();   // enable hover/click highlight

  }catch(e){
    console.error('search failed', e);
    if (out) out.innerHTML = `<p class="badge">Search error: ${e.message}</p>`;
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

function renderSearchCards(records){
  return (records || []).map(rec => {
    const f = rec.fields || {};
    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const chips = [
      [getText(f.Country), getText(f.Region)].filter(Boolean).join(' – ') || null,
      f.Producer ? `🏷️ ${getText(f.Producer)}` : null,
      f.Grape    ? `🍇 ${getText(f.Grape)}`    : null,
      f.Taste    ? `🍷 ${getText(f.Taste)}`    : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      // cellar chip – wineId is rec.id which matches Inventory link ids
      `<span class="badge cellar-chip" data-wine="${rec.id}" title="Show cellar position(s)">📍 cellar</span>`
    ]
    .filter(Boolean)
    .map(x => x.startsWith('<span') ? x : `<span class="badge">${x}</span>`)
    .join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">${chips}</div>
        </div>
      </div>`;
  }).join('') || '<p class="badge">No matches.</p>';
}

// --------- cellar chip hover / click ----------
function wireCellarChips(){
  qa('.cellar-chip').forEach(chip => {
    chip.addEventListener('mouseenter', onCellarHover);
    chip.addEventListener('mouseleave', onCellarLeave);
    chip.addEventListener('click', onCellarClick);
  });
}

function onCellarHover(e){
  const wineId = e.currentTarget.getAttribute('data-wine');
  const positions = window.locationIndexByWine[wineId] || [];
  positions.forEach(p => {
    const el = q(`.cell[data-key="${p.cellKey}"]`);
    if (el) el.classList.add('hover-target');
  });
}

function onCellarLeave(){
  qa('.cell.hover-target').forEach(el => el.classList.remove('hover-target'));
}

function onCellarClick(e){
  const wineId = e.currentTarget.getAttribute('data-wine');
  const positions = window.locationIndexByWine[wineId] || [];
  if (!positions.length){
    alert('No cellar location found.');
    return;
  }
  const target = positions[0];
  const el = q(`.cell[data-key="${target.cellKey}"]`);
  if (el){
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    el.classList.add('blink');
    setTimeout(() => el.classList.remove('blink'), 1500);
  }
}

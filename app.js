// ---- Tonneklinker app.js (v58) ----

// ---------- Settings helpers ----------
const S = {
  get base(){ return localStorage.getItem('tk_base') || ''; },
  get token(){ return localStorage.getItem('tk_token') || ''; },
  get wines(){ return localStorage.getItem('tk_wines') || 'Wines'; },
  get inv(){ return localStorage.getItem('tk_inv') || 'Inventory'; },
  get loc(){ return localStorage.getItem('tk_loc') || 'Locations'; }
};

const q  = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const headers = () => ({ 'Authorization': 'Bearer '+S.token, 'Content-Type':'application/json' });

// ---------- Utils ----------
const escAirtable = s => String(s||'').replace(/'/g,"''");
const norm = s => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();

// Flags (extend if you like)
const FLAGS = {
  Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸', Duitsland:'🇩🇪',
  Portugal:'🇵🇹', Zwitserland:'🇨🇭', België:'🇧🇪', Slovenië:'🇸🇮', Griekenland:'🇬🇷'
};

// ---------- Global cache built from Inventory/Locations ----------
/** Map wineId -> [{rack,row,col,qty,name}] */
const INV_BY_WINE = new Map();
/** Set of cell ids: `cell-r{rack}-r{row}-c{col}` that have any wine */
const CELL_HAS = new Set();
/** Map cellId -> array of { name, qty } for popup on cell click */
const CELL_LIST = new Map();

// ---------- Build cellar grid (3 racks, 6x6) ----------
function buildCellarGrid(){
  const wrap = q('#cellar-map');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="cellar-note">Green cells have bottles. Click a cell to see wines there. Hover/click a “📍 cellar” result to highlight a cell.</div>
  `;

  for (let rack=1; rack<=3; rack++){
    const rackEl = document.createElement('div');
    rackEl.className = 'rack';
    rackEl.innerHTML = `<div class="rack-title">Rack ${rack}</div><div class="rack-grid"></div>`;
    const grid = rackEl.querySelector('.rack-grid');

    for (let row=1; row<=6; row++){
      for (let col=1; col<=6; col++){
        const id = `cell-r${rack}-r${row}-c${col}`;
        const cell = document.createElement('div');
        cell.id = id;
        cell.className = 'cell' + (CELL_HAS.has(id) ? ' has' : '');
        cell.textContent = `${row}-${col}`;

        // click → show wines in this cell
        cell.addEventListener('click', ()=>{
          const list = CELL_LIST.get(id) || [];
          const msg = list.length
            ? list.map(x=>`• ${x.name} — Qty: ${x.qty}`).join('\n')
            : '(Empty)';
          alert(`Rack ${rack} · Row ${row} · Column ${col}\n\n${msg}`);
        });

        grid.appendChild(cell);
      }
    }

    wrap.appendChild(rackEl);
  }
}

// ---------- Highlight helper (used by tooltip hover/click) ----------
function highlightCell(rack, row, col, {scroll=false, flash=false} = {}){
  const id = `cell-r${rack}-r${row}-c${col}`;
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.add('highlight');
  if (scroll) el.scrollIntoView({behavior:'smooth', block:'center'});
  if (flash){
    el.classList.add('pulse');
    setTimeout(()=> el.classList.remove('pulse'), 1200);
  }
}

// ---------- Load Inventory + Locations to fill maps ----------
async function loadInventory(){
  if (!S.base || !S.token) return;

  // 1) Get inventory rows (Wine link, Location link, Quantity)
  const invURL = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=200&fields[]=Wine%20(Link%20to%20Wines)&fields[]=Location%20(Link%20to%20Locations)&fields[]=Quantity`;
  const invRes = await fetch(invURL, {headers:headers()});
  const inv = await invRes.json();

  const locIds = new Set();
  const pairs = []; // temp store

  (inv.records||[]).forEach(r=>{
    const wineIds = r.fields?.['Wine (Link to Wines)'] || [];
    const locId   = (r.fields?.['Location (Link to Locations)'] || [])[0];
    const qty     = r.fields?.Quantity ?? 0;
    if (!wineIds.length || !locId || !qty) return;

    locIds.add(locId);
    wineIds.forEach(wid => pairs.push({ wineId: wid, locId, qty }));
  });

  // 2) Locations
  const chunks = [...locIds];
  const locMap = {};
  for (let i=0; i<chunks.length; i+=50){
    const batch = chunks.slice(i,i+50);
    const formula = `OR(${batch.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const locURL = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&fields[]=Rack&fields[]=Row&fields[]=Column&maxRecords=50`;
    const r = await fetch(locURL, {headers:headers()});
    const j = await r.json();
    (j.records||[]).forEach(x=>{
      locMap[x.id] = {
        rack:Number(x.fields?.Rack||1),
        row :Number(x.fields?.Row||1),
        col :Number(x.fields?.Column||1),
        name:x.fields?.Name||''
      };
    });
  }

  // 3) Build maps
  INV_BY_WINE.clear();
  CELL_HAS.clear();
  CELL_LIST.clear();

  pairs.forEach(p=>{
    const L = locMap[p.locId];
    if (!L) return;

    // by wine
    const list = INV_BY_WINE.get(p.wineId) || [];
    list.push({ rack:L.rack, row:L.row, col:L.col, qty:p.qty });
    INV_BY_WINE.set(p.wineId, list);

    // by cell
    const cellId = `cell-r${L.rack}-r${L.row}-c${L.col}`;
    CELL_HAS.add(cellId);
    const list2 = CELL_LIST.get(cellId) || [];
    list2.push({ name:'(unknown wine id)', qty:p.qty, wineId:p.wineId });
    CELL_LIST.set(cellId, list2);
  });

  // We'll fill real names when search results load (so we can show the proper wine names in cell popups).
}

// ---------- Search ----------
let _abort;
async function search(){
  const out = q('#results');
  const termEl = q('#q');
  const raw = (termEl?.value || '').trim();
  if (!out) return;
  if (!S.base || !S.token){ out.innerHTML = `<p class="badge">Set Base/Token in Settings.</p>`; return; }
  if (!raw){ out.innerHTML = ''; return; }

  try{ _abort?.abort(); }catch(_) {}
  _abort = new AbortController();

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const concat =
    "CONCATENATE({Name},' ',{Vintage},' ',{Producer},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const terms = raw.split(/\s+/).filter(Boolean);
  const pieces = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  // 1) AND-only server search
  const r = await fetch(url, { headers:headers(), signal:_abort.signal });
  const data = await r.json();
  if (Array.isArray(data.records) && data.records.length){
    out.innerHTML = renderSearchCards(data.records);
    afterRenderWines(data.records);  // build cellar chips + replace cell wine names
    return;
  }

  // 2) Fallback client AND (accent-insensitive)
  const allR = await fetch(`${baseUrl}?maxRecords=200`, { headers:headers(), signal:_abort.signal });
  const all = await allR.json();
  const needle = terms.map(norm);
  const rows = (all.records||[]).filter(rec=>{
    const f = rec.fields||{};
    const hay = norm([
      f.Name,f.Vintage,f.Producer,f.Country,f.Region,f.Grape,f.Taste,f['Food Pairing'],
      f['Drinkable from'],f['Drinkable to']
    ].filter(Boolean).join(' '));
    return needle.every(t => hay.includes(t));
  });
  out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  if (rows.length) afterRenderWines(rows);
}

// ---------- Render wines ----------
function renderSearchCards(records){
  return records.map(rec=>{
    const f = rec.fields || {};
    const img = (f['Label Image'] && f['Label Image'][0]?.url)
      ? `<img class="label-img" src="${f['Label Image'][0].url}" alt="Label" />` : '';

    const flag = FLAGS[f.Country] || '🏳️';
    const countryRegion = [flag+' '+(f.Country||''), f.Region||''].filter(Boolean).join(' – ');

    const chips = [
      countryRegion && `<span class="badge flag">${countryRegion}</span>`,
      f.Producer && `<span class="badge producer">🏷️ ${f.Producer}</span>`,
      f.Grape && `<span class="badge grape">🍇 ${f.Grape}</span>`
    ].filter(Boolean).join('');

    const info = [
      f.Taste && `<div class="badge" style="display:block;white-space:normal;">🍷 ${f.Taste}</div>`,
      f['Food Pairing'] && `<div class="badge" style="display:block;white-space:normal;">🍽️ ${f['Food Pairing']}</div>`,
    ].filter(Boolean).join('');

    const meta2 = [
      (f['Drinkable from']||f['Drinkable to']) && `<span class="badge">🕰️ ${[f['Drinkable from'], f['Drinkable to']].filter(Boolean).join(' – ')}</span>`,
      (f.Price!=null && f.Price!=='') && `<span class="badge">💶 € ${Number(f.Price).toFixed(2)}</span>`,
      `<span class="badge chip btn" id="cellar-slot-${rec.id}">📍 cellar</span>`
    ].join(' ');

    return `
      <div class="card wine-card" data-wine="${rec.id}">
        ${img}
        <div class="wine-info">
          <div><b>${f.Name||''}</b>${f.Vintage ? ` — ${f.Vintage}` : ''}</div>
          <div class="meta">${chips}</div>
          <div style="margin-top:10px">${info}</div>
          <div class="meta" style="margin-top:10px">${meta2}</div>
        </div>
      </div>
    `;
  }).join('');
}

// After inserting cards into DOM: wire cellar tooltip + update cell names for clicks
function afterRenderWines(records){
  // Replace placeholder “unknown wine id” names with real names (for cell click popups)
  records.forEach(r=>{
    const positions = INV_BY_WINE.get(r.id) || [];
    positions.forEach(p=>{
      const id = `cell-r${p.rack}-r${p.row}-c${p.col}`;
      const arr = CELL_LIST.get(id);
      if (!arr) return;
      arr.forEach(x => { if (x.wineId === r.id) x.name = r.fields?.Name || x.name; });
    });
  });

  // Build cellar chip tooltips
  records.forEach(r=>{
    const slot = q(`#cellar-slot-${r.id}`);
    if (!slot) return;
    const positions = INV_BY_WINE.get(r.id) || [];
    addCellarChip(slot.parentElement, positions);
    // hide the placeholder chip itself; addCellarChip renders a new chip with tooltip
    slot.remove();
  });
}

// Create a tooltip chip and wire hover/click highlighting
function addCellarChip(containerEl, positions){
  const chip = document.createElement('span');
  chip.className = 'badge chip btn';
  chip.textContent = '📍 cellar';

  const tip = document.createElement('div');
  tip.className = 'tip';

  if (!positions.length) {
    tip.innerHTML = `<div class="tip-empty">No cellar location found.</div>`;
  } else {
    positions.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'tip-row';
      row.textContent = `Rack ${p.rack} · Row ${p.row} · Col ${p.col} — Qty: ${p.qty}`;

      row.addEventListener('mouseenter', ()=>{
        highlightCell(p.rack,p.row,p.col,{scroll:false,flash:true});
      });
      row.addEventListener('mouseleave', ()=>{
        const id = `cell-r${p.rack}-r${p.row}-c${p.col}`;
        const el = document.getElementById(id);
        if (el) el.classList.remove('highlight','pulse');
      });
      row.addEventListener('click', ()=>{
        highlightCell(p.rack,p.row,p.col,{scroll:true,flash:true});
      });

      tip.appendChild(row);
    });
  }

  document.body.appendChild(tip);

  chip.addEventListener('mouseenter', ()=>{
    const r = chip.getBoundingClientRect();
    tip.style.left = `${r.left}px`;
    tip.style.top  = `${r.bottom + 6}px`;
    tip.style.display = 'block';
  });
  chip.addEventListener('mouseleave', ()=> tip.style.display = 'none');

  containerEl.appendChild(chip);
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  // Wire search UI
  q('#btn-search')?.addEventListener('click', e=>{ e.preventDefault(); search(); });
  q('#q')?.addEventListener('keydown', e=>{ if (e.key==='Enter') search(); });

  // Load inventory/locations, build grid, then initial search (if any)
  try{
    await loadInventory();
    buildCellarGrid();
  }catch(e){ console.error(e); }

  if (q('#q')?.value) search();
});

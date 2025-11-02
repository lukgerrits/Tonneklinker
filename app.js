// ---- Tonneklinker app.js v40 ----

// =========== SETTINGS ===========
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
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

// Global state
const STATE = {
  invRecords: [],
  countByLoc: new Map(), // locId -> qty
  wineMap: {},           // wineId -> name
  locMap: {},            // locId -> name
  locations: [],         // {id, rack, row, name}
  racks: [],             // [{name, locs:[...]}]
  locByWine: new Map()   // wineId -> [{id,name,qty}]
};

// =========== BOOT ===========
document.addEventListener('DOMContentLoaded', () => {
  const set = (id,val)=>{ const el=q(id); if(el) el.value=val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable',   S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  q('#btn-save')?.addEventListener('click', saveSettings);
  q('#btn-search')?.addEventListener('click', search);
  q('#q')?.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

  q('#btn-open-add')?.addEventListener('click', openModal);
  q('#btn-cancel-add')?.addEventListener('click', closeModal);
  q('#btn-save-add')?.addEventListener('click', saveNewWine);

  loadInventory();
});

function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Settings saved locally.');
}

// =========== SEARCH (strict AND, case-insensitive) ===========
function escDbl(s){ return String(s ?? '').replace(/"/g,'""'); }
let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  try{ _searchAbort?.abort(); }catch(_){}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const fetchOpts = { headers: headers(), signal: _searchAbort.signal };

  const terms = raw.split(/\s+/).filter(Boolean);
  const concat = "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const pieces = terms.map(t => `FIND("${escDbl(t.toLowerCase())}", LOWER(${concat})) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, fetchOpts);
    const data = r.ok ? await r.json() : { records: [] };
    if ((data.records||[]).length){
      out.innerHTML = renderSearchCards(data.records);
      wireLocationPills(); // enable location hover/tap
      return;
    }

    // Client AND fallback with paging
    let all = [];
    let next = null, guard = 0;
    do{
      const u = new URL(baseUrl);
      u.searchParams.set('pageSize','100');
      if (next) u.searchParams.set('offset', next);
      const rr = await fetch(u.toString(), fetchOpts);
      const jj = await rr.json();
      all = all.concat(jj.records || []);
      next = jj.offset;
    }while(next && ++guard < 12);

    const needles = terms.map(s => s.toLowerCase());
    const rows = all.filter(rec=>{
      const f = rec.fields || {};
      const hay = [
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' ').toLowerCase();
      return needles.every(t => hay.includes(t));
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    wireLocationPills();

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// =========== RENDER SEARCH RESULTS + LOCATION PILL ===========
function renderSearchCards(records){
  const flagMap = {
    Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸',
    Duitsland:'🇩🇪', Portugal:'🇵🇹', VerenigdeStaten:'🇺🇸', Zwitserland:'🇨🇭',
    België:'🇧🇪', Slovenië:'🇸🇮', Griekenland:'🇬🇷'
  };
  const getText = v => {
    if (v == null) return '';
    if (typeof v === 'object'){
      if (Array.isArray(v)) return v.map(getText).join(', ');
      if ('value' in v) return String(v.value);
      if ('text'  in v) return String(v.text);
      if ('content' in v) return String(v.content);
      if ('name' in v) return String(v.name);
      return Object.values(v).map(getText).join(', ');
    }
    return String(v);
  };

  return (records||[]).map(rec=>{
    const f = rec.fields || {};
    const img = Array.isArray(f['Label Image']) && f['Label Image'][0]?.url
      ? `<img src="${f['Label Image'][0].url}" class="label-img" alt="Label"/>` : '';
    const country = getText(f.Country);
    const flag = flagMap[country] || '🌍';
    const chips = [
      [flag + ' ' + country, getText(f.Region)].filter(Boolean).join(' – '),
      getText(f.Grape) || null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join(' ');

    return `
      <div class="card wine-card" style="position:relative" data-wid="${rec.id}">
        ${img}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">
            ${chips}
            <span class="badge loc-pill" data-wid="${rec.id}" title="Show cellar location">📍 Location</span>
          </div>
        </div>
        <div class="loc-pop" id="loc-pop-${rec.id}"><small>Loading…</small></div>
      </div>`;
  }).join('');
}

function wireLocationPills(){
  const container = q('#results');
  if (!container) return;

  container.querySelectorAll('.loc-pill').forEach(pill=>{
    const wid = pill.dataset.wid;
    const pop = q(`#loc-pop-${wid}`);

    async function show(){
      pop.classList.add('show');
      if (!pop.dataset.loaded){
        const locs = await getLocationsForWine(wid);
        pop.innerHTML = locs.length
          ? locs.map(x => `• ${x.name}${x.qty?` (x${x.qty})`:''}`).join('<br>')
          : '<small>No location found</small>';
        pop.dataset.loaded = '1';
      }
    }
    function hide(){ pop.classList.remove('show'); }

    // Desktop hover
    pill.addEventListener('mouseenter', show);
    pill.addEventListener('mouseleave', hide);
    pop.addEventListener('mouseenter', show);
    pop.addEventListener('mouseleave', hide);
    // Mobile click toggle
    pill.addEventListener('click', (e)=>{ e.stopPropagation(); pop.classList.toggle('show'); if (pop.classList.contains('show')) show(); });
    document.addEventListener('click', (e)=>{ if(!pill.contains(e.target) && !pop.contains(e.target)) hide(); });
  });
}

// Fetch locations for a given wine (with caching)
async function getLocationsForWine(wineId){
  if (STATE.locByWine.has(wineId)) return STATE.locByWine.get(wineId);

  async function ensureLocMap(ids){
    const missing = ids.filter(id => !STATE.locMap[id]);
    if (!missing.length) return;
    const formula = `OR(${missing.map(id => `RECORD_ID()="${id}"`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
    const res = await fetch(url, { headers: headers() });
    const json = await res.json();
    (json.records||[]).forEach(r => STATE.locMap[r.id] = r.fields?.Name || r.id);
  }

  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?filterByFormula=${encodeURIComponent(`FIND("${wineId}", ARRAYJOIN({Wine (Link to Wines)}))`)}&maxRecords=100`;
  const r = await fetch(invUrl, { headers: headers() });
  const j = await r.json();

  const locIds = [];
  const entries = (j.records||[]).map(rec=>{
    const f = rec.fields||{};
    const lids = f['Location (Link to Locations)'] || [];
    lids.forEach(id => locIds.push(id));
    return { locIds: lids, qty: Number(f.Quantity ?? 0) };
  });

  await ensureLocMap(locIds);

  const byLoc = new Map();
  for (const e of entries){
    for (const lid of e.locIds){
      byLoc.set(lid, (byLoc.get(lid) || 0) + e.qty);
    }
  }
  const result = Array.from(byLoc.entries()).map(([lid, qty]) => ({
    id: lid, name: STATE.locMap[lid] || lid, qty
  })).sort((a,b)=> (b.qty||0)-(a.qty||0));

  STATE.locByWine.set(wineId, result);
  return result;
}

// =========== INVENTORY (and rack visual) ===========
async function loadInventory(){
  if (!S.base || !S.token) return;
  const target = q('#inventory');
  if (target) target.innerHTML = '<p class="badge">Loading…</p>';

  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=1000`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    STATE.invRecords = invData.records || [];
    STATE.locByWine.clear(); // reset per-wine cache

    if (STATE.invRecords.length === 0){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      await loadRackVisual(); // still show rack layout
      return;
    }

    const wineIDs = new Set();
    const locIDs  = new Set();
    for (const r of STATE.invRecords){
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    }

    async function fetchNameMap(tableName, ids){
      const arr = Array.from(ids);
      const map = {};
      for (let i = 0; i < arr.length; i += 50){
        const chunk = arr.slice(i, i + 50);
        const formula = `OR(${chunk.map(id => `RECORD_ID()="${id}"`).join(',')})`;
        const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
        const res = await fetch(url, { headers: headers() });
        const json = await res.json();
        (json.records || []).forEach(rec => map[rec.id] = rec.fields?.Name || rec.id);
      }
      return map;
    }

    const [wineMap, locMap] = await Promise.all([
      fetchNameMap(S.wines, wineIDs),
      fetchNameMap(S.loc,   locIDs)
    ]);
    STATE.wineMap = wineMap;
    STATE.locMap  = locMap;

    const countByLoc = new Map();
    for (const r of STATE.invRecords){
      const locs = r.fields['Location (Link to Locations)'] || [];
      const qty  = Number(r.fields.Quantity ?? 0) || 0;
      for (const lid of locs){
        countByLoc.set(lid, (countByLoc.get(lid) || 0) + qty);
      }
    }
    STATE.countByLoc = countByLoc;

    const out = STATE.invRecords.map(rec => {
      const f = rec.fields || {};
      const wine = (f['Wine (Link to Wines)'] || []).map(id => wineMap[id] || id).join(', ');
      const loc  = (f['Location (Link to Locations)'] || []).map(id => STATE.locMap[id] || locMap[id] || id).join(', ');
      const qty  = f.Quantity ?? 0;
      return `<div class="card"><b>${wine || '(unknown wine)'}</b><br/>📍 ${loc || 'Unassigned'} — Qty: ${qty}</div>`;
    }).join('');
    q('#inventory').innerHTML = out || '<p class="badge">No inventory yet.</p>';

    // Build rack UI
    await loadRackVisual();

  }catch(err){
    q('#inventory').innerHTML = `<p class="badge">Inventory error: ${err.message}</p>`;
  }
}

async function loadRackVisual(){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?maxRecords=1000`;
  const res = await fetch(url, { headers: headers() });
  const data = await res.json();
  const recs = data.records || [];

  // Parse Rack + Row (no Column)
  STATE.locations = recs.map(r => {
    const f = r.fields || {};
    const rack = (f.Rack || '').toString().trim() || 'Rack 1';
    const row  = Number(f.Row ?? 0);
    return { id: r.id, name: f.Name || `${rack} – Row ${row}`, rack, row };
  }).filter(x => x.row > 0);

  // Group by rack and sort
  const byRack = new Map();
  for (const loc of STATE.locations){
    if (!byRack.has(loc.rack)) byRack.set(loc.rack, []);
    byRack.get(loc.rack).push(loc);
  }
  for (const locs of byRack.values()) locs.sort((a,b)=>a.row - b.row);

  STATE.racks = Array.from(byRack.entries()).map(([name, locs]) => ({ name, locs }));

  renderRackTabs();
  if (STATE.racks.length) renderRackGrid(STATE.racks[0].name);
}

function renderRackTabs(){
  const wrap = q('#rack-tabs');
  if (!wrap) return;
  wrap.innerHTML = STATE.racks.map((r,i)=>`
    <button class="rack-tab ${i===0?'active':''}" data-r="${r.name}">${r.name}</button>
  `).join('');
  wrap.querySelectorAll('.rack-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      wrap.querySelectorAll('.rack-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderRackGrid(btn.dataset.r);
    });
  });
}

function renderRackGrid(rackName){
  const rack = STATE.racks.find(r => r.name === rackName);
  const host = q('#rack-grid');
  if (!rack || !host) return;

  host.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'rack-grid-vertical';

  for (const loc of rack.locs){
    const qty = STATE.countByLoc.get(loc.id) || 0;

    const row = document.createElement('div');
    row.className = 'rack-row' + (qty > 0 ? ' has' : '');
    row.title = loc.name;
    row.innerHTML = `
      <span class="row-label">#${loc.row}</span>
      <span>${loc.name}</span>
      ${qty > 0 ? `<span class="qty">${qty}</span>` : ''}
    `;
    row.addEventListener('click', () => showCellDetails(loc));
    grid.appendChild(row);
  }

  host.appendChild(grid);
}

function showCellDetails(loc){
  const rows = STATE.invRecords.filter(r=>{
    const ids = r.fields['Location (Link to Locations)'] || [];
    return ids.includes(loc.id);
  });
  if (!rows.length){
    alert(`${loc.name}\n\nNo bottles here.`);
    return;
  }
  const lines = rows.map(r=>{
    const wineIds = r.fields['Wine (Link to Wines)'] || [];
    const wineName = wineIds.map(id => STATE.wineMap[id] || id).join(', ');
    const qty  = r.fields.Quantity ?? 0;
    return `• ${wineName}  (x${qty})`;
  }).join('\n');
  alert(`${loc.name}\n\n${lines}`);
}

// =========== MODAL ===========
function openModal(){ q('#add-modal')?.classList.add('open'); }
function closeModal(){ q('#add-modal')?.classList.remove('open'); }

async function saveNewWine(){
  const name = q('#nw-name').value.trim();
  if (!name){ alert('Name is required'); return; }

  const body = {
    fields: {
      Name: name,
      Vintage: q('#nw-vintage').value.trim(),
      Country: q('#nw-country').value.trim(),
      Region:  q('#nw-region').value.trim(),
      Grape:   q('#nw-grape').value.trim(),
      'Label Image': q('#nw-label-url').value ? [{ url: q('#nw-label-url').value }] : undefined,
      'Drinkable from': q('#nw-drink-from').value.trim(),
      'Drinkable to':   q('#nw-drink-to').value.trim(),
      Price: q('#nw-price').value ? Number(q('#nw-price').value) : undefined
    }
  };

  try{
    const urlW = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
    const rW = await fetch(urlW, { method:'POST', headers: headers(), body: JSON.stringify(body) });
    const jW = await rW.json();
    if (!rW.ok) throw new Error(jW?.error?.message || `HTTP ${rW.status}`);

    // Optional: create inventory row with location (by name) + qty
    const locName = q('#nw-location').value.trim();
    const qty     = parseInt(q('#nw-qty').value, 10);
    if (locName || Number.isFinite(qty)){
      // find or create location by exact Name
      const locId = await findOrCreateLocation(locName || 'Unassigned');
      const invFields = {
        'Wine (Link to Wines)': [ jW.id ],
        ...(locId ? { 'Location (Link to Locations)': [ locId ] } : {}),
        ...(Number.isFinite(qty) ? { Quantity: qty } : {})
      };
      const urlI = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`;
      const rI = await fetch(urlI, { method:'POST', headers: headers(), body: JSON.stringify({ records:[{ fields: invFields }] }) });
      if (!rI.ok){
        const jI = await rI.json();
        throw new Error(jI?.error?.message || `HTTP ${rI.status}`);
      }
    }

    closeModal();
    // Reset fields
    ['#nw-name','#nw-vintage','#nw-country','#nw-region','#nw-grape','#nw-label-url','#nw-drink-from','#nw-drink-to','#nw-price','#nw-location','#nw-qty'].forEach(id => { const el=q(id); if(el) el.value=''; });
    // Refresh views
    const qVal = q('#q')?.value?.trim();
    if (qVal) search(); else loadInventory();
    alert('Wine added. Taste & Food Pairing will appear automatically.');

  }catch(e){
    alert('Error: ' + e.message);
  }
}

async function findOrCreateLocation(name){
  if (!name) return null;
  // try to find exact Name
  const f = `LOWER({Name})=LOWER("${name.replace(/"/g,'""')}")`;
  const urlF = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(f)}&maxRecords=1&fields[]=Name`;
  const rF = await fetch(urlF, { headers: headers() });
  const jF = await rF.json();
  const existing = jF.records?.[0];
  if (existing) return existing.id;

  // create
  const rC = await fetch(`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`, {
    method:'POST', headers: headers(), body: JSON.stringify({ records:[{ fields:{ Name:name } }] })
  });
  const jC = await rC.json();
  if (!rC.ok) throw new Error(jC?.error?.message || `HTTP ${rC.status}`);
  return jC.records?.[0]?.id || null;
}

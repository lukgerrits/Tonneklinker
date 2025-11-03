// ---- Tonneklinker app.js (v52) ----

// Persistent settings
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

const q = (sel) => document.querySelector(sel);
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

// ---------- SETTINGS ----------
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
  renderCellarMap(); // refresh map after any setting changes
}

let _handlersBound = false;
document.addEventListener('DOMContentLoaded', () => {
  const set = (id,val)=>{ const el=q(id); if(el) el.value=val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable', S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  if (!_handlersBound){
    q('#btn-save')?.addEventListener('click', e=>{ e.preventDefault(); saveSettings(); });
    q('#btn-search')?.addEventListener('click', e=>{ e.preventDefault(); search(); });
    q('#q')?.addEventListener('keydown', e=>{ if (e.key === 'Enter'){ e.preventDefault(); search(); }});
    _handlersBound = true;
  }

  // build cellar map on load
  renderCellarMap();
});

// ---------- UTIL ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
}

// ---------- SEARCH ----------
let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  try { _searchAbort?.abort(); } catch(_) {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl   = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };
  const terms = raw.split(/\s+/).filter(Boolean);

  // server AND search across all relevant fields
  const concat =
    "CONCATENATE(" +
      "{Name},' '," +
      "{Vintage},' '," +
      "{Country},' '," +
      "{Region},' '," +
      "{Grape},' '," +
      "{Producer},' '," +
      "{Taste},' '," +
      "{Food Pairing},' '," +
      "{Drinkable from},' '," +
      "{Drinkable to}" +
    ")";

  const pieces  = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      bindCellarChipHandlers();
      return;
    }

    // client AND fallback if formula returns 0
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Producer, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    bindCellarChipHandlers();

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// ---------- RENDER SEARCH ----------
function renderSearchCards(records){
  const getText = (val) => {
    if (val == null) return '';
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
      if (val.value) return val.value;
      if (val.text) return val.text;
      if (val.content) return val.content;
      if (val.name) return val.name;
      if (val.url) return val.url;
      return Object.values(val).join(', ');
    }
    if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
    return String(val);
  };

  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷'
  };

  const html = records.map(rec => {
    const f = rec.fields || {};

    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const country = getText(f.Country);
    const region  = getText(f.Region);
    const flag    = flagMap[country] || '🌍';
    const countryRegion = [flag + ' ' + country, region].filter(Boolean).join(' – ');

    const chips = [
      countryRegion || null,
      f.Producer ? `🏷️ ${getText(f.Producer)}` : null,
      f.Grape ? `🍇 ${getText(f.Grape)}` : null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null,
      `<button class="badge btn-cellar" data-wineid="${rec.id}" title="Show cellar location">📍 cellar</button>`
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join(' ');

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">${chips}</div>
          ${f.Description ? `<p class="note">${getText(f.Description)}</p>` : ''}
        </div>
      </div>`;
  }).join('');

  return html || '<p class="badge">No matches.</p>';
}

// ---------- CELLAR CHIP ----------
function bindCellarChipHandlers(){
  document.querySelectorAll('.btn-cellar').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const wineId = btn.dataset.wineid;
      await showCellarForWine(wineId);
    });
  });
}

async function showCellarForWine(wineId){
  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?` +
      `filterByFormula=${encodeURIComponent(`FIND('${wineId}', ARRAYJOIN({Wine (Link to Wines)}))`)}&maxRecords=100`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    const rows = (invData.records || []).filter(r=>Array.isArray(r.fields?.['Location (Link to Locations)']) && r.fields['Location (Link to Locations)'].length);

    if (!rows.length){
      alert('No cellar location found.');
      return;
    }

    const locIDs = [];
    const locQty = {};
    rows.forEach(r=>{
      const qty = Number(r.fields?.Quantity ?? 0) || 0;
      (r.fields['Location (Link to Locations)'] || []).forEach(id=>{
        locIDs.push(id);
        locQty[id] = (locQty[id] || 0) + qty;
      });
    });

    const unique = Array.from(new Set(locIDs));
    let locMap = {};
    for (let i=0; i<unique.length; i+=50){
      const chunk = unique.slice(i, i+50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
      const res = await fetch(url, { headers: headers() });
      const json = await res.json();
      (json.records||[]).forEach(rec=>{
        const f = rec.fields||{};
        locMap[rec.id] = {
          rack: f.Rack || '',
          row:  f.Row  || '',
          col:  f.Column || '' // optional
        };
      });
    }

    const lines = [];
    Object.keys(locQty).forEach(locId=>{
      const meta = locMap[locId] || {};
      const rack = meta.rack || 'Rack ?';
      const row  = meta.row  || 'Row ?';
      const col  = meta.col  ? ` • Column ${meta.col}` : '';
      lines.push(`${rack} • ${row}${col} — Qty: ${locQty[locId]}`);
    });

    alert(lines.join('\n'));
  }catch(err){
    console.error(err);
    alert('No cellar location found.');
  }
}

// ---------- CELLAR MAP (3 racks × 6 rows × 6 cols) ----------
async function renderCellarMap(){
  const host = q('#cellar-map');
  if (!host) return;
  host.innerHTML = ''; // reset

  // build empty 3 racks
  for (let r=1; r<=3; r++){
    const rackDiv = document.createElement('div');
    rackDiv.className = 'rack';
    rackDiv.innerHTML = `<h4>Rack ${r}</h4>`;
    const grid = document.createElement('div');
    grid.className = 'grid-6';
    // fill 6x6
    for (let row=1; row<=6; row++){
      for (let col=1; col<=6; col++){
        const cell = document.createElement('div');
        cell.className = 'slot';
        cell.textContent = `${row}-${col}`;
        // attach data
        cell.dataset.rack = `Rack ${r}`;
        cell.dataset.row  = `Row ${row}`;
        cell.dataset.col  = String(col);
        grid.appendChild(cell);
      }
    }
    rackDiv.appendChild(grid);
    host.appendChild(rackDiv);
  }

  // paint green (has inventory) & bind click
  try{
    if (!S.base || !S.token) return; // nothing to fetch yet

    // Fetch all inventory rows
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=300`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    const wineIDs = new Set();
    const locIDs  = new Set();
    const invRows = invData.records || [];
    invRows.forEach(r=>{
      (r.fields?.['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields?.['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    });

    // Build maps
    const wineMap = await fetchNameMap(S.wines, Array.from(wineIDs), ['Name','Vintage']);
    const locMeta = await fetchLocMeta(Array.from(locIDs)); // {id:{rack,row,col}}

    // Aggregate occupancy by rack-row-col
    const occ = {}; // key: Rack|Row|Col -> [{name,qty}]
    invRows.forEach(r=>{
      const qty = Number(r.fields?.Quantity ?? 0) || 0;
      const wines = r.fields?.['Wine (Link to Wines)'] || [];
      const locs  = r.fields?.['Location (Link to Locations)'] || [];
      if (!qty || !wines.length || !locs.length) return;

      wines.forEach(wid=>{
        const w = wineMap[wid];
        const wname = w ? `${w.Name || ''}${w.Vintage ? ' — '+w.Vintage : ''}` : wid;
        locs.forEach(lid=>{
          const m = locMeta[lid];
          if (!m) return;
          const rack = m.rack || 'Rack 1';
          const row  = m.row  || 'Row 1';
          const col  = m.col  || '1';
          const key = `${rack}|${row}|${col}`;
          if (!occ[key]) occ[key] = [];
          occ[key].push({ name: wname, qty });
        });
      });
    });

    // Paint cells that have wines
    document.querySelectorAll('.slot').forEach(slot=>{
      const rack = slot.dataset.rack;
      const row  = slot.dataset.row;
      const col  = slot.dataset.col;
      const key  = `${rack}|${row}|${col}`;
      if (occ[key] && occ[key].length){
        slot.classList.add('has');
        slot.addEventListener('click', ()=>{
          const lines = occ[key].map(x=>`• ${x.name} — Qty: ${x.qty}`);
          alert(`${rack} • ${row} • Column ${col}\n\n${lines.join('\n')}`);
        });
      }else{
        // keep visible & clickable (shows empty)
        slot.addEventListener('click', ()=>{
          alert(`${rack} • ${row} • Column ${col}\n\n(Empty)`);
        });
      }
    });

  }catch(err){
    console.error('Cellar map error', err);
    // still keep grid visible
  }
}

async function fetchNameMap(tableName, ids, fields){
  const map = {};
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 50){
    const chunk = ids.slice(i, i+50);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}${fields?.length ? fields.map(f=>`&fields[]=${encodeURIComponent(f)}`).join('') : ''}&maxRecords=50`;
    const res = await fetch(url, { headers: headers() });
    const json = await res.json();
    (json.records || []).forEach(rec => map[rec.id] = rec.fields || {});
  }
  return map;
}

async function fetchLocMeta(ids){
  const map = {};
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 50){
    const chunk = ids.slice(i, i+50);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Rack&fields[]=Row&fields[]=Column&maxRecords=50`;
    const res = await fetch(url, { headers: headers() });
    const json = await res.json();
    (json.records || []).forEach(rec=>{
      const f = rec.fields || {};
      map[rec.id] = { rack: f.Rack || '', row: f.Row || '', col: f.Column || '' };
    });
  }
  return map;
}

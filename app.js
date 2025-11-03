// ---- Tonneklinker app.js (v50) ----

// ===== Map Config (adjust anytime) =====
const RACKS = ['Rack 1','Rack 2','Rack 3'];
const GRID_ROWS = 6;
const GRID_COLS = 6;

// ===== Settings & helpers =====
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

function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
}
function euro(p){
  if (p == null || p === '') return '';
  const n = Number(p);
  return isFinite(n) ? `€ ${n.toFixed(2)}` : p;
}
const badge = t => `<span class="badge">${t}</span>`;

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => {
  const set = (id,val)=>{ const el=q(id); if(el) el.value=val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable', S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  q('#btn-save')?.addEventListener('click', e=>{ e.preventDefault(); saveSettings(); });
  q('#btn-search')?.addEventListener('click', e=>{ e.preventDefault(); search(); });
  q('#q')?.addEventListener('keydown', e=>{ if (e.key === 'Enter'){ e.preventDefault(); search(); }});

  // modal
  const modal = q('#add-modal');
  q('#btn-open-add')?.addEventListener('click', ()=>{
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden','false');
  });
  q('#btn-cancel-add')?.addEventListener('click', ()=>{
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden','true');
  });
  q('#btn-save-add')?.addEventListener('click', saveNewWine);

  // map
  renderCellarMapShell();      // draws empty racks
  refreshCellarMapOccupancy(); // colors with data
});

function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
  // Update map occupancy after tokens/base may change
  refreshCellarMapOccupancy();
}

// ===== SEARCH =====
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

  const concat =
    "CONCATENATE(" +
      "{Name},' '," +
      "{Producer},' '," +
      "{Vintage},' '," +
      "{Country},' '," +
      "{Region},' '," +
      "{Grape},' '," +
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
      bindCellarChips(data.records);
      return;
    }

    // fallback (AND) client
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Producer, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    if (rows.length) bindCellarChips(rows);

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

function getText(val){
  if (val == null) return '';
  if (typeof val === 'object'){
    if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
    if (val.value) return val.value;
    if (val.text) return val.text;
    if (val.content) return val.content;
    if (val.name) return val.name;
    if (val.url) return val.url;
    return Object.values(val).join(', ');
  }
  return String(val);
}

function renderSearchCards(records){
  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷'
  };

  return records.map(rec => {
    const f = rec.fields || {};
    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const country = getText(f.Country);
    const region  = getText(f.Region);
    const flag    = flagMap[country] || '🌍';
    const countryRegion = [flag + ' ' + country, region].filter(Boolean).join(' – ');
    const topLine = `<b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}`;

    const chips = [];
    if (countryRegion) chips.push(badge(countryRegion));
    if (f.Producer)    chips.push(badge(`🏷️ ${getText(f.Producer)}`));
    if (f.Grape)       chips.push(badge(`🍇 ${getText(f.Grape)}`));
    if (f.Taste)       chips.push(badge(`👅 ${getText(f.Taste)}`));
    if (f['Food Pairing']) chips.push(badge(`🍽️ ${getText(f['Food Pairing'])}`));
    if (f['Drinkable from'] || f['Drinkable to']){
      const win = [getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ');
      chips.push(badge(`🕰️ ${win}`));
    }
    if (f.Price !== '' && f.Price != null) chips.push(badge(`💶 ${euro(f.Price)}`));
    chips.push(`<span class="badge cellar-chip" data-wine="${rec.id}" style="cursor:pointer;">📍 cellar</span>`);

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          ${topLine}
          <div class="meta">${chips.join(' ')}</div>
        </div>
      </div>`;
  }).join('');
}

// ===== Cellar chip (tooltip) =====
function bindCellarChips(records){
  const chips = document.querySelectorAll('.cellar-chip');
  const tooltip = q('#cellar-tooltip');

  const hideTip = ()=> { tooltip.style.display='none'; };

  chips.forEach(chip => {
    const wineId = chip.getAttribute('data-wine');
    let cache = null;

    const show = async () => {
      if (!cache){
        cache = await cellarInfoHtmlForWine(wineId);
        if (!cache) return; // no inventory; stay silent
      }
      tooltip.innerHTML = cache;
      const rect = chip.getBoundingClientRect();
      tooltip.style.left = `${rect.left + window.scrollX}px`;
      tooltip.style.top  = `${rect.bottom + window.scrollY + 6}px`;
      tooltip.style.display = 'inline-block';
    };

    chip.addEventListener('mouseenter', show);
    chip.addEventListener('mouseleave', hideTip);
    chip.addEventListener('click', (e)=>{ e.stopPropagation(); show(); });
  });

  document.addEventListener('scroll', hideTip, { passive:true });
  document.addEventListener('click', (e)=>{
    if (!e.target.classList.contains('cellar-chip')) hideTip();
  });
}

async function cellarInfoHtmlForWine(wineId){
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`
    + `?filterByFormula=${encodeURIComponent(`FIND('${wineId}', ARRAYJOIN({Wine (Link to Wines)}))`)}`;
  const rInv = await fetch(invUrl, { headers: headers() });
  if (!rInv.ok) return '';
  const inv = await rInv.json();
  const invRecs = inv.records || [];
  if (!invRecs.length) return '';

  const locIds = [];
  invRecs.forEach(rec=>{
    const ids = rec.fields['Location (Link to Locations)'] || [];
    ids.forEach(id => { if (!locIds.includes(id)) locIds.push(id); });
  });

  const locMap = {};
  if (locIds.length){
    for (let i=0;i<locIds.length;i+=50){
      const chunk = locIds.slice(i,i+50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
        + `?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&fields[]=Rack&fields[]=Row&fields[]=Column&maxRecords=50`;
      const r = await fetch(url, { headers: headers() });
      const j = await r.json();
      (j.records||[]).forEach(rec=>{
        locMap[rec.id] = {
          name: rec.fields?.Name || '',
          rack: rec.fields?.Rack || '',
          row:  rec.fields?.Row  || '',
          col:  rec.fields?.Column || ''
        };
      });
    }
  }

  const lines = invRecs.map(r=>{
    const qty = r.fields?.Quantity ?? 0;
    const ids = r.fields['Location (Link to Locations)'] || [];
    const parts = ids.map(id=>{
      const L = locMap[id] || {};
      const label = [L.name, L.rack ? `Rack ${L.rack}` : '', L.row ? `Row ${L.row}` : '', L.col ? `Col ${L.col}` : '']
        .filter(Boolean).join(' • ');
      return label || id;
    });
    return `📍 ${parts.join(', ')} — Qty: ${qty}`;
  });

  return lines.length ? lines.map(badge).join('<br>') : '';
}

// ===== Cellar Map =====
function renderCellarMapShell(){
  const host = q('#cellar-map');
  host.innerHTML = '';

  RACKS.forEach(rackName => {
    const wrap = document.createElement('div');
    wrap.className = 'rack';
    const h = document.createElement('h3');
    h.textContent = rackName;
    wrap.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'grid-map';
    grid.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;

    for (let r=1; r<=GRID_ROWS; r++){
      for (let c=1; c<=GRID_COLS; c++){
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.rack = rackName;
        cell.dataset.row  = String(r);
        cell.dataset.col  = String(c);
        cell.title = `Row ${r} • Col ${c}`;
        cell.textContent = `${r}-${c}`;
        grid.appendChild(cell);
      }
    }

    wrap.appendChild(grid);
    host.appendChild(wrap);
  });
}

async function refreshCellarMapOccupancy(){
  if (!S.base || !S.token) return;

  // 1) Fetch all inventory rows (limit to a sensible number)
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=500`;
  const rInv = await fetch(invUrl, { headers: headers() });
  if (!rInv.ok) return;
  const jInv = await rInv.json();
  const inv = jInv.records || [];

  // collect location ids & also map of locationId -> list of {wineId, qty}
  const locIds = new Set();
  const byLoc = {};
  inv.forEach(row=>{
    const qty = row.fields?.Quantity ?? 0;
    const wines = row.fields['Wine (Link to Wines)'] || [];
    const locs  = row.fields['Location (Link to Locations)'] || [];
    locs.forEach(lid=>{
      locIds.add(lid);
      byLoc[lid] ??= [];
      byLoc[lid].push({ wines, qty });
    });
  });

  // 2) Fetch location metadata
  const locMeta = {};
  const ids = Array.from(locIds);
  for (let i=0;i<ids.length;i+=50){
    const chunk = ids.slice(i,i+50);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
      + `?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&fields[]=Rack&fields[]=Row&fields[]=Column&maxRecords=50`;
    const r = await fetch(url, { headers: headers() });
    const j = await r.json();
    (j.records||[]).forEach(rec=>{
      locMeta[rec.id] = {
        name: rec.fields?.Name || '',
        rack: rec.fields?.Rack || '',
        row:  rec.fields?.Row  || '',
        col:  rec.fields?.Column || ''
      };
    });
  }

  // 3) Paint cells & bind click
  const cellEls = document.querySelectorAll('.cell');
  cellEls.forEach(el => {
    el.classList.remove('occupied');
    el.onclick = null;
  });

  Object.entries(byLoc).forEach(([lid, items])=>{
    const meta = locMeta[lid];
    if (!meta) return;

    // match by rack/row/col (col optional)
    const rack = meta.rack || meta.name || '';
    const row  = String(meta.row || '');
    const col  = String(meta.col || '');

    // find matching cell(s)
    const selector = `.cell[data-rack="${CSS.escape(rack)}"][data-row="${CSS.escape(row)}"]`
      + (col ? `[data-col="${CSS.escape(col)}"]` : '');
    const match = document.querySelector(selector);
    if (!match) return;

    const totalQty = items.reduce((s,i)=> s + (i.qty||0), 0);
    if (totalQty > 0){
      match.classList.add('occupied');
      match.onclick = async () => {
        // Build a readable list of wines in this cell
        const wineNames = await namesForWineIds(
          Array.from(new Set(items.flatMap(i => i.wines)))
        );
        const lines = items.map(i=>{
          const names = i.wines.map(id => wineNames[id] || id).join(', ');
          return `• ${names} — Qty: ${i.qty ?? 0}`;
        }).join('\n');
        alert(`${rack} • Row ${row}${col?` • Col ${col}`:''}\n\n${lines || 'No wines here.'}`);
      };
    }
  });
}

async function namesForWineIds(ids){
  const map = {};
  for (let i=0;i<ids.length;i+=50){
    const chunk = ids.slice(i,i+50);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`
      + `?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
    const r = await fetch(url, { headers: headers() });
    const j = await r.json();
    (j.records || []).forEach(rec => { map[rec.id] = rec.fields?.Name || rec.id; });
  }
  return map;
}

// ===== Add Wine (same fields as before, now also Producer) =====
async function saveNewWine(){
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings first.'); return; }

  const name = q('#nw-name').value.trim();
  if (!name){ alert('Name is required.'); return; }

  const get = sel => q(sel)?.value.trim() || '';
  const toInt   = v => { const n=parseInt(v,10); return isFinite(n)?n:undefined; };
  const toFloat = v => { const n=parseFloat(v);  return isFinite(n)?n:undefined; };

  const fields = { Name: name };
  const addIf = (k,v)=>{ if (v!==undefined && v!=='') fields[k]=v; };

  addIf('Vintage', toInt(get('#nw-vintage')));
  addIf('Producer', get('#nw-producer'));
  addIf('Country',  get('#nw-country'));
  addIf('Region',   get('#nw-region'));
  addIf('Grape',    get('#nw-grape'));
  addIf('Price',    toFloat(get('#nw-price')));
  addIf('Drinkable from', toInt(get('#nw-drink-from')));
  addIf('Drinkable to',   toInt(get('#nw-drink-to')));

  const labelUrl = get('#nw-label-url');
  if (labelUrl) fields['Label Image'] = [{ url: labelUrl }];

  // Create wine
  const createWineUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const rWine = await fetch(createWineUrl, {
    method:'POST',
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }] })
  });
  if (!rWine.ok){
    const t = await rWine.text();
    alert(`Error saving wine: ${rWine.status}\n${t}`);
    return;
  }
  const jWine = await rWine.json();
  const wineId = jWine.records?.[0]?.id;

  // Optional inventory
  const locText = get('#nw-location');
  const qtyVal  = get('#nw-qty');
  if (wineId && (locText || qtyVal)){
    let rack='', row='';
    if (locText){
      const mRack = locText.match(/rack\s*([^\s–]+)/i);
      const mRow  = locText.match(/row\s*([^\s–]+)/i);
      rack = mRack ? mRack[1] : '';
      row  = mRow  ? mRow[1]  : '';
    }
    const locName = locText || 'Unnamed location';

    // find or create location
    const findUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
      + `?filterByFormula=${encodeURIComponent(
        `AND({Name}='${escAirtable(locName)}'${rack?`,{Rack}='${escAirtable(rack)}'`:''}${row?`,{Row}='${escAirtable(row)}'`:''})`
      )}&maxRecords=1`;
    const rFind = await fetch(findUrl, { headers: headers() });
    const jFind = await rFind.json();
    let locId = jFind.records?.[0]?.id;

    if (!locId){
      const rCreateLoc = await fetch(
        `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`,
        {
          method:'POST',
          headers: headers(),
          body: JSON.stringify({ records: [{ fields: { Name: locName, ...(rack?{Rack:rack}:{}) , ...(row?{Row:row}:{}) } }] })
        }
      );
      const jCL = await rCreateLoc.json();
      locId = jCL.records?.[0]?.id;
    }

    if (locId){
      const qty = parseInt(qtyVal,10);
      const invFields = {
        'Wine (Link to Wines)': [wineId],
        'Location (Link to Locations)': [locId],
        ...(isFinite(qty) ? { Quantity: qty } : {})
      };
      await fetch(
        `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`,
        {
          method:'POST',
          headers: headers(),
          body: JSON.stringify({ records: [{ fields: invFields }] })
        }
      );
    }
  }

  // Close modal & reset
  q('#add-modal').style.display='none';
  q('#add-modal').setAttribute('aria-hidden','true');
  ['#nw-name','#nw-vintage','#nw-producer','#nw-country','#nw-region','#nw-grape',
   '#nw-label-url','#nw-price','#nw-drink-from','#nw-drink-to','#nw-location','#nw-qty'
  ].forEach(sel => { const el=q(sel); if(el) el.value=''; });

  // refresh visible list + map
  search();
  refreshCellarMapOccupancy();
}

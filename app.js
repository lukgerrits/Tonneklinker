// ---- Tonneklinker app.js (v30) ----

// =================== SETTINGS / STATE ===================
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

// =================== SETTINGS PANEL ===================
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
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
    const saveBtn = q('#btn-save');
    if (saveBtn) saveBtn.addEventListener('click', e=>{ e.preventDefault(); saveSettings(); });

    const searchBtn = q('#btn-search');
    if (searchBtn){
      searchBtn.type = 'button';
      searchBtn.addEventListener('click', e=>{ e.preventDefault(); search(); });
    }

    const searchInput = q('#q');
    if (searchInput){
      searchInput.addEventListener('keydown', e=>{ if (e.key === 'Enter'){ e.preventDefault(); search(); }});
    }

    // Add Wine modal handlers
    const openBtn   = q('#btn-open-add');
    const saveAdd   = q('#btn-save-add');
    const cancelAdd = q('#btn-cancel-add');
    if (openBtn)   openBtn.addEventListener('click', ()=> openAddModal(true));
    if (cancelAdd) cancelAdd.addEventListener('click', ()=> openAddModal(false));
    if (saveAdd)   saveAdd.addEventListener('click', submitNewWine);

    _handlersBound = true;
  }

  loadInventory();
});

// =================== SEARCH ===================
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }

let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  // cancel any previous request
  try { _searchAbort?.abort(); } catch(_) {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl   = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };
  const terms = raw.split(/\s+/).filter(Boolean);

  // fields to search across (server)
  const concat =
    "CONCATENATE(" +
      "{Name},' '," +
      "{Vintage},' '," +
      "{Country},' '," +
      "{Region},' '," +
      "{Grape},' '," +
      "{Taste},' '," +
      "{Food Pairing},' '," +
      "{Drinkable from},' '," +
      "{Drinkable to}" +
    ")";

  // SERVER: case-insensitive AND using SEARCH()>0
  const pieces  = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    // 1) AND (server)
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }

    // 2) AND (client) fallback on a broader fetch
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t)); // AND only
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// =================== RENDER RESULTS ===================
function renderSearchCards(records){
  const getText = (val) => {
    if (val == null) return '';
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
      if (val.value) return val.value;      // AI field shape
      if (val.text) return val.text;
      if (val.content) return val.content;
      if (val.name) return val.name;
      if (val.url) return val.url;
      return Object.values(val).join(', ');
    }
    if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
    return String(val);
  };

  // Country flag icons (simple map; extend as needed)
  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷', Oosten: '🌍'
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
      getText(f.Grape) || null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join(' ');

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

// =================== INVENTORY LIST ===================
async function loadInventory(){
  if (!S.base || !S.token) return;
  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    if (!invData.records || invData.records.length === 0){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      return;
    }

    const wineIDs = new Set();
    const locIDs  = new Set();
    for (const r of invData.records){
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    }

    async function fetchNameMap(tableName, ids){
      const arr = Array.from(ids);
      const map = {};
      for (let i = 0; i < arr.length; i += 50){
        const chunk = arr.slice(i, i + 50);
        const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
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

    const out = invData.records.map(rec => {
      const f = rec.fields || {};
      const wine = (f['Wine (Link to Wines)'] || []).map(id => wineMap[id] || id).join(', ');
      const loc  = (f['Location (Link to Locations)'] || []).map(id => locMap[id]  || id).join(', ');
      const qty  = f.Quantity ?? 0;
      return `<div class="card"><b>${wine}</b><br/>📍 ${loc} — Qty: ${qty}</div>`;
    }).join('');

    q('#inventory').innerHTML = out || '<p class="badge">No inventory yet.</p>';
  }catch(err){
    q('#inventory').innerHTML = `<p class="badge">Inventory error: ${err.message}</p>`;
  }
}

// =================== ADD WINE MODAL: HELPERS ===================
function openAddModal(open=true){
  const m = q('#add-modal');
  if (!m) return;
  if (open){ m.classList.add('open'); m.setAttribute('aria-hidden','false'); }
  else { m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }
}

function readVal(id){ const el=q(id); return el ? el.value.trim() : ''; }
function toNum(s){ const n = Number(String(s||'').replace(',','.')); return isFinite(n) ? n : undefined; }
function toInt(s){ const n = parseInt(s,10); return isFinite(n) ? n : undefined; }

async function atCreate(table, fields){
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}`;
  const r = await fetch(url, {
    method:'POST',
    headers: headers(),
    body: JSON.stringify({ records:[{ fields }] })
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json?.error?.message || r.statusText);
  return json.records?.[0];
}

async function atFindByName(table, name){
  const formula = `LOWER({Name})=LOWER('${escAirtable(name)}')`;
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1&fields[]=Name`;
  const r = await fetch(url, { headers: headers() });
  const j = await r.json();
  return j.records?.[0]?.id || null;
}

async function findOrCreateLocation(name){
  if (!name) return null;
  const existing = await atFindByName(S.loc, name);
  if (existing) return existing;
  const rec = await atCreate(S.loc, { Name: name });
  return rec.id;
}

// =================== ADD WINE: SUBMIT ===================
async function submitNewWine(){
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings first.'); return; }

  const name   = readVal('#nw-name');
  if (!name){ alert('Name is required.'); return; }

  // Optional inputs
  const vintage = toInt(readVal('#nw-vintage'));
  const country = readVal('#nw-country');
  const region  = readVal('#nw-region');
  const grape   = readVal('#nw-grape');
  const imgUrl  = readVal('#nw-label-url');

  const drinkFrom = readVal('#nw-drink-from');
  const drinkTo   = readVal('#nw-drink-to');
  const price     = toNum(readVal('#nw-price'));

  const locName = readVal('#nw-location');
  const qty     = toInt(readVal('#nw-qty'));

  // Wine fields (Taste & Food Pairing generated automatically by Airtable AI)
  const wineFields = {
    Name: name,
    ...(vintage!=null ? { Vintage: vintage } : {}),
    ...(country ? { Country: country } : {}),
    ...(region  ? { Region: region } : {}),
    ...(grape   ? { Grape: grape } : {}),
    ...(drinkFrom ? { 'Drinkable from': drinkFrom } : {}),
    ...(drinkTo   ? { 'Drinkable to':   drinkTo   } : {}),
    ...(price!=null ? { Price: price } : {}),
    ...(imgUrl ? { 'Label Image': [{ url: imgUrl }] } : {})
  };

  const saveBtn = q('#btn-save-add');
  const originalText = saveBtn?.textContent;
  if (saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try{
    // 1) Create wine
    const wineRec = await atCreate(S.wines, wineFields);

    // 2) Optional: create inventory line
    if (qty!=null || locName){
      const locId = await findOrCreateLocation(locName || 'Unassigned');
      const invFields = {
        'Wine (Link to Wines)': [ wineRec.id ],
        ...(locId ? { 'Location (Link to Locations)': [ locId ] } : {}),
        ...(qty!=null ? { Quantity: qty } : {})
      };
      await atCreate(S.inv, invFields);
    }

    // Cleanup + refresh
    openAddModal(false);
    ['#nw-name','#nw-vintage','#nw-country','#nw-region','#nw-grape',
     '#nw-label-url','#nw-drink-from','#nw-drink-to','#nw-price',
     '#nw-location','#nw-qty'
    ].forEach(id => { const el=q(id); if(el) el.value=''; });

    loadInventory();
    const searchInput = q('#q'); if (searchInput){ searchInput.value = name; }
    if (typeof search === 'function') search();

    alert('Wine added. Taste & Food Pairing will appear shortly (Airtable AI).');
  }catch(err){
    console.error(err);
    alert('Error adding wine: ' + err.message);
  }finally{
    if (saveBtn){ saveBtn.disabled = false; saveBtn.textContent = originalText || 'Save'; }
  }
}

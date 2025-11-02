// ---- Tonneklinker app.js (v47) ----

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

// --- toast helper ---
function toast(msg, ms=1600){
  let t = document.getElementById('tk-toast');
  if(!t){ t = document.createElement('div'); t.id='tk-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity=1;
  setTimeout(()=>{ t.style.opacity=0; }, ms);
}

// ---------- SETTINGS ----------
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  toast('Saved.');
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

    // Add modal wiring
    const openAdd = q('#btn-open-add');
    const modal = q('#add-modal');
    const cancelAdd = q('#btn-cancel-add');
    const saveAdd = q('#btn-save-add');

    if (openAdd && modal) openAdd.addEventListener('click', ()=>{ modal.classList.add('open'); });
    if (cancelAdd && modal) cancelAdd.addEventListener('click', ()=>{ modal.classList.remove('open'); });
    if (saveAdd && modal) saveAdd.addEventListener('click', saveNewWine);

    // location pin event (hover & click)
    const resultsEl = q('#results');
    if (resultsEl){
      resultsEl.addEventListener('mouseenter', handlePinEvent, true);
      resultsEl.addEventListener('click', handlePinEvent, true);
    }

    _handlersBound = true;
  }
});

// ---------- SEARCH ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
}

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
  const h         = { headers: headers(), signal: _searchAbort.signal };
  const terms     = raw.split(/\s+/).filter(Boolean);

  // Fields to search across (server) – includes Producer now
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

  // SERVER: case-insensitive AND using SEARCH()>0
  const pieces  = terms.map(t => `SEARCH(LOWER('${escAirtable(t)}'), LOWER(${concat})) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    // 1) AND (server)
    const r = await fetch(url, h);
    if (!r.ok) throw new Error(`Airtable ${r.status}`);
    const data = await r.json();
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }

    // 2) AND (client) fallback on a broader fetch
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, h);
    if (!rAll.ok) throw new Error(`Airtable ${rAll.status}`);
    const all  = await rAll.json();
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Producer, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
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

// ---------- LOCATION PIN (fetch on demand) ----------
const LOC_CACHE = Object.create(null);

async function handlePinEvent(e){
  const pin = e.target.closest('.badge-loc');
  if (!pin) return;

  // On hover: only set title if not loaded yet
  // On click: also show an alert
  const wineId = pin.getAttribute('data-wine');
  if (!wineId) return;

  try{
    const info = await getLocationInfoForWine(wineId);
    if (info) {
      pin.title = info;
      if (e.type === 'click') alert(info);
    } else {
      pin.title = 'No cellar location';
      if (e.type === 'click') alert('No cellar location found.');
    }
  }catch(err){
    console.warn(err);
    pin.title = 'Error loading location';
    if (e.type === 'click') alert('Error loading location');
  }
}

async function getLocationInfoForWine(wineId){
  if (LOC_CACHE[wineId]) return LOC_CACHE[wineId];

  // Find Inventory rows linking this wine
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`
    + `?filterByFormula=${encodeURIComponent(`FIND('${wineId}', ARRAYJOIN({Wine (Link to Wines)}))`)}&maxRecords=50`;

  const invRes = await fetch(invUrl, { headers: headers() });
  if (!invRes.ok) throw new Error(`Inventory ${invRes.status}`);
  const invData = await invRes.json();

  const locIds = new Set();
  const qtyByLoc = {};
  (invData.records||[]).forEach(r=>{
    const locs = r.fields?.['Location (Link to Locations)'] || [];
    const qty  = r.fields?.Quantity ?? 0;
    locs.forEach(id => { locIds.add(id); qtyByLoc[id] = (qtyByLoc[id]||0) + (Number(qty)||0); });
  });

  if (!locIds.size){
    LOC_CACHE[wineId] = '';
    return '';
  }

  // Fetch Locations detail in one batch
  const ids = Array.from(locIds);
  const locFormula = `OR(${ids.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
  const locUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
    + `?filterByFormula=${encodeURIComponent(locFormula)}&maxRecords=50`;

  const locRes = await fetch(locUrl, { headers: headers() });
  if (!locRes.ok) throw new Error(`Locations ${locRes.status}`);
  const locData = await locRes.json();

  const parts = (locData.records||[]).map(l=>{
    const f = l.fields||{};
    const rack = f.Rack || '';
    const row  = f.Row  || '';
    const nm   = f.Name || '';
    const qty  = qtyByLoc[l.id] || 0;
    const segs = [nm || [rack,row].filter(Boolean).join(' / ')].filter(Boolean);
    if (rack || row) segs.push([rack,row].filter(Boolean).join(' · '));
    if (qty) segs.push(`Qty ${qty}`);
    return segs.join(' — ');
  });

  const info = parts.join('  |  ');
  LOC_CACHE[wineId] = info;
  return info;
}

// ---------- RENDER ----------
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

  const html = records.map(rec=>{
    const f = rec.fields||{};
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
      f.Grape ? `🍇 ${getText(f.Grape)}` : null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null,
      // cellar pin (loads on demand)
      `<span class="badge badge-loc" data-wine="${rec.id}" title="Show cellar location">📍 cellar</span>`
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join(' ');

    const titleLine = `<b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}`;

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          ${titleLine}
          <div class="meta" style="margin-top:6px">${chips}</div>
        </div>
      </div>`;
  }).join('');

  return html || '<p class="badge">No matches.</p>';
}

// ---------- ADD WINE ----------
async function saveNewWine(){
  if (!S.base || !S.token){ alert('Set Base ID and Token first.'); return; }
  const modal = q('#add-modal');

  const name = q('#nw-name').value.trim();
  if (!name){ alert('Name is required'); return; }

  const payload = { fields: {} };
  const setF = (field, val) => { if (val!=='' && val!=null) payload.fields[field] = val; };

  setF('Name', name);
  setF('Producer', q('#nw-producer')?.value.trim());
  const v = q('#nw-vintage')?.value.trim();
  if (v) setF('Vintage', Number(v));
  setF('Country', q('#nw-country')?.value.trim());
  setF('Region', q('#nw-region')?.value.trim());
  setF('Grape', q('#nw-grape')?.value.trim());
  const price = q('#nw-price')?.value.trim();
  if (price) setF('Price', Number(price));
  const df = q('#nw-drink-from')?.value.trim();
  if (df) setF('Drinkable from', Number(df));
  const dt = q('#nw-drink-to')?.value.trim();
  if (dt) setF('Drinkable to', Number(dt));
  const labelUrl = q('#nw-label-url')?.value.trim();
  if (labelUrl) payload.fields['Label Image'] = [{ url: labelUrl }];

  try{
    // Create wine
    const wRes = await fetch(
      `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`,
      { method:'POST', headers: headers(), body: JSON.stringify(payload) }
    );
    const wJson = await wRes.json();
    if (!wRes.ok) throw new Error(wJson?.error?.message || `HTTP ${wRes.status}`);

    const wineId = wJson.id;

    // Optional inventory row
    const locStr = q('#nw-location')?.value.trim();
    const qtyStr = q('#nw-qty')?.value.trim();
    const qty = qtyStr ? Number(qtyStr) : 0;

    if (locStr){
      // Upsert Location by Name (simple): Name field store the free text; rack/row (optional) parsed from "Rack X Row Y"
      const locLookupUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
        + `?filterByFormula=${encodeURIComponent(`{Name}='${escAirtable(locStr)}'`)}&maxRecords=1`;
      const lkRes = await fetch(locLookupUrl, { headers: headers() });
      const lkJson = await lkRes.json();
      let locId = lkJson.records?.[0]?.id;

      if (!locId){
        // parse "Rack 1 Row 5"
        let rack = '', row = '';
        const mRack = locStr.match(/rack\s*([^\s]+)/i);
        const mRow  = locStr.match(/row\s*([^\s]+)/i);
        if (mRack) rack = mRack[1];
        if (mRow)  row  = mRow[1];

        const locPayload = { fields: { Name: locStr } };
        if (rack) locPayload.fields['Rack'] = rack;
        if (row)  locPayload.fields['Row']  = row;

        const cRes = await fetch(
          `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`,
          { method:'POST', headers: headers(), body: JSON.stringify(locPayload) }
        );
        const cJson = await cRes.json();
        if (!cRes.ok) throw new Error(cJson?.error?.message || `HTTP ${cRes.status}`);
        locId = cJson.id;
      }

      const invPayload = {
        fields: {
          'Wine (Link to Wines)': [wineId],
          'Location (Link to Locations)': [locId],
          'Quantity': qty
        }
      };
      const iRes = await fetch(
        `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`,
        { method:'POST', headers: headers(), body: JSON.stringify(invPayload) }
      );
      const iJson = await iRes.json();
      if (!iRes.ok) throw new Error(iJson?.error?.message || `HTTP ${iRes.status}`);
    }

    modal.classList.remove('open');
    toast('Wine added.');
    // optional: re-run search to reflect
    // search();

  }catch(err){
    alert(`Error: ${err.message}`);
  }
}

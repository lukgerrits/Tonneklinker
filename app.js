// ---- Tonneklinker app.js (v45) ----

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

    const addBtn = q('#btn-open-add');
    const addModal = q('#add-modal');
    const cancelBtn = q('#btn-cancel-add');
    const saveAddBtn = q('#btn-save-add');
    if (addBtn && addModal){
      addBtn.addEventListener('click', ()=> addModal.classList.add('open'));
    }
    if (cancelBtn && addModal){
      cancelBtn.addEventListener('click', ()=> addModal.classList.remove('open'));
    }
    if (saveAddBtn){
      saveAddBtn.addEventListener('click', ()=> saveNewWine());
    }

    _handlersBound = true;
  }

  loadInventory();
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
      return;
    }

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

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// ---------- RENDER ----------
function renderSearchCards(records){
  const getText = (val) => {
    if (val == null) return '';
    if (Array.isArray(val)) return val.map(getText).join(', ');
    if (typeof val === 'object') {
      if ('value' in val)   return String(val.value);
      if ('text' in val)    return String(val.text);
      if ('content' in val) return String(val.content);
      if ('name' in val)    return String(val.name);
      if ('url' in val)     return String(val.url);
      try { return Object.values(val).join(', '); } catch { return String(val); }
    }
    return String(val);
  };

  const flagMap = {
    Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸',
    Duitsland:'🇩🇪', Portugal:'🇵🇹', VerenigdeStaten:'🇺🇸', Zwitserland:'🇨🇭',
    België:'🇧🇪', Slovenië:'🇸🇮', Griekenland:'🇬🇷'
  };

  const html = (records||[]).map(rec => {
    const f = rec.fields || {};

    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label">` : '';

    const country = getText(f.Country);
    const region  = getText(f.Region);
    const flag    = flagMap[country] || '🌍';
    const countryRegion = [country ? (flag + ' ' + country) : '', region].filter(Boolean).join(' – ');

    const grapeVal = f.Grape ?? f.Grapes ?? f['Grape(s)'] ?? f['Druif'] ?? null;

    const chips = [
      countryRegion || null,
      grapeVal ? `🍇 ${getText(grapeVal)}` : null,
      f.Producer ? `🏷️ ${getText(f.Producer)}` : null,
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

// ---------- ADD NEW WINE ----------
async function saveNewWine(){
  const val = id => q(`#${id}`)?.value.trim();
  const modal = q('#add-modal');

  const name = val('nw-name');
  if (!name){ alert('Name is required.'); return; }

  const body = {
    fields: {
      Name: name,
      Producer: val('nw-producer') || undefined,
      Vintage: val('nw-vintage') ? Number(val('nw-vintage')) : undefined,
      Country: val('nw-country') || undefined,
      Region: val('nw-region') || undefined,
      Grape: val('nw-grape') || undefined,
      'Label Image': val('nw-label-url') ? [{ url: val('nw-label-url') }] : undefined,
      'Drinkable from': val('nw-drink-from') || undefined,
      'Drinkable to': val('nw-drink-to') || undefined,
      Price: val('nw-price') ? Number(val('nw-price')) : undefined
    }
  };

  try{
    const r = await fetch(`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!r.ok){
      const t = await r.text();
      throw new Error(`Error saving wine: HTTP ${r.status} ${t}`);
    }
    const data = await r.json();
    console.log('Saved wine:', data);
    alert('Wine saved successfully!');

    modal.classList.remove('open');
    loadInventory();
  }catch(err){
    alert(err.message);
  }
}

// ---------- INVENTORY ----------
async function loadInventory(){
  if (!S.base || !S.token) return;
  q('#inventory').innerHTML = '<p class="badge">Loading…</p>';
  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    if (!invData.records?.length){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      return;
    }

    const wineIDs = new Set();
    const locIDs  = new Set();
    for (const r of invData.records){
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    }

    async function fetchNameMap(table, ids){
      const arr = Array.from(ids);
      const map = {};
      for (let i = 0; i < arr.length; i += 50){
        const chunk = arr.slice(i, i+50);
        const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
        const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
        const res = await fetch(url, { headers: headers() });
        const json = await res.json();
        (json.records||[]).forEach(rec => map[rec.id] = rec.fields?.Name || rec.id);
      }
      return map;
    }

    const [wineMap, locMap] = await Promise.all([
      fetchNameMap(S.wines, wineIDs),
      fetchNameMap(S.loc, locIDs)
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

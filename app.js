// ---- Tonneklinker app.js (full, working) ----

// Local settings (persisted in localStorage)
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

// ---------- SETTINGS UI ----------
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
}

document.addEventListener('DOMContentLoaded', () => {
  // hydrate inputs
  const set = (id,val)=>{ const el=q(id); if(el) el.value=val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable', S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  const saveBtn = q('#btn-save'); if (saveBtn) saveBtn.addEventListener('click', saveSettings);
  const searchBtn = q('#btn-search'); if (searchBtn) searchBtn.addEventListener('click', search);
  const searchInput = q('#q'); if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

  loadInventory();
});

// ---------- SEARCH (hybrid: server first, fallback client-side) ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'')
    .normalize('NFD')                  // remove accents (é → e)
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

async function search(){
  const termEl = q('#q');
  const termRaw = (termEl ? termEl.value : '').trim();
  const out = q('#results');
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!termRaw){ out.innerHTML = ''; return; }

  const term = escAirtable(termRaw);
  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers() };

  // 1) Server-side formula (fast, but Airtable can be picky with blanks/accents)
  const within = "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing})";
  const formula = `SEARCH('${term}', ${within})`;
  const serverUrl = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
  console.log('SERVER SEARCH →', serverUrl);

  try{
    const r = await fetch(serverUrl, headersObj);
    const data = await r.json();
    if (Array.isArray(data.records) && data.records.length > 0){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }
  }catch(e){
    console.warn('Server search failed — falling back to client-side search:', e);
  }

  // 2) Client-side fallback (accent-insensitive)
  try{
    const fallbackUrl = `${baseUrl}?maxRecords=200`;
    console.log('CLIENT SEARCH →', fallbackUrl);
    const r2 = await fetch(fallbackUrl, headersObj);
    const data2 = await r2.json();
    const needle = norm(termRaw);
    const rows = (data2.records||[]).filter(rec=>{
      const f = rec.fields||{};
      const hay = norm([
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Taste, f['Food Pairing']
      ].filter(Boolean).join(' '));
      return hay.includes(needle);
    });
    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  }catch(err){
    out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
  }
}

// Renders rich wine cards (label image + all meta chips)
function renderSearchCards(records){
  const html = records.map(rec => {
    const f = rec.fields || {};
    const img = (f['Label Image'] && f['Label Image'][0]?.url)
      ? `<img src="${f['Label Image'][0].url}" class="label-img" alt="Label"/>` : '';

    const chips = [
      [f.Region, f.Country].filter(Boolean).join(' • ') || null,
      f.Grape || null,
      f.Taste || null,
      f['Food Pairing'] ? `🍽️ ${f['Food Pairing']}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[f['Drinkable from'], f['Drinkable to']].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`).join(' ');

    return `
      <div class="card wine-card">
        ${img}
        <div class="wine-info">
          <b>${f.Name || ''}</b>${f.Vintage ? ` — ${f.Vintage}` : ''}
          <div class="meta">${chips}</div>
        </div>
      </div>`;
  }).join('');

  return html || '<p class="badge">No matches.</p>';
}

// ---------- INVENTORY (resolve linked record IDs → Names) ----------
async function loadInventory(){
  if (!S.base || !S.token) return;

  try{
    // 1) Load inventory rows
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    if (!invData.records || invData.records.length === 0){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      return;
    }

    // 2) Collect unique IDs from linked fields
    const wineIDs = new Set();
    const locIDs  = new Set();
    for (const r of invData.records){
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    }

    // 3) Batch resolve names
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

    // 4) Render inventory cards with readable names
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

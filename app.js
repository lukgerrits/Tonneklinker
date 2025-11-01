// ---- Tonneklinker app.js (full) ----

// Persistent settings (localStorage)
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

const q = (s) => document.querySelector(s);
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

// ---- Settings UI ----
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
}

document.addEventListener('DOMContentLoaded', () => {
  // hydrate settings inputs
  const el = (id, val) => { const x = q(id); if (x) x.value = val; };
  el('#airtableBase', S.base);
  el('#airtableToken', S.token);
  el('#winesTable',   S.wines);
  el('#inventoryTable', S.inv);
  el('#locationsTable', S.loc);

  const saveBtn = q('#btn-save'); if (saveBtn) saveBtn.addEventListener('click', saveSettings);
  const searchBtn = q('#btn-search'); if (searchBtn) searchBtn.addEventListener('click', search);

  // initial load
  loadInventory();
});

// ---- Helpers for rich display ----
function fmtWindow(from, to){
  if (!from && !to) return '';
  if (from && to) return `${from} – ${to}`;
  return from ? `from ${from}` : `until ${to}`;
}
function fmtPrice(p){
  if (p == null || p === '') return '';
  const n = Number(p);
  return Number.isFinite(n) ? `€ ${n.toFixed(2)}` : String(p);
}

// ---- Search (rich result cards) ----
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }

async function search(){
  const termEl = document.querySelector('#q');
  const termRaw = (termEl ? termEl.value : '').trim();
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!termRaw){ document.querySelector('#results').innerHTML = ''; return; }

  const term = escAirtable(termRaw);
  const within = "{Name}&' '&{Vintage}&' '&{Country}&' '&{Region}&' '&{Grape}&' '&{Taste}&' '&{Food Pairing}";
  const formula = `SEARCH('${term}', ${within})`;
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  // DEBUG: print the exact URL so we can verify in Console/Network
  console.log('SEARCH URL →', url);

  try{
    const r = await fetch(url, { headers: headers() });
    const data = await r.json();

    const html = (data.records || []).map(rec => {
      const f = rec.fields || {};
      const img = (f['Label Image'] && f['Label Image'][0]?.url)
        ? `<img src="${f['Label Image'][0].url}" class="label-img" alt="Label"/>` : '';

      const chips = [
        [f.Region, f.Country].filter(Boolean).join(' • ') || null,
        f.Grape || null,
        f.Taste || null,
        f['Food Pairing'] ? `🍽️ ${f['Food Pairing']}` : null,
        (f['Drinkable from'] || f['Drinkable to']) ? `🕰️ ${[f['Drinkable from'], f['Drinkable to']].filter(Boolean).join(' – ')}` : null,
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

    document.querySelector('#results').innerHTML = html || '<p class="badge">No matches.</p>';
  }catch(err){
    document.querySelector('#results').innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
  }
}

// Bind both click and Enter
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.querySelector('#btn-search');
  const inp = document.querySelector('#q');
  if (btn) btn.addEventListener('click', search);
  if (inp) inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter') search(); });
});

// ---- Inventory (resolve linked IDs -> Names) ----
async function loadInventory(){
  if (!S.base || !S.token) return;

  try{
    // 1) Get inventory
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const invRes = await fetch(invUrl, { headers: headers() });
    const invData = await invRes.json();

    if (!invData.records || invData.records.length === 0){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      return;
    }

    // 2) Collect unique linked IDs
    const wineIDs = new Set();
    const locIDs  = new Set();
    for (const r of invData.records){
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
      (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
    }

    // 3) Batch fetch Names for Wines and Locations
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

    // 4) Render cards with readable names
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

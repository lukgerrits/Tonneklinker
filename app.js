
const S = {
  get base(){ return localStorage.getItem('tk_base')||''; },
  set base(v){ localStorage.setItem('tk_base', v); },
  get token(){ return localStorage.getItem('tk_token')||''; },
  set token(v){ localStorage.setItem('tk_token', v); },
  get wines(){ return localStorage.getItem('tk_wines')||'Wines'; },
  set wines(v){ localStorage.setItem('tk_wines', v); },
  get inv(){ return localStorage.getItem('tk_inv')||'Inventory'; },
  set inv(v){ localStorage.setItem('tk_inv', v); },
  get loc(){ return localStorage.getItem('tk_loc')||'Locations'; },
  set loc(v){ localStorage.setItem('tk_loc', v); },
};
function saveSettings(){
  S.base = document.getElementById('airtableBase').value.trim();
  S.token = document.getElementById('airtableToken').value.trim();
  S.wines = document.getElementById('winesTable').value.trim();
  S.inv = document.getElementById('inventoryTable').value.trim();
  S.loc = document.getElementById('locationsTable').value.trim();
  alert('Saved locally.');
}
document.getElementById('btn-save').addEventListener('click', saveSettings);

document.getElementById('airtableBase').value = S.base;
document.getElementById('airtableToken').value = S.token;
document.getElementById('winesTable').value = S.wines;
document.getElementById('inventoryTable').value = S.inv;
document.getElementById('locationsTable').value = S.loc;

const headers = ()=>({ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' });

async function search(){
  const q = document.getElementById('q').value.trim().toLowerCase();
  if(!S.base||!S.token){ alert('Set Base ID and Token in Settings.'); return; }
  const fieldsToSearch = "LOWER({Name}&' '&{Vintage}&' '&{Country}&' '&{Region}&' '&{Grape})";
  const formula = `FIND('${q}', ${fieldsToSearch})`;
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();
  const out = (data.records||[]).map(r=>`
    <div class="card"><b>${r.fields.Name||''}</b>${r.fields.Vintage?` — ${r.fields.Vintage}`:''}
    <br/><span class="badge">${[r.fields.Region, r.fields.Country].filter(Boolean).join(' • ')}</span></div>
  `).join('');
  document.getElementById('results').innerHTML = out || '<p class="badge">No matches.</p>';
}

async function loadInventory(){
  if(!S.base||!S.token) return;
  // ask Airtable to return human-readable strings for linked fields
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100&cellFormat=string`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  const out = (data.records||[]).map(rec => {
    const f = rec.fields;
    const wineName = f['Wine (Link to Wines)'] || '—';
    const locName  = f['Location (Link to Locations)'] || '—';
    const qty      = f.Quantity || 0;
    return `<div class="card">
      <b>${wineName}</b><br/>📍 ${locName} — Qty: ${qty}
    </div>`;
  }).join('');

  document.getElementById('inventory').innerHTML = out || '<p class="badge">No inventory yet.</p>';
}

  // 2. Collect all linked Wine + Location IDs
  const wineIDs = new Set();
  const locIDs = new Set();
  invData.records.forEach(r => {
    (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
    (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
  });

  // 3. Fetch names for all Wines and Locations
  async function fetchNames(table, ids) {
    if (ids.size === 0) return {};
    const filter = `OR(${Array.from(ids).map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(filter)}&fields[]=Name`;
    const res = await fetch(url, { headers: headers() });
    const json = await res.json();
    const map = {};
    json.records?.forEach(r => (map[r.id] = r.fields.Name));
    return map;
  }

  const [wineMap, locMap] = await Promise.all([
    fetchNames(S.wines, wineIDs),
    fetchNames(S.locs, locIDs)
  ]);

  // 4. Render Inventory cards
  const out = invData.records.map(rec => {
    const f = rec.fields;
    const wineName = (f['Wine (Link to Wines)'] || []).map(id => wineMap[id] || id).join(', ');
    const locName = (f['Location (Link to Locations)'] || []).map(id => locMap[id] || id).join(', ');
    const qty = f.Quantity || 0;
    return `<div class="card">
      <b>${wineName}</b><br/>📍 ${locName} — Qty: ${qty}
    </div>`;
  }).join('');

  document.getElementById('inventory').innerHTML = out;
}
loadInventory();

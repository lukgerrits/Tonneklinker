// ---- settings storage ----
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

const q = s => document.querySelector(s);
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type':'application/json' });

// ---- settings UI ----
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv = q('#inventoryTable').value.trim();
  S.loc = q('#locationsTable').value.trim();
  alert('Saved locally.');
}
document.addEventListener('DOMContentLoaded', () => {
  q('#airtableBase').value = S.base;
  q('#airtableToken').value = S.token;
  q('#winesTable').value = S.wines;
  q('#inventoryTable').value = S.inv;
  q('#locationsTable').value = S.loc;
  q('#btn-save').addEventListener('click', saveSettings);
});

// ---- search ----
async function search(){
  const term = q('#q').value.trim().toLowerCase();
  if(!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  const fields = "LOWER({Name}&' '&{Vintage}&' '&{Country}&' '&{Region}&' '&{Grape})";
  const formula = `FIND('${term}', ${fields})`;
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();
  q('#results').innerHTML = (data.records || []).map(r => `
    <div class="card"><b>${r.fields.Name || ''}</b>${r.fields.Vintage ? ` — ${r.fields.Vintage}` : ''}
    <br/><span class="badge">${[r.fields.Region, r.fields.Country].filter(Boolean).join(' • ')}</span></div>
  `).join('') || '<p class="badge">No matches.</p>';
}
document.addEventListener('DOMContentLoaded', () => {
  q('#btn-search').addEventListener('click', search);
});

// ---- inventory (show readable names) ----
async function loadInventory(){
  if (!S.base || !S.token) return;

  // 1) Get inventory (no cellFormat parameter)
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
  const invRes = await fetch(invUrl, { headers: headers() });
  const invData = await invRes.json();
  if (!invData.records || invData.records.length === 0) {
    document.getElementById('inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
    return;
  }

  // 2) Collect unique linked IDs
  const wineIDs = new Set();
  const locIDs  = new Set();
  for (const r of invData.records) {
    (r.fields['Wine (Link to Wines)'] || []).forEach(id => wineIDs.add(id));
    (r.fields['Location (Link to Locations)'] || []).forEach(id => locIDs.add(id));
  }

  // 3) Helper: fetch Name for batches of record IDs
  async function fetchNameMap(table, ids){
    const arr = Array.from(ids);
    const map = {};
    for (let i = 0; i < arr.length; i += 50) {       // batch to be safe
      const chunk = arr.slice(i, i+50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
      const res = await fetch(url, { headers: headers() });
      const json = await res.json();
      (json.records || []).forEach(rec => map[rec.id] = rec.fields?.Name || rec.id);
    }
    return map;
  }

  // 4) Build ID->Name maps for wines and locations
  const [wineMap, locMap] = await Promise.all([
    fetchNameMap(S.wines, wineIDs),
    fetchNameMap(S.loc,   locIDs)
  ]);

  // 5) Render
  const toText = v => Array.isArray(v) ? v.map(id => wineMap[id] || id).join(', ') : (v || '—');
  const toLoc  = v => Array.isArray(v) ? v.map(id => locMap[id]  || id).join(', ') : (v || '—');

  const html = invData.records.map(rec => {
    const f = rec.fields || {};
    const wine = toText(f['Wine (Link to Wines)']);
    const loc  = toLoc(f['Location (Link to Locations)']);
    const qty  = f.Quantity ?? 0;
    return `<div class="card"><b>${wine}</b><br/>📍 ${loc} — Qty: ${qty}</div>`;
  }).join('');

  document.getElementById('inventory').innerHTML = html;
}

// run after DOM loads (NO top-level await)
document.addEventListener('DOMContentLoaded', () => {
  loadInventory();
});

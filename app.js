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
  if(!S.base || !S.token) return;
  // ask Airtable to return strings for linked fields
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100&cellFormat=string`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();

  if(!data.records || data.records.length === 0){
    q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
    return;
  }

  const toText = v => Array.isArray(v) ? v.join(', ') : (v ?? '—');

  const out = data.records.map(rec => {
    const f = rec.fields || {};
    const wine = toText(f['Wine (Link to Wines)']);
    const loc  = toText(f['Location (Link to Locations)']);
    const qty  = f.Quantity ?? 0;
    return `<div class="card"><b>${wine}</b><br/>📍 ${loc} — Qty: ${qty}</div>`;
  }).join('');

  q('#inventory').innerHTML = out;
}

// run after DOM loads (NO top-level await)
document.addEventListener('DOMContentLoaded', () => {
  loadInventory();
});


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
  const q = document.getElementById('q').value.trim();
  if(!S.base||!S.token){ alert('Set Base ID and Token in Settings.'); return; }
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=FIND(LOWER('${q}'), LOWER({Name}&' '&{Producer}&' '&{Vintage}&' '&{Grape/Blend}))`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();
  const out = (data.records||[]).map(r=>`<div class="card"><b>${r.fields.Name||''}</b> — ${r.fields.Vintage||''}<br/><span class="badge">${r.fields.Producer||''}</span></div>`).join('');
  document.getElementById('results').innerHTML = out || '<p class="badge">No matches.</p>';
}
document.getElementById('btn-search').addEventListener('click', search);

async function loadInventory(){
  if(!S.base||!S.token) return;
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=50&sort[0][field]=Added On&sort[0][direction]=desc`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();
  const out = (data.records||[]).map(r=>{
    const f = r.fields;
    return `<div class="card">
      <b>${(f['Wine (Link to Wines)']||[]).join(', ')}</b>
      <div>📍 ${(f['Location (Link to Locations)']||[]).join(', ')} — Qty: ${f.Quantity||1}</div>
    </div>`;
  }).join('');
  document.getElementById('inventory').innerHTML = out || '<p class="badge">No inventory yet.</p>';
}
loadInventory();

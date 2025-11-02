// ---- Tonneklinker app.js (robust multi-word search + AI-field fix) ----

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

document.addEventListener('DOMContentLoaded', () => {
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

// ---------- SEARCH ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers() };
  const terms = raw.split(/\s+/).filter(Boolean);

  // ---- SERVER-SIDE ATTEMPT ----
  const concatFields = "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  // safer SEARCH: wrap each in ISERROR()=FALSE() to avoid formula breakage
  const formulaParts = terms.map(t => `NOT(ISERROR(SEARCH('${escAirtable(t)}', ${concatFields})))`);
  const formula = formulaParts.length === 1 ? formulaParts[0] : `AND(${formulaParts.join(',')})`;
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

  // ---- CLIENT-SIDE FALLBACK ----
  try{
    const r2 = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const data2 = await r2.json();
    const needles = terms.map(norm);
    const rows = (data2.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });
    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  }catch(err){
    out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
  }
}

// ---------- RENDER ----------
function countryFlag(name){
  if(!name) return '🌍';
  const n = String(name).toLowerCase();
  const map = {
    france:'🇫🇷', italy:'🇮🇹', spain:'🇪🇸', germany:'🇩🇪', portugal:'🇵🇹',
    'united states':'🇺🇸','usa':'🇺🇸','u.s.a.':'🇺🇸', chile:'🇨🇱', argentina:'🇦🇷',
    australia:'🇦🇺', 'new zealand':'🇳🇿', 'south africa':'🇿🇦', austria:'🇦🇹',
    'united kingdom':'🇬🇧','uk':'🇬🇧', greece:'🇬🇷', switzerland:'🇨🇭'
  };
  return map[n] || '🌍';
}
function grapeIcon(){ return '🍇'; }
function renderSearchCards(records){
  const getText = (val) => {
    if (val == null) return '';
    if (Array.isArray(val)){
      return val.map(v => {
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.name || v.text || v.content || v.url || '';
        return String(v);
      }).filter(Boolean).join(', ');
    }
    if (typeof val === 'object'){
      return val.name || val.text || val.content || val.url || '';
    }
    return String(val);
  };

  const html = records.map(rec => {
    const f = rec.fields || {};
    const imgUrl = Array.isArray(f['Label Image'])
      ? f['Label Image'][0]?.url
      : (f['Label Image']?.url || '');
    const labelImg = imgUrl ? `<img src="${imgUrl}" class="label-img" alt="Label"/>` : '';

    const countryTxt = getText(f.Country);
    const grapeTxt   = getText(f.Grape);
    const chips = [
      countryTxt ? `${countryFlag(countryTxt)} ${countryTxt}` : null,
      grapeTxt ? `${grapeIcon()} ${grapeTxt}` : null,
      getText(f.Taste) || null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Region || null),
      (f.Price !== '' && f.Price != null) ? `💶 € ${Number(f.Price).toFixed(2)}` : null
    ]
    .filter(Boolean)
    .map(x => `<span class="badge">${x}</span>`)
    .join(' ');

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

// ---------- INVENTORY ----------
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

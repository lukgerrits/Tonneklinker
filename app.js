// ---- Tonneklinker app.js (v25) ----

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

  // Cancel any previous request
  try { _searchAbort?.abort(); } catch(_) {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };
  const terms = raw.split(/\s+/).filter(Boolean);

  // Build a safe CONCAT of searchable fields
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

  // Server formula builder — strict AND or fallback OR
  function serverFormula(isOR){
    if (!terms.length) return '1=1';
    const pieces = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat})`);
    // SEARCH returns a number or blank; check if >0 for match
    return isOR
      ? `OR(${pieces.map(p => `${p}>0`).join(',')})`
      : `AND(${pieces.map(p => `${p}>0`).join(',')})`;
  }

  async function fetchServer(isOR){
    const formula = serverFormula(isOR);
    const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;
    const r = await fetch(url, headersObj);
    if (!r.ok){
      console.warn('Airtable error', r.status, await r.text().catch(()=>r.statusText));
      return { records: [] };
    }
    return r.json();
  }

  function clientFilter(records, isOR){
    const needles = terms.map(norm);
    return (records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name,f.Vintage,f.Country,f.Region,f.Grape,f.Taste,
        f['Food Pairing'],f['Drinkable from'],f['Drinkable to']
      ].filter(Boolean).join(' '));
      return isOR ? needles.some(t => hay.includes(t)) : needles.every(t => hay.includes(t));
    });
  }

  try {
    // --- 1️⃣ Try AND (strict) — SERVER first
    let data = await fetchServer(false);
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }

    // --- 2️⃣ Try AND (strict) — CLIENT fallback
    const allRes = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const allData = await allRes.json();
    let rows = clientFilter(allData.records, false);
    if (rows.length){
      out.innerHTML = renderSearchCards(rows);
      return;
    }

    // --- 3️⃣ Try OR (partial) only if nothing else matched
    data = await fetchServer(true);
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = `<p class="badge" style="margin-bottom:8px">Partial matches</p>` + renderSearchCards(data.records);
      return;
    }

    rows = clientFilter(allData.records, true);
    out.innerHTML = rows.length
      ? `<p class="badge" style="margin-bottom:8px">Partial matches</p>` + renderSearchCards(rows)
      : '<p class="badge">No matches.</p>';

  } catch (err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}
// ---------- RENDER ----------
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

// ---- Tonneklinker app.js v35 ----

/* ===============================
   SETTINGS (localStorage-backed)
   =============================== */
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

const q = sel => document.querySelector(sel);
const headers = () => ({
  'Authorization': 'Bearer ' + S.token,
  'Content-Type': 'application/json'
});

function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Settings saved locally.');
}

/* ==============
   BOOTSTRAP UI
   ============== */
document.addEventListener('DOMContentLoaded', () => {
  // restore inputs
  const set = (id,val)=>{ const el=q(id); if(el) el.value=val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable', S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  // handlers
  q('#btn-save')?.addEventListener('click', saveSettings);
  q('#btn-search')?.addEventListener('click', search);
  q('#q')?.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

  q('#btn-open-add')?.addEventListener('click', openModal);
  q('#btn-cancel-add')?.addEventListener('click', closeModal);
  q('#btn-save-add')?.addEventListener('click', saveNewWine);

  // initial data
  loadInventory();
});

/* ======================
   SEARCH (strict AND)
   ====================== */

// Airtable wants double-quoted strings in formulas.
// Also escape any embedded quotes.
function escAirtableDbl(s){
  return String(s ?? '').replace(/"/g, '""');
}

let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  // cancel any in-flight request
  try { _searchAbort?.abort(); } catch(_) {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };

  // tokens split by spaces; AND across all
  const terms = raw.split(/\s+/).filter(Boolean);

  // fields to search (concatenated text)
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

  // server-side strict AND using DOUBLE-QUOTED strings
  const pieces  = terms.map(t => `SEARCH("${escAirtableDbl(t)}", ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    // 1) Fast server-side AND
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }

    // 2) Client-side AND fallback (no OR)
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(s => s.toLowerCase());
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = [
        f.Name, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' ').toLowerCase();
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

/* =========================
   RENDER SEARCH RESULT CARDS
   ========================= */
function renderSearchCards(records){
  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷'
  };
  const getText = v => {
    if (v == null) return '';
    if (typeof v === 'object'){
      if (Array.isArray(v)) return v.map(getText).join(', ');
      // try common shapes from automations/AI fields, otherwise flatten
      if ('value' in v) return String(v.value);
      if ('text' in v)  return String(v.text);
      if ('content' in v) return String(v.content);
      if ('name' in v) return String(v.name);
      return Object.values(v).map(getText).join(', ');
    }
    return String(v);
  };

  return (records||[]).map(r=>{
    const f = r.fields || {};
    const img = Array.isArray(f['Label Image']) && f['Label Image'][0]?.url
      ? `<img src="${f['Label Image'][0].url}" class="label-img" alt="Label"/>`
      : '';

    const country = getText(f.Country);
    const flag = flagMap[country] || '🌍';

    const chips = [
      [flag + ' ' + country, getText(f.Region)].filter(Boolean).join(' – '),
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
        ${img}
        <div class="wine-info">
          <b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}
          <div class="meta">${chips}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* =========================
   INVENTORY (name mapping)
   ========================= */
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

    // collect linked IDs
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

/* ================
   ADD WINE MODAL
   ================ */
function openModal(){ q('#add-modal')?.classList.add('open'); }
function closeModal(){ q('#add-modal')?.classList.remove('open'); }

async function saveNewWine(){
  const name = q('#nw-name').value.trim();
  if (!name){ alert('Name is required'); return; }

  const body = {
    fields: {
      Name: name,
      Vintage: q('#nw-vintage').value.trim(),
      Country: q('#nw-country').value.trim(),
      Region: q('#nw-region').value.trim(),
      Grape: q('#nw-grape').value.trim(),
      'Label Image': q('#nw-label-url').value ? [{ url: q('#nw-label-url').value }] : undefined,
      'Drinkable from': q('#nw-drink-from').value.trim(),
      'Drinkable to': q('#nw-drink-to').value.trim(),
      Price: q('#nw-price').value ? Number(q('#nw-price').value) : undefined
    }
  };

  try{
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
    const r = await fetch(url, { method:'POST', headers: headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    alert('Wine added successfully!');
    closeModal();
    // optional: refresh search/inventory views
    const qVal = q('#q')?.value?.trim();
    if (qVal) search(); else loadInventory();
  }catch(e){
    alert('Error saving wine: ' + e.message);
  }
}

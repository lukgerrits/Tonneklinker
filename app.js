// ---- Tonneklinker app.js (v46) ----

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

const q = sel => document.querySelector(sel);
const headers = () => ({ 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json' });

// Map: wineRecordId -> array of { rack, row, qty, locName }
let INV_BY_WINE = new Map();

document.addEventListener('DOMContentLoaded', () => {
  // Prefill settings
  const set = (id, val) => { const el = q(id); if (el) el.value = val; };
  set('#airtableBase', S.base);
  set('#airtableToken', S.token);
  set('#winesTable', S.wines);
  set('#inventoryTable', S.inv);
  set('#locationsTable', S.loc);

  // Events
  q('#btn-save')?.addEventListener('click', e => { e.preventDefault(); saveSettings(); });
  q('#btn-search')?.addEventListener('click', e => { e.preventDefault(); search(); });
  q('#q')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); }});

  q('#btn-open-add')?.addEventListener('click', () => q('#add-modal').classList.add('open'));
  q('#btn-cancel-add')?.addEventListener('click', () => q('#add-modal').classList.remove('open'));
  q('#btn-save-add')?.addEventListener('click', saveNewWine);

  // Click on 📍 badge -> toast
  document.addEventListener('click', e => {
    const pin = e.target.closest('.badge-loc');
    if (!pin) return;
    const tip = pin.getAttribute('title') || 'No location info';
    toast(tip);
  });

  loadInventory();
});

function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
}

function toast(msg){
  const el = q('#tk-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(()=> el.style.opacity = '0', 2200);
}

// ---------- SEARCH (AND only) ----------
async function search(){
  const term = (q('#q')?.value || '').trim();
  const out = q('#results');
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!term){ out.innerHTML = ''; return; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;

  // Search fields (AND). Include Producer and Grape as asked.
  const concat =
    "CONCATENATE({Name},' ',{Producer},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";

  // AND each token with SEARCH > 0
  const parts = term.split(/\s+/).filter(Boolean).map(t => {
    const safe = t.replace(/'/g, "''");
    return `SEARCH('${safe}', ${concat}) > 0`;
  });
  const formula = parts.length ? `AND(${parts.join(',')})` : '1=1';
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, { headers: headers() });
    const data = await r.json();
    out.innerHTML = renderSearchCards(data.records || []);
  }catch(err){
    out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
  }
}

// ---------- RENDER SEARCH ----------
function renderSearchCards(records){
  if (!records.length) return '<p class="badge">No matches.</p>';

  const flagMap = {
    Frankrijk:'🇫🇷', Italië:'🇮🇹', Spanje:'🇪🇸', Duitsland:'🇩🇪', Portugal:'🇵🇹',
    België:'🇧🇪', Oostenrijk:'🇦🇹', Zwitserland:'🇨🇭', Griekenland:'🇬🇷'
  };

  return records.map(rec => {
    const f = rec.fields || {};
    const flag = flagMap[f.Country] || '🌍';

    // Location pin from inventory map
    const locs = INV_BY_WINE.get(rec.id) || [];
    let pin = '';
    if (locs.length){
      const t = locs.map(l => `${l.rack || ''} ${l.row || ''} — Qty ${l.qty}`).join('; ');
      pin = `<span class="badge badge-loc" title="${t}">📍</span>`;
    }

    const chips = [
      `<span class="badge">${flag} ${f.Country || ''} – ${f.Region || ''}</span>`,
      f.Grape ? `<span class="badge">🍇 ${f.Grape}</span>` : '',
      f.Producer ? `<span class="badge">🏷️ ${f.Producer}</span>` : '',
      pin
    ].filter(Boolean).join(' ');

    const taste = f.Taste ? `<div class="badge" style="display:block;margin-top:10px">👅 ${f.Taste}</div>` : '';
    const food  = f['Food Pairing'] ? `<div class="badge" style="display:block;margin-top:6px">🍽️ ${f['Food Pairing']}</div>` : '';
    const window = (f['Drinkable from'] || f['Drinkable to'])
      ? `<span class="badge" style="margin-top:8px;display:inline-block">🕰️ ${(f['Drinkable from']||'')} – ${(f['Drinkable to']||'')}</span>` : '';
    const price = (f.Price != null && f.Price !== '')
      ? `<span class="badge" style="margin-top:8px;display:inline-block">💶 € ${Number(f.Price).toFixed(2)}</span>` : '';

    return `
      <div class="card wine-card">
        <div class="wine-info">
          <b>${f.Name || ''}</b>${f.Vintage ? ` — ${f.Vintage}` : ''}
          <div class="meta" style="margin-top:6px">${chips}</div>
          ${taste}
          ${food}
          <div style="margin-top:6px">${window} ${price}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------- ADD WINE ----------
async function saveNewWine(){
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }

  const g = id => q(`#${id}`)?.value.trim() || '';
  const vintageNum = g('nw-vintage') ? Number(g('nw-vintage')) : undefined;
  const priceNum   = g('nw-price')   ? Number(g('nw-price'))   : undefined;

  const body = {
    fields: {
      Name: g('nw-name') || undefined,
      Producer: g('nw-producer') || undefined,
      Vintage: isFinite(vintageNum) ? vintageNum : undefined,
      Country: g('nw-country') || undefined,
      Region:  g('nw-region')  || undefined,
      Grape:   g('nw-grape')   || undefined,
      'Label Image': g('nw-label-url') ? [{ url: g('nw-label-url') }] : undefined,
      'Drinkable from': g('nw-drink-from') || undefined,
      'Drinkable to':   g('nw-drink-to')   || undefined,
      Price: isFinite(priceNum) ? priceNum : undefined
    }
  };

  try{
    // 1) Create wine
    const wineRes = await fetch(
      `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`,
      { method:'POST', headers: headers(), body: JSON.stringify(body) }
    );
    if (!wineRes.ok){
      const txt = await wineRes.text();
      alert(`Error saving wine: HTTP ${wineRes.status}\n${txt}`);
      return;
    }
    const wine = await wineRes.json();
    const wineId = wine?.id;

    // 2) Optional inventory
    const qty = g('nw-qty') ? Number(g('nw-qty')) : undefined;
    const locName = g('nw-location');
    if (wineId && (qty || locName)){
      // Find location by Name (must exist in Locations)
      let locId = undefined;
      if (locName){
        const f = `FIND('${locName.replace(/'/g,"''")}',{Name})>0`;
        const u = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(f)}&maxRecords=1`;
        const lr = await fetch(u, { headers: headers() });
        const lj = await lr.json();
        locId = lj.records?.[0]?.id;
      }

      const invBody = {
        fields: {
          'Wine (Link to Wines)': [wineId],
          'Location (Link to Locations)': locId ? [locId] : undefined,
          Quantity: isFinite(qty) ? qty : undefined
        }
      };
      await fetch(`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`, {
        method:'POST', headers: headers(), body: JSON.stringify(invBody)
      });
    }

    alert('Wine added!');
    q('#add-modal')?.classList.remove('open');
    loadInventory();
  }catch(err){
    alert(`Save error: ${err.message}`);
  }
}

// ---------- INVENTORY (no locations here) ----------
async function loadInventory(){
  if (!S.base || !S.token) return;

  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=200`;
    const res = await fetch(invUrl, { headers: headers() });
    const data = await res.json();

    if (!Array.isArray(data.records) || !data.records.length){
      q('#inventory').innerHTML = '<p class="badge">No inventory yet.</p>';
      return;
    }

    // Build location map keyed by wine id for search tooltips
    INV_BY_WINE.clear();
    for (const rec of data.records){
      const f = rec.fields || {};
      const wineIds = f['Wine (Link to Wines)'] || [];
      const qty = f.Quantity ?? 0;

      // Optional Rack / Row fields if you store them in Inventory
      const rack = f.Rack || '';
      const row  = f.Row  || '';
      for (const w of wineIds){
        const arr = INV_BY_WINE.get(w) || [];
        arr.push({ rack, row, qty });
        INV_BY_WINE.set(w, arr);
      }
    }

    // Render list: wine id -> name lookup
    // Quick lookup names for first 50 unique wine IDs shown
    const uniqueIds = [...INV_BY_WINE.keys()];
    const showIds = new Set();
    data.records.forEach(r => {
      (r.fields['Wine (Link to Wines)'] || []).forEach(id => showIds.add(id));
    });
    const idList = [...showIds].slice(0, 50);

    const nameMap = await fetchNames(S.wines, idList);
    const out = data.records.map(r => {
      const f = r.fields || {};
      const firstId = (f['Wine (Link to Wines)'] || [])[0];
      const wineName = nameMap[firstId] || firstId || '(Unknown wine)';
      const qty = f.Quantity ?? 0;
      return `<div class="card"><b>${wineName}</b><br/>Qty: ${qty}</div>`;
    }).join('');

    q('#inventory').innerHTML = out || '<p class="badge">No inventory yet.</p>';
  }catch(err){
    q('#inventory').innerHTML = `<p class="badge">Inventory error: ${err.message}</p>`;
  }
}

async function fetchNames(table, ids){
  const map = {};
  if (!ids.length) return map;
  for (let i=0;i<ids.length;i+=50){
    const chunk = ids.slice(i, i+50);
    const f = `OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const u = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(f)}&fields[]=Name&maxRecords=50`;
    const r = await fetch(u, { headers: headers() });
    const j = await r.json();
    (j.records||[]).forEach(rec => map[rec.id] = rec.fields?.Name || rec.id);
  }
  return map;
}

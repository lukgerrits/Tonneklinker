// ---- Tonneklinker app.js v31 ----

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

// --- SETTINGS ---
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Settings saved locally.');
}

document.addEventListener('DOMContentLoaded', ()=>{
  // Restore saved values
  q('#airtableBase').value = S.base;
  q('#airtableToken').value = S.token;
  q('#winesTable').value = S.wines;
  q('#inventoryTable').value = S.inv;
  q('#locationsTable').value = S.loc;

  q('#btn-save')?.addEventListener('click', saveSettings);
  q('#btn-search')?.addEventListener('click', search);
  q('#q')?.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

  q('#btn-open-add')?.addEventListener('click', ()=> openModal());
  q('#btn-cancel-add')?.addEventListener('click', ()=> closeModal());
  q('#btn-save-add')?.addEventListener('click', ()=> saveNewWine());

  loadInventory();
});

// --- SEARCH ---
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }

let _searchAbort;
async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  try{ _searchAbort?.abort(); }catch(_){}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };
  const terms = raw.split(/\s+/).filter(Boolean);
  const concat = "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const formula = `AND(${terms.map(t=>`SEARCH('${escAirtable(t)}', ${concat})`).join(',')})`;
  const url = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try {
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
    } else {
      out.innerHTML = '<p class="badge">No matches.</p>';
    }
  } catch (err){
    if (err.name !== 'AbortError') out.innerHTML = `<p class="badge">Error: ${err.message}</p>`;
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// --- RENDER RESULTS ---
function renderSearchCards(records){
  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷', Oosten: '🌍'
  };
  const getText = v => (typeof v === 'object' ? (Array.isArray(v) ? v.map(getText).join(', ') : Object.values(v).join(', ')) : v ?? '');

  return records.map(r=>{
    const f = r.fields || {};
    const img = f['Label Image']?.[0]?.url ? `<img src="${f['Label Image'][0].url}" class="label-img" alt="Label"/>` : '';
    const country = getText(f.Country);
    const flag = flagMap[country] || '🌍';
    const chips = [
      [flag + ' ' + country, f.Region].filter(Boolean).join(' – '),
      f.Grape || null,
      f.Taste ? `👅 ${f.Taste}` : null,
      f['Food Pairing'] ? `🍽️ ${f['Food Pairing']}` : null,
      (f['Drinkable from'] || f['Drinkable to']) ? `🕰️ ${[f['Drinkable from'], f['Drinkable to']].filter(Boolean).join(' – ')}` : null,
      f.Price ? `💶 € ${Number(f.Price).toFixed(2)}` : null
    ].filter(Boolean).map(x=>`<span class="badge">${x}</span>`).join(' ');
    return `<div class="card wine-card">${img}<div class="wine-info"><b>${f.Name||''}</b>${f.Vintage?` — ${f.Vintage}`:''}<div class="meta">${chips}</div></div></div>`;
  }).join('');
}

// --- INVENTORY ---
async function loadInventory(){
  if (!S.base || !S.token) return;
  try{
    const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const r = await fetch(invUrl, { headers: headers() });
    const d = await r.json();
    if (!d.records?.length){ q('#inventory').innerHTML='<p class="badge">No inventory yet.</p>'; return; }
    const out = d.records.map(r=>{
      const f=r.fields||{};
      const wine=f['Wine (Link to Wines)']?.[0]||'—';
      const loc=f['Location (Link to Locations)']?.[0]||'—';
      const qty=f.Quantity??0;
      return `<div class="card"><b>${wine}</b><br/>📍 ${loc} — Qty: ${qty}</div>`;
    }).join('');
    q('#inventory').innerHTML=out;
  }catch(e){ q('#inventory').innerHTML=`<p class="badge">Error: ${e.message}</p>`; }
}

// --- MODAL ---
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
      Price: Number(q('#nw-price').value) || undefined
    }
  };

  try {
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
    const r = await fetch(url, { method:'POST', headers: headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    alert('Wine added successfully!');
    closeModal();
    search(); // refresh search if open
  } catch(e){
    alert('Error saving wine: ' + e.message);
  }
}

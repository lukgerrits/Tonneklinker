// ---- Tonneklinker app.js (v48) ----

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

    // Add Wine modal
    const modal = q('#add-modal');
    q('#btn-open-add')?.addEventListener('click', ()=>{
      modal.style.display = 'block';
      modal.setAttribute('aria-hidden','false');
    });
    q('#btn-cancel-add')?.addEventListener('click', ()=>{
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden','true');
    });
    q('#btn-save-add')?.addEventListener('click', saveNewWine);

    _handlersBound = true;
  }

  // (No inventory list to load anymore)
});

// ---------- UTIL ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){
  return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
}
function chip(text){ return `<span class="badge">${text}</span>`; }
function euro(p){
  if (p == null || p === '') return '';
  const n = Number(p);
  return isFinite(n) ? `€ ${n.toFixed(2)}` : p;
}

// ---------- SEARCH ----------
let _searchAbort;

async function search(){
  const termEl = q('#q');
  const raw = (termEl ? termEl.value : '').trim();
  const out = q('#results');

  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if (!raw){ out.innerHTML = ''; return; }

  try { _searchAbort?.abort(); } catch(_) {}
  _searchAbort = new AbortController();

  const btn = q('#btn-search');
  if (btn){ btn.disabled = true; btn.textContent = 'Searching…'; }

  const baseUrl   = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const headersObj = { headers: headers(), signal: _searchAbort.signal };
  const terms = raw.split(/\s+/).filter(Boolean);

  const concat =
    "CONCATENATE(" +
      "{Name},' '," +
      "{Producer},' '," +
      "{Vintage},' '," +
      "{Country},' '," +
      "{Region},' '," +
      "{Grape},' '," +
      "{Taste},' '," +
      "{Food Pairing},' '," +
      "{Drinkable from},' '," +
      "{Drinkable to}" +
    ")";

  // AND search (server)
  const pieces  = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      bindCellarChips(data.records);
      return;
    }

    // Client-side AND fallback
    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name, f.Producer, f.Vintage, f.Country, f.Region, f.Grape, f.Taste,
        f['Food Pairing'], f['Drinkable from'], f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });

    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    if (rows.length) bindCellarChips(rows);

  }catch(err){
    if (err.name !== 'AbortError'){
      console.error(err);
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// ---------- RENDER ----------
function getText(val){
  if (val == null) return '';
  if (typeof val === 'object'){
    if (Array.isArray(val)) return val.map(v => getText(v)).join(', ');
    if (val.value) return val.value;
    if (val.text) return val.text;
    if (val.content) return val.content;
    if (val.name) return val.name;
    if (val.url) return val.url;
    return Object.values(val).join(', ');
  }
  return String(val);
}

function renderSearchCards(records){
  const flagMap = {
    Frankrijk: '🇫🇷', Italië: '🇮🇹', Oostenrijk: '🇦🇹', Spanje: '🇪🇸',
    Duitsland: '🇩🇪', Portugal: '🇵🇹', VerenigdeStaten: '🇺🇸', Zwitserland: '🇨🇭',
    België: '🇧🇪', Slovenië: '🇸🇮', Griekenland: '🇬🇷'
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

    const topLine = `<b>${getText(f.Name) || ''}</b>${f.Vintage ? ` — ${getText(f.Vintage)}` : ''}`;

    const chips = [
      countryRegion || null,
      f.Producer ? `🏷️ ${getText(f.Producer)}` : null,
      f.Grape ? `🍇 ${getText(f.Grape)}` : null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to'])
        ? `🕰️ ${[getText(f['Drinkable from']), getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`
        : null,
      (f.Price !== '' && f.Price != null) ? `💶 ${euro(f.Price)}` : null,
      `<span class="badge cellar-chip" data-wine="${rec.id}" style="cursor:pointer;">📍 cellar</span>`
    ].filter(Boolean).map(x => `<span class="badge">${x}</span>`.replace('<span class="badge"><span class="badge','<span class="badge')).join(' ');

    // NOTE: The cellar chip already includes its own class/attributes
    const chipsHtml = chips.replace(
      '<span class="badge"><span class="badge cellar-chip"',
      '<span class="badge cellar-chip"'
    );

    return `
      <div class="card wine-card">
        ${labelImg}
        <div class="wine-info">
          ${topLine}
          <div class="meta">${chipsHtml}</div>
        </div>
      </div>`;
  }).join('');

  return html || '<p class="badge">No matches.</p>';
}

// ---------- CELLAR LOOKUP (for search cards) ----------
function bindCellarChips(records){
  const chips = document.querySelectorAll('.cellar-chip');
  const tooltip = q('#cellar-tooltip');

  function hideTip(){ tooltip.style.display='none'; }

  chips.forEach(chip => {
    const wineId = chip.getAttribute('data-wine');
    let cachedHtml = null;

    const show = async (evt) => {
      if (!cachedHtml){
        cachedHtml = await cellarInfoHtmlForWine(wineId);
        if (!cachedHtml) {
          // nothing to show: keep silent
          return;
        }
      }
      tooltip.innerHTML = cachedHtml;
      const rect = chip.getBoundingClientRect();
      tooltip.style.left = `${rect.left + window.scrollX}px`;
      tooltip.style.top  = `${rect.bottom + window.scrollY + 6}px`;
      tooltip.style.display = 'inline-block';
    };

    chip.addEventListener('mouseenter', show);
    chip.addEventListener('mouseleave', hideTip);
    chip.addEventListener('click', (e)=>{ e.stopPropagation(); show(e); });
  });

  document.addEventListener('scroll', ()=>{ tooltip.style.display='none'; }, { passive:true });
  document.addEventListener('click', (e)=>{
    if (!e.target.classList.contains('cellar-chip')){
      tooltip.style.display='none';
    }
  });
}

async function cellarInfoHtmlForWine(wineId){
  // 1) Find Inventory rows that include this wineId in link field
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`
    + `?filterByFormula=${encodeURIComponent(`FIND('${wineId}', ARRAYJOIN({Wine (Link to Wines)}))`)}`;
  const rInv = await fetch(invUrl, { headers: headers() });
  if (!rInv.ok) return '';
  const dataInv = await rInv.json();
  const invRecs = dataInv.records || [];
  if (!invRecs.length) return '';

  // Gather all location IDs
  const locIds = [];
  invRecs.forEach(rec=>{
    const ids = rec.fields['Location (Link to Locations)'] || [];
    ids.forEach(id => { if (!locIds.includes(id)) locIds.push(id); });
  });

  // 2) If locations, fetch their details (Name, Rack, Row)
  let locMap = {};
  if (locIds.length){
    for (let i=0; i<locIds.length; i+=50){
      const chunk = locIds.slice(i,i+50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&fields[]=Rack&fields[]=Row&maxRecords=50`;
      const r = await fetch(url, { headers: headers() });
      const j = await r.json();
      (j.records || []).forEach(rec => {
        locMap[rec.id] = {
          name: rec.fields?.Name || '',
          rack: rec.fields?.Rack || '',
          row:  rec.fields?.Row  || ''
        };
      });
    }
  }

  // 3) Build HTML list
  const rows = invRecs.map(r=>{
    const qty = r.fields?.Quantity ?? 0;
    const ids = r.fields['Location (Link to Locations)'] || [];
    const parts = ids.map(id=>{
      const L = locMap[id] || {};
      const label = [L.name, L.rack ? `Rack ${L.rack}`:'', L.row ? `Row ${L.row}`:'']
                    .filter(Boolean).join(' • ');
      return label || id;
    });
    return `📍 ${parts.join(', ')} — Qty: ${qty}`;
  });

  return rows.length ? rows.map(chip).join('<br>') : '';
}

// ---------- ADD WINE ----------
async function saveNewWine(){
  if (!S.base || !S.token){ alert('Set Base ID and Token in Settings first.'); return; }

  // Collect fields
  const name = q('#nw-name').value.trim();
  if (!name){ alert('Name is required.'); return; }

  const fields = {};
  const setIf = (k, sel, coerce) => {
    const el = q(sel);
    if (!el) return;
    const v = el.value.trim();
    if (v === '') return;
    fields[k] = coerce ? coerce(v) : v;
  };

  const toInt = v => {
    const n = parseInt(v,10);
    return isFinite(n) ? n : undefined;
  };
  const toFloat = v => {
    const n = parseFloat(v);
    return isFinite(n) ? n : undefined;
  };

  fields['Name'] = name;
  setIf('Vintage', '#nw-vintage', toInt);
  setIf('Producer', '#nw-producer');
  setIf('Country', '#nw-country');
  setIf('Region', '#nw-region');
  setIf('Grape', '#nw-grape');
  setIf('Price', '#nw-price', toFloat);
  setIf('Drinkable from', '#nw-drink-from', toInt);
  setIf('Drinkable to', '#nw-drink-to', toInt);

  const labelUrl = q('#nw-label-url')?.value.trim();
  if (labelUrl){
    fields['Label Image'] = [{ url: labelUrl }];
  }

  // 1) Create wine
  const createWineUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const rWine = await fetch(createWineUrl, {
    method:'POST',
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }] })
  });

  if (!rWine.ok){
    const t = await rWine.text();
    alert(`Error saving wine: ${rWine.status}\n${t}`);
    return;
  }
  const wineRes = await rWine.json();
  const wineId = wineRes.records?.[0]?.id;

  // 2) Optional inventory row
  const locText = q('#nw-location')?.value.trim();
  const qtyVal  = q('#nw-qty')?.value.trim();
  if (wineId && (locText || qtyVal)){
    // Create or find the Location by Name (and Rack/Row parsed)
    // Accept: "Rack 1 Row 5" or "Rack 1 – Row 5" or just "Rack 1"
    let rack='', row='';
    if (locText){
      const mRack = locText.match(/rack\s*([^\s–]+)/i);
      const mRow  = locText.match(/row\s*([^\s–]+)/i);
      rack = mRack ? mRack[1] : '';
      row  = mRow  ? mRow[1]  : '';
    }
    const locName = locText || 'Unnamed location';

    // Try to find existing location by exact Name, Rack, Row
    const findUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`
      + `?filterByFormula=${encodeURIComponent(
        `AND({Name}='${escAirtable(locName)}'${rack?`,{Rack}='${escAirtable(rack)}'`:''}${row?`,{Row}='${escAirtable(row)}'`:''})`
      )}&maxRecords=1`;
    const rFind = await fetch(findUrl, { headers: headers() });
    const jFind = await rFind.json();
    let locId = jFind.records?.[0]?.id;

    if (!locId){
      // Create new Location
      const rCreateLoc = await fetch(
        `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`,
        {
          method:'POST',
          headers: headers(),
          body: JSON.stringify({ records: [{ fields: { Name: locName, ...(rack?{Rack:rack}:{}) , ...(row?{Row:row}:{}) } }] })
        }
      );
      const jCL = await rCreateLoc.json();
      locId = jCL.records?.[0]?.id;
    }

    if (locId){
      const qty = parseInt(qtyVal,10);
      const invFields = {
        'Wine (Link to Wines)': [wineId],
        ...(locId ? { 'Location (Link to Locations)': [locId] } : {}),
        ...(isFinite(qty) ? { Quantity: qty } : {})
      };
      const rInv = await fetch(
        `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`,
        {
          method:'POST',
          headers: headers(),
          body: JSON.stringify({ records: [{ fields: invFields }] })
        }
      );
      if (!rInv.ok){
        const t2 = await rInv.text();
        alert(`Wine saved, but inventory failed: ${rInv.status}\n${t2}`);
      }
    }
  }

  // Close modal & clear fields
  q('#add-modal').style.display='none';
  q('#add-modal').setAttribute('aria-hidden','true');
  ['#nw-name','#nw-vintage','#nw-producer','#nw-country','#nw-region','#nw-grape',
   '#nw-label-url','#nw-price','#nw-drink-from','#nw-drink-to','#nw-location','#nw-qty'
  ].forEach(sel => { const el=q(sel); if(el) el.value=''; });

  // Trigger search again to show the new record if relevant
  search();
}

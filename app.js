// ─── Tonneklinker app.js v57 ────────────────────────────────────────────────

// Local settings
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

// Airtable helpers
const q = s => document.querySelector(s);
const headers = () => ({ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' });
const esc = s => String(s||'').replace(/'/g,"''");
const norm = s => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();

// Icons
const flag = { Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸', Duitsland:'🇩🇪', Portugal:'🇵🇹', België:'🇧🇪' };
const ICON_PRODUCER = '🏷️'; // brown label/card icon
const ICON_TASTE    = '🍷';
const ICON_GRAPE    = '🍇';

// Global caches for map + tooltip
let inventoryRecords = [];     // raw inventory
let locationsMap     = {};     // { locId: {Name,Rack,Row,Column} }
let wineNameMap      = {};     // { wineId: Name }
let inventoryByCell  = new Map(); // key "rack:row:col" -> [{wine, qty}]
let positionsByWine  = new Map(); // wineId -> [{rack,row,col,qty}]

// Settings + modal wiring
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
  refreshDataThenRender();
}

document.addEventListener('DOMContentLoaded', () => {
  [['#airtableBase',S.base],['#airtableToken',S.token],['#winesTable',S.wines],['#inventoryTable',S.inv],['#locationsTable',S.loc]]
    .forEach(([id,val])=>{ const el=q(id); if(el) el.value=val; });

  q('#btn-save')?.addEventListener('click', e=>{e.preventDefault(); saveSettings();});
  q('#btn-search')?.addEventListener('click', e=>{e.preventDefault(); search();});
  q('#q')?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); search(); }});

  q('#btn-open-add')?.addEventListener('click', ()=> q('#add-modal').style.display='flex');
  q('#btn-cancel-add')?.addEventListener('click', ()=> q('#add-modal').style.display='none');
  q('#btn-save-add')?.addEventListener('click', addWineFlow);

  refreshDataThenRender();
});

async function refreshDataThenRender(){
  await loadInventoryAndLocations();
  buildCellarMap();
}

// ── SEARCH (server AND, client AND fallback) ────────────────────────────────
let _abort;
async function search(){
  const term = (q('#q')?.value||'').trim();
  const out = q('#results');
  if(!S.base||!S.token){ alert('Set Base ID and Token in Settings.'); return; }
  if(!term){ out.innerHTML=''; return; }

  try{ _abort?.abort(); }catch(_){}
  _abort = new AbortController();

  const btn = q('#btn-search'); if(btn){ btn.disabled=true; btn.textContent='Searching…'; }

  // server AND search
  const baseUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
  const concat =
    "CONCATENATE({Name},' ',{Producer},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const terms = term.split(/\s+/).filter(Boolean);
  const pieces = terms.map(t => `SEARCH('${esc(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, {headers:headers(), signal:_abort.signal});
    const data = await r.json();
    if(Array.isArray(data.records) && data.records.length){
      renderSearchCards(data.records);
    }else{
      // client AND fallback (accent-insensitive)
      const all = await (await fetch(`${baseUrl}?maxRecords=200`, {headers:headers(), signal:_abort.signal})).json();
      const needles = terms.map(norm);
      const rows = (all.records||[]).filter(rec=>{
        const f=rec.fields||{};
        const hay = norm([f.Name,f.Producer,f.Vintage,f.Country,f.Region,f.Grape,f.Taste,f['Food Pairing'],f['Drinkable from'],f['Drinkable to']]
          .filter(Boolean).join(' '));
        return needles.every(t => hay.includes(t));
      });
      renderSearchCards(rows);
    }
  }catch(e){
    if(e.name!=='AbortError') q('#results').innerHTML = `<p class="badge">Search error: ${e.message}</p>`;
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Search'; }
  }
}

function renderSearchCards(records){
  const out = q('#results');
  if(!records.length){ out.innerHTML = '<p class="badge">No matches.</p>'; return; }

  // Build cards HTML (meta gets an id so we can append the cellar chip with JS)
  const html = records.map(rec=>{
    const f = rec.fields||{};
    const img = (Array.isArray(f['Label Image']) && f['Label Image'][0]?.url)
      ? `<img src="${f['Label Image'][0].url}" class="label" alt="Label">` : '';

    const flagStr = [flag[f.Country]||'🌍', f.Country, '–', f.Region].filter(Boolean).join(' ');

    const chips = [
      flagStr || null,
      f.Producer ? `${ICON_PRODUCER} ${f.Producer}` : null,      // 🏷️ Producer
      f.Grape ? `${ICON_GRAPE} ${f.Grape}` : null,               // 🍇 Grape
      f.Taste ? `${ICON_TASTE} ${getText(f.Taste)}` : null,      // 🍷 Taste
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to']) ? `🕰️ ${fmtWindow(f['Drinkable from'], f['Drinkable to'])}` : null,
      (f.Price!=='' && f.Price!=null) ? `💶 ${fmtPrice(f.Price)}` : null
    ].filter(Boolean).map(x=>`<span class="chip">${x}</span>`).join(' ');

    // meta container id to attach cellar chip with tooltip
    const metaId = `meta-${rec.id}`;

    return `
      <div class="card wine-card">
        ${img}
        <div class="wine-info">
          <b>${f.Name||''}</b>${f.Vintage?` — ${f.Vintage}`:''}
          <div class="meta" id="${metaId}">${chips}</div>
        </div>
      </div>`;
  }).join('');

  out.innerHTML = html;

  // Append the “📍 cellar” chip with tooltip + highlighting
  records.forEach(rec=>{
    const metaEl = document.getElementById(`meta-${rec.id}`);
    if(!metaEl) return;
    const positions = positionsForWine(rec.id); // [{rack,row,col,qty}]
    addCellarChip(metaEl, positions);
  });
}

function getText(val){
  if(val==null) return '';
  if(typeof val==='object'){
    if(Array.isArray(val)) return val.map(getText).join(', ');
    if(val.value) return val.value;
    if(val.text) return val.text;
    if(val.content) return val.content;
    return Object.values(val).join(', ');
  }
  return String(val);
}

function fmtPrice(p){ if(p===''||p==null) return ''; const n=Number(p); return isFinite(n)?n.toFixed(2):p; }
function fmtWindow(f,t){ if(!f&&!t) return ''; if(f&&t) return `${f} – ${t}`; return f?`from ${f}`:`until ${t}`; }

// ── Tooltip + rack highlighting ─────────────────────────────────────────────
function clearHighlights() {
  document.querySelectorAll('.cell.highlight').forEach(el => el.classList.remove('highlight','pulse'));
}

function highlightCell(rack, row, col, { scroll = true, flash = false } = {}) {
  const id = `cell-r${rack}-r${row}-c${col}`;
  const el = document.getElementById(id);
  if (!el) return;
  clearHighlights();
  el.classList.add('highlight');
  if (flash) {
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 1200);
  }
  if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addCellarChip(containerEl, positions){
  const chip = document.createElement('span');
  chip.className = 'chip btn';
  chip.textContent = '📍 cellar';

  const tip = document.createElement('div');
  tip.className = 'tip';

  if (!positions.length) {
    tip.innerHTML = `<div class="tip-empty">No cellar location found.</div>`;
  } else {
    positions.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'tip-row';
      row.textContent = `Rack ${p.rack} · Row ${p.row}${p.col?` · Col ${p.col}`:''} — Qty: ${p.qty}`;
      row.addEventListener('mouseenter', ()=> highlightCell(p.rack,p.row,p.col||1,{scroll:false,flash:false}));
      row.addEventListener('mouseleave', ()=> clearHighlights());
      row.addEventListener('click', ()=> highlightCell(p.rack,p.row,p.col||1,{scroll:true,flash:true}));
      tip.appendChild(row);
    });
  }

  document.body.appendChild(tip);

  // position show/hide
  chip.addEventListener('mouseenter', ()=>{
    const r = chip.getBoundingClientRect();
    tip.style.left = `${r.left}px`;
    tip.style.top  = `${r.bottom + 6}px`;
    tip.style.display = 'block';
  });
  chip.addEventListener('mouseleave', ()=>{
    tip.style.display = 'none';
    clearHighlights();
  });

  containerEl.appendChild(chip);
}

// ── Add wine (with optional immediate inventory) ───────────────────────────
async function addWineFlow(){
  if(!S.base||!S.token){ alert('Set Base ID and Token in Settings.'); return; }

  const f = {
    name: q('#nw-name').value.trim(),
    producer: q('#nw-producer').value.trim(),
    country: q('#nw-country').value.trim(),
    region: q('#nw-region').value.trim(),
    grape: q('#nw-grape').value.trim(),
    label: q('#nw-label-url').value.trim(),
    vintage: q('#nw-vintage').value.trim(),
    from: q('#nw-drink-from').value.trim(),
    to: q('#nw-drink-to').value.trim(),
    price: q('#nw-price').value.trim(),
    loc: q('#nw-location').value.trim(),
    qty: q('#nw-qty').value.trim()
  };
  if(!f.name){ alert('Name is required.'); return; }

  // 1) Create wine
  const winePayload = {
    fields:{
      Name:f.name, Producer:f.producer||undefined, Country:f.country||undefined, Region:f.region||undefined,
      Grape:f.grape||undefined, Vintage: f.vintage? Number(f.vintage): undefined,
      'Drinkable from': f.from? Number(f.from): undefined,
      'Drinkable to': f.to? Number(f.to): undefined,
      Price: f.price? Number(f.price): undefined,
      'Label Image': f.label ? [{url:f.label}] : undefined
    }
  };
  const wRes = await fetch(
    `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`,
    {method:'POST', headers:headers(), body:JSON.stringify(winePayload)}
  );
  const wJson = await wRes.json();
  if(!wRes.ok){ alert('Error saving wine: '+(wJson?.error?.message||wRes.status)); return; }

  // 2) Optional inventory link
  if(f.loc && f.qty){
    const parsed = parseLocationString(f.loc);
    const locId  = await findOrCreateLocation(parsed);
    const invPayload = {
      fields:{
        'Wine (Link to Wines)':[wJson.id],
        'Location (Link to Locations)':[locId],
        Quantity: Number(f.qty)||0
      }
    };
    const iRes = await fetch(
      `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`,
      {method:'POST', headers:headers(), body:JSON.stringify(invPayload)}
    );
    if(!iRes.ok){
      const j=await iRes.json();
      alert('Error saving inventory: '+(j?.error?.message||iRes.status));
      return;
    }
  }

  // Close + reset
  q('#add-modal').style.display='none';
  ['#nw-name','#nw-producer','#nw-country','#nw-region','#nw-grape','#nw-label-url','#nw-vintage','#nw-drink-from','#nw-drink-to','#nw-price','#nw-location','#nw-qty']
    .forEach(id=>{ const el=q(id); if(el) el.value=''; });

  await refreshDataThenRender();
  // optional: re-run search to reflect new wine immediately
  if((q('#q')?.value||'').trim()) search();
}

function parseLocationString(s){
  // Supports: “Rack 1 Row 2 Col 3”, “Rack1 Row1”, etc. Falls back to Name-only.
  const mRack = s.match(/rack\s*(\d+)/i);
  const mRow  = s.match(/row\s*(\d+)/i);
  const mCol  = s.match(/col(?:umn)?\s*(\d+)/i);
  return {
    rack: mRack? Number(mRack[1]): null,
    row : mRow ? Number(mRow[1]) : null,
    col : mCol ? Number(mCol[1]) : null,
    name: s.trim()
  };
}

async function findOrCreateLocation(p){
  // Try exact Name match first
  const byNameUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(`{Name}='${esc(p.name)}'`)}&maxRecords=1`;
  let r = await (await fetch(byNameUrl,{headers:headers()})).json();
  if(r.records?.length) return r.records[0].id;

  // Otherwise create
  const payload = { fields:{ Name:p.name, Rack:p.rack||undefined, Row:p.row||undefined, Column:p.col||undefined } };
  const c = await fetch(`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`,
    {method:'POST', headers:headers(), body:JSON.stringify(payload)});
  const j = await c.json();
  if(!c.ok) throw new Error(j?.error?.message||c.status);
  return j.id;
}

// ── Data load: Inventory + Locations + Wine names → caches ──────────────────
async function loadInventoryAndLocations(){
  inventoryRecords = [];
  locationsMap = {};
  wineNameMap = {};
  inventoryByCell = new Map();
  positionsByWine = new Map();

  if(!S.base||!S.token) return;

  // 1) Inventory (all)
  const invAll = await (await fetch(
    `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=1000`,
    {headers:headers()}
  )).json();
  inventoryRecords = invAll.records || [];

  // Collect IDs
  const locSet = new Set(), wineSet = new Set();
  inventoryRecords.forEach(r=>{
    (r.fields['Location (Link to Locations)']||[]).forEach(id=>locSet.add(id));
    (r.fields['Wine (Link to Wines)']||[]).forEach(id=>wineSet.add(id));
  });

  // 2) Locations
  if(locSet.size){
    const arr = Array.from(locSet);
    for(let i=0;i<arr.length;i+=50){
      const chunk = arr.slice(i,i+50);
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`)}&maxRecords=50`;
      const j = await (await fetch(url,{headers:headers()})).json();
      (j.records||[]).forEach(x=>{
        const f=x.fields||{};
        locationsMap[x.id] = { Name:f.Name||'', Rack:Number(f.Rack)||1, Row:Number(f.Row)||1, Column:Number(f.Column)||1 };
      });
    }
  }

  // 3) Wine names
  if(wineSet.size){
    const arr = Array.from(wineSet);
    for(let i=0;i<arr.length;i+=50){
      const chunk = arr.slice(i,i+50);
      const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=${encodeURIComponent(`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`)}&maxRecords=50&fields[]=Name&fields[]=Vintage`;
      const j = await (await fetch(url,{headers:headers()})).json();
      (j.records||[]).forEach(x=>{
        const f=x.fields||{};
        wineNameMap[x.id] = `${f.Name||x.id}${f.Vintage?` — ${f.Vintage}`:''}`;
      });
    }
  }

  // 4) Build inventoryByCell + positionsByWine
  inventoryRecords.forEach(r=>{
    const f = r.fields || {};
    const qty = Number(f.Quantity||0) || 0;
    const wines = f['Wine (Link to Wines)'] || [];
    const locs  = f['Location (Link to Locations)'] || [];
    locs.forEach(locId=>{
      const l = locationsMap[locId];
      if(!l) return;
      const key = `${l.Rack}:${l.Row}:${l.Column}`;
      wines.forEach(wid=>{
        const entry = { wine: wineNameMap[wid]||wid, qty };
        if(!inventoryByCell.has(key)) inventoryByCell.set(key, []);
        inventoryByCell.get(key).push(entry);

        // positions for tooltip per wine
        if(!positionsByWine.has(wid)) positionsByWine.set(wid, []);
        positionsByWine.get(wid).push({ rack:l.Rack, row:l.Row, col:l.Column, qty });
      });
    });
  });
}

function positionsForWine(wineId){
  return positionsByWine.get(wineId) || [];
}

// ── Cellar Map (3 racks × 6×6) ─────────────────────────────────────────────
function buildCellarMap(){
  const wrap = q('#cellar-map');
  if(!wrap) return;
  wrap.innerHTML = '';

  const rows = 6, cols = 6;
  const racks = [1,2,3];

  racks.forEach(rk=>{
    const title = document.createElement('div');
    title.className = 'rack-title';
    title.textContent = `Rack ${rk}`;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'rack'; // CSS grid via index.css <style>

    for(let r=1;r<=rows;r++){
      for(let c=1;c<=cols;c++){
        const id = `cell-r${rk}-r${r}-c${c}`;
        const key = `${rk}:${r}:${c}`;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.id = id;
        cell.textContent = `${r}-${c}`;

        const have = inventoryByCell.get(key);
        if(have && have.length){
          cell.classList.add('has');
          cell.addEventListener('click', ()=>{
            const lines = have.map(x=>`• ${x.wine} — Qty: ${x.qty}`).join('\n');
            alert(`Rack ${rk} • Row ${r} • Column ${c}\n\n${lines}`);
          });
        }else{
          cell.addEventListener('click', ()=> alert(`Rack ${rk} • Row ${r} • Column ${c}\n\n(Empty)`));
        }
        grid.appendChild(cell);
      }
    }
    wrap.appendChild(grid);
  });
}

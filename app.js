// ─── Tonneklinker app.js v54 ────────────────────────────────────────────────

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

const q = s => document.querySelector(s);
const headers = () => ({ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' });

function esc(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
function fmtPrice(p){ if(p===''||p==null) return ''; const n=Number(p); return isFinite(n)?'€ '+n.toFixed(2):p; }
function fmtWindow(f,t){ if(!f&&!t) return ''; if(f&&t) return `${f} – ${t}`; return f?`from ${f}`:`until ${t}`; }

// Flag map and grape icon
const flag = { Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸', Duitsland:'🇩🇪', Portugal:'🇵🇹', België:'🇧🇪' };
const grapeIcon = '🍇';

// Settings + modal wiring
function saveSettings(){
  S.base = q('#airtableBase').value.trim();
  S.token = q('#airtableToken').value.trim();
  S.wines = q('#winesTable').value.trim();
  S.inv   = q('#inventoryTable').value.trim();
  S.loc   = q('#locationsTable').value.trim();
  alert('Saved locally.');
  buildCellarMap(); // refresh occupancy
}

document.addEventListener('DOMContentLoaded', () => {
  [['#airtableBase',S.base],['#airtableToken',S.token],['#winesTable',S.wines],['#inventoryTable',S.inv],['#locationsTable',S.loc]]
    .forEach(([id,val])=>{ const el=q(id); if(el) el.value=val; });

  q('#btn-save')?.addEventListener('click', e=>{e.preventDefault(); saveSettings();});
  q('#btn-search')?.addEventListener('click', e=>{e.preventDefault(); search();});
  q('#q')?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); search(); }});

  q('#btn-open-add')?.addEventListener('click', ()=> q('#add-modal').classList.add('open'));
  q('#btn-cancel-add')?.addEventListener('click', ()=> q('#add-modal').classList.remove('open'));
  q('#btn-save-add')?.addEventListener('click', addWineFlow);

  buildCellarMap();
});

// ── SEARCH (server AND first, client AND fallback) ───────────────────────────
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
      out.innerHTML = renderSearchCards(data.records);
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
      out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
    }
  }catch(e){
    if(e.name!=='AbortError') out.innerHTML = `<p class="badge">Search error: ${e.message}</p>`;
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Search'; }
  }
}

function renderSearchCards(records){
  if(!records.length) return '<p class="badge">No matches.</p>';
  return records.map(rec=>{
    const f = rec.fields||{};
    const img = (Array.isArray(f['Label Image']) && f['Label Image'][0]?.url)
      ? `<img src="${f['Label Image'][0].url}" class="label" alt="Label">` : '';
    const locChip = `<span class="chip btn" data-cellar="${rec.id}">📍 cellar</span>`;
    const chips = [
      [flag[f.Country]||'🌍', f.Country, '–', f.Region].filter(Boolean).join(' ') || null,
      f.Producer ? `👤 ${f.Producer}` : null,
      f.Grape ? `${grapeIcon} ${f.Grape}` : null,
      f.Taste ? `👅 ${getText(f.Taste)}` : null,
      f['Food Pairing'] ? `🍽️ ${getText(f['Food Pairing'])}` : null,
      (f['Drinkable from'] || f['Drinkable to']) ? `🕰️ ${fmtWindow(f['Drinkable from'], f['Drinkable to'])}` : null,
      (f.Price!=='' && f.Price!=null) ? `💶 ${fmtPrice(f.Price)}` : null,
      locChip
    ].filter(Boolean).map(x=>`<span class="chip">${x}</span>`).join(' ');

    return `
      <div class="card wine-card">
        ${img}
        <div class="wine-info">
          <b>${f.Name||''}</b>${f.Vintage?` — ${f.Vintage}`:''}
          <div class="meta">${chips}</div>
        </div>
      </div>`;
  }).join('');
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

// Click on the “📍 cellar” chip -> resolve locations for that wine
document.addEventListener('click', async (e)=>{
  const chip = e.target.closest('[data-cellar]');
  if(!chip) return;
  const wineId = chip.getAttribute('data-cellar');
  try{
    const list = await fetchWineLocations(wineId);
    if(!list.length){ alert('No cellar location found.'); return; }
    const lines = list.map(x => `• ${x.name} — Qty: ${x.qty}`).join('\n');
    alert(lines);
  }catch(err){ alert('Lookup error: '+err.message); }
});

async function fetchWineLocations(wineId){
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?filterByFormula=${encodeURIComponent(`FIND('${wineId}', ARRAYJOIN({Wine (Link to Wines)}))`)}&maxRecords=100`;
  const inv = await (await fetch(invUrl,{headers:headers()})).json();
  const locIds = new Set();
  (inv.records||[]).forEach(r=> (r.fields['Location (Link to Locations)']||[]).forEach(id=>locIds.add(id)));
  if(!locIds.size) return [];

  const arr = Array.from(locIds);
  const names = {};
  for(let i=0;i<arr.length;i+=50){
    const chunk = arr.slice(i,i+50);
    const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`)}&maxRecords=50`;
    const r = await (await fetch(url,{headers:headers()})).json();
    (r.records||[]).forEach(x=>{
      const f=x.fields||{};
      const label = `${f.Name || ''}${f.Rack?` — Rack ${f.Rack}`:''}${f.Row?` • Row ${f.Row}`:''}${f.Column?` • Column ${f.Column}`:''}`.trim();
      names[x.id]=label||x.id;
    });
  }
  const out=[];
  (inv.records||[]).forEach(r=>{
    const qty = r.fields.Quantity ?? 0;
    const locs = r.fields['Location (Link to Locations)']||[];
    locs.forEach(id=> out.push({name:names[id]||id, qty}));
  });
  return out;
}

// ── ADD WINE (with optional inventory row) ──────────────────────────────────
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

  if(f.loc && f.qty){
    const parsed = parseLocationString(f.loc);
    let locId = await findOrCreateLocation(parsed);
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

  q('#add-modal').classList.remove('open');
  ['#nw-name','#nw-producer','#nw-country','#nw-region','#nw-grape','#nw-label-url','#nw-vintage','#nw-drink-from','#nw-drink-to','#nw-price','#nw-location','#nw-qty']
    .forEach(id=>{ const el=q(id); if(el) el.value=''; });

  buildCellarMap();
  search();
}

function parseLocationString(s){
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
  const byNameUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(`{Name}='${esc(p.name)}'`)}&maxRecords=1`;
  let r = await (await fetch(byNameUrl,{headers:headers()})).json();
  if(r.records?.length) return r.records[0].id;

  const payload = { fields:{ Name:p.name, Rack:p.rack||undefined, Row:p.row||undefined, Column:p.col||undefined } };
  const c = await fetch(`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}`,
    {method:'POST', headers:headers(), body:JSON.stringify(payload)});
  const j = await c.json();
  if(!c.ok) throw new Error(j?.error?.message||c.status);
  return j.id;
}

// ── CELLAR MAP (3 racks × 6×6) with INLINE grid styles ──────────────────────
async function buildCellarMap(){
  const wrap = q('#cellar-map');
  if(!wrap) return;
  wrap.innerHTML = '';

  const rows = 6, cols = 6;
  const racks = [1,2,3];

  const occ = await loadOccupancy();

  racks.forEach(rk=>{
    const title = document.createElement('div');
    title.textContent = `Rack ${rk}`;
    title.style.cssText = 'margin:10px 0 6px;font-weight:600';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    // INLINE grid to avoid stylesheet fights
    grid.style.display = 'grid';
    grid.style.gap = '6px';
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    for(let r=1;r<=rows;r++){
      for(let c=1;c<=cols;c++){
        const id = `R${rk}-r${r}-c${c}`;
        const cell = document.createElement('div');
        cell.textContent = `${r}-${c}`;
        cell.dataset.rack=rk; cell.dataset.row=r; cell.dataset.col=c;
        // inline cell style
        cell.style.padding='10px';
        cell.style.border='1px solid #333';
        cell.style.borderRadius='10px';
        cell.style.textAlign='center';

        const have = occ[id];
        if(have && have.length){
          cell.style.background='#0b3d2d';
          cell.style.borderColor='#0b3d2d';
          cell.style.color='#b6ffe5';
          cell.style.cursor='pointer';
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

// occupancy: { "R1-r1-c1":[{wine,qty}], ... }
async function loadOccupancy(){
  const out = {};
  try{
    if(!S.base||!S.token) return out;
    const invAll = await (await fetch(
      `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=200`,
      {headers:headers()}
    )).json();

    const locSet = new Set(), wineSet = new Set();
    (invAll.records||[]).forEach(r=>{
      (r.fields['Location (Link to Locations)']||[]).forEach(id=>locSet.add(id));
      (r.fields['Wine (Link to Wines)']||[]).forEach(id=>wineSet.add(id));
    });

    const locMap = {};
    if(locSet.size){
      const arr = Array.from(locSet);
      for(let i=0;i<arr.length;i+=50){
        const chunk = arr.slice(i,i+50);
        const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.loc)}?filterByFormula=${encodeURIComponent(`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`)}&maxRecords=50`;
        const j = await (await fetch(url,{headers:headers()})).json();
        (j.records||[]).forEach(x=>{
          const f=x.fields||{};
          const key = `R${f.Rack||0}-r${f.Row||0}-c${f.Column||0}`;
          locMap[x.id] = { key, name:f.Name||'' };
        });
      }
    }

    const wineName = {};
    if(wineSet.size){
      const arr = Array.from(wineSet);
      for(let i=0;i<arr.length;i+=50){
        const chunk = arr.slice(i,i+50);
        const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=${encodeURIComponent(`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`)}&maxRecords=50&fields[]=Name`;
        const j = await (await fetch(url,{headers:headers()})).json();
        (j.records||[]).forEach(x=> wineName[x.id] = x.fields?.Name || x.id);
      }
    }

    (invAll.records||[]).forEach(r=>{
      const qty = r.fields.Quantity ?? 0;
      const wines = r.fields['Wine (Link to Wines)']||[];
      const locs  = r.fields['Location (Link to Locations)']||[];
      locs.forEach(locId=>{
        const loc = locMap[locId];
        if(!loc) return;
        if(!out[loc.key]) out[loc.key]=[];
        wines.forEach(w=> out[loc.key].push({wine:wineName[w]||w, qty}));
      });
    });

  }catch(_){}
  return out;
}

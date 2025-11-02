// ---- Tonneklinker app.js (v41) ----

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
const headers = () => ({
  'Authorization': 'Bearer ' + S.token,
  'Content-Type': 'application/json'
});

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
    q('#btn-save')?.addEventListener('click', e => { e.preventDefault(); saveSettings(); });
    q('#btn-search')?.addEventListener('click', e => { e.preventDefault(); search(); });
    q('#q')?.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); search(); }});
    q('#btn-open-add')?.addEventListener('click', ()=> q('#add-modal')?.classList.add('open'));
    q('#btn-cancel-add')?.addEventListener('click', ()=> q('#add-modal')?.classList.remove('open'));
    q('#btn-save-add')?.addEventListener('click', ()=> saveWine());
    _handlersBound = true;
  }

  loadInventory();
});

// ---------- SEARCH ----------
function escAirtable(s){ return String(s||'').replace(/'/g,"''"); }
function norm(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
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
    "CONCATENATE({Name},' ',{Vintage},' ',{Country},' ',{Region},' ',{Grape},' ',{Taste},' ',{Food Pairing},' ',{Drinkable from},' ',{Drinkable to})";
  const pieces  = terms.map(t => `SEARCH('${escAirtable(t)}', ${concat}) > 0`);
  const formula = pieces.length ? `AND(${pieces.join(',')})` : '1=1';
  const url     = `${baseUrl}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`;

  try{
    const r = await fetch(url, headersObj);
    const data = r.ok ? await r.json() : { records: [] };
    if (Array.isArray(data.records) && data.records.length){
      out.innerHTML = renderSearchCards(data.records);
      return;
    }

    const rAll = await fetch(`${baseUrl}?maxRecords=200`, headersObj);
    const all  = rAll.ok ? await rAll.json() : { records: [] };
    const needles = terms.map(norm);
    const rows = (all.records||[]).filter(rec=>{
      const f = rec.fields || {};
      const hay = norm([
        f.Name,f.Vintage,f.Country,f.Region,f.Grape,f.Taste,
        f['Food Pairing'],f['Drinkable from'],f['Drinkable to']
      ].filter(Boolean).join(' '));
      return needles.every(t => hay.includes(t));
    });
    out.innerHTML = rows.length ? renderSearchCards(rows) : '<p class="badge">No matches.</p>';
  }catch(err){
    if (err.name!=='AbortError'){
      out.innerHTML = `<p class="badge">Search error: ${err.message}</p>`;
    }
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = 'Search'; }
  }
}

// ---------- RENDER ----------
function renderSearchCards(records){
  const getText = val=>{
    if(val==null) return '';
    if(typeof val==='object'){
      if(Array.isArray(val)) return val.map(v=>getText(v)).join(', ');
      if(val.value) return val.value;
      if(val.text) return val.text;
      if(val.content) return val.content;
      if(val.name) return val.name;
      return Object.values(val).join(', ');
    }
    return String(val);
  };

  const flagMap={
    Frankrijk:'🇫🇷', Italië:'🇮🇹', Oostenrijk:'🇦🇹', Spanje:'🇪🇸',
    Duitsland:'🇩🇪', Portugal:'🇵🇹', VerenigdeStaten:'🇺🇸', Zwitserland:'🇨🇭',
    België:'🇧🇪', Slovenië:'🇸🇮', Griekenland:'🇬🇷'
  };

  return records.map(rec=>{
    const f=rec.fields||{};
    const imgUrl = Array.isArray(f['Label Image']) ? f['Label Image'][0]?.url : f['Label Image']?.url || '';
    const labelImg = imgUrl?`<img src="${imgUrl}" class="label-img" alt="Label"/>`:'';
    const country=getText(f.Country); const region=getText(f.Region);
    const flag=flagMap[country]||'🌍';
    const countryRegion=[flag+' '+country,region].filter(Boolean).join(' – ');

    const chips=[
      countryRegion||null,
      getText(f.Grape)||null,
      f.Taste?`👅 ${getText(f.Taste)}`:null,
      f['Food Pairing']?`🍽️ ${getText(f['Food Pairing'])}`:null,
      (f['Drinkable from']||f['Drinkable to'])?`🕰️ ${[getText(f['Drinkable from']),getText(f['Drinkable to'])].filter(Boolean).join(' – ')}`:null,
      f.Price?`💶 € ${Number(f.Price).toFixed(2)}`:null
    ].filter(Boolean).map(x=>`<span class="badge">${x}</span>`).join(' ');

    return `<div class="card wine-card">${labelImg}<div class="wine-info"><b>${getText(f.Name)||''}</b>${f.Vintage?` — ${getText(f.Vintage)}`:''}<div class="meta">${chips}</div></div></div>`;
  }).join('') || '<p class="badge">No matches.</p>';
}

// ---------- INVENTORY ----------
async function loadInventory(){
  if(!S.base||!S.token) return;
  try{
    const invUrl=`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}?maxRecords=100`;
    const invRes=await fetch(invUrl,{headers:headers()});
    const invData=await invRes.json();
    if(!invData.records||!invData.records.length){ q('#inventory').innerHTML='<p class="badge">No inventory yet.</p>'; return; }

    const wineIDs=new Set(); const locIDs=new Set();
    for(const r of invData.records){
      (r.fields['Wine (Link to Wines)']||[]).forEach(id=>wineIDs.add(id));
      (r.fields['Location (Link to Locations)']||[]).forEach(id=>locIDs.add(id));
    }

    async function fetchNameMap(tbl,ids){
      const arr=Array.from(ids); const map={};
      for(let i=0;i<arr.length;i+=50){
        const chunk=arr.slice(i,i+50);
        const formula=`OR(${chunk.map(id=>`RECORD_ID()='${id}'`).join(',')})`;
        const url=`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(tbl)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Name&maxRecords=50`;
        const res=await fetch(url,{headers:headers()}); const json=await res.json();
        (json.records||[]).forEach(rec=>map[rec.id]=rec.fields?.Name||rec.id);
      }
      return map;
    }

    const [wineMap,locMap]=await Promise.all([fetchNameMap(S.wines,wineIDs),fetchNameMap(S.loc,locIDs)]);
    q('#inventory').innerHTML=invData.records.map(r=>{
      const f=r.fields||{};
      const wine=(f['Wine (Link to Wines)']||[]).map(id=>wineMap[id]||id).join(', ');
      const loc =(f['Location (Link to Locations)']||[]).map(id=>locMap[id]||id).join(', ');
      const qty = f.Quantity??0;
      return `<div class="card"><b>${wine}</b><br/>📍 ${loc} — Qty: ${qty}</div>`;
    }).join('');
  }catch(err){ q('#inventory').innerHTML=`<p class="badge">Inventory error: ${err.message}</p>`; }
}

// ---------- Add Wine ----------
function numOrNull(v){ if(v==null||v==='')return null; const c=String(v).replace(/[€\s]/g,'').replace(',','.'); const n=Number(c); return Number.isFinite(n)?n:null; }
function attachmentFromUrl(u){ if(!u)return; u=String(u).trim(); return u?[{url:u}]:undefined; }
function normalizeLocName(s){ return String(s||'').replace(/\s*[-–]\s*/g,' – ').trim(); }
async function findLocationIdByName(name){
  const base=S.base; const table=encodeURIComponent(S.loc);
  const headersObj={headers:headers()};
  const nameNorm=normalizeLocName(name);
  const nameAlt=nameNorm.replace(' – ',' ');
  const formula=`OR({Name}='${nameNorm.replace(/'/g,"''")}',{Name}='${nameAlt.replace(/'/g,"''")}')`;
  const url=`https://api.airtable.com/v0/${base}/${table}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const r=await fetch(url,headersObj); const j=await r.json();
  if(j.records&&j.records.length) return j.records[0].id;
  const m=/rack\s*(\d+).*row\s*(\d+)/i.exec(nameNorm.replace(' – ',' '));
  const rackName=m?`Rack ${m[1]}`:nameNorm; const rowNum=m?Number(m[2]):null;
  const createPayload={fields:{Name:nameNorm,Rack:rackName}}; if(rowNum!=null) createPayload.fields.Row=rowNum;
  const r2=await fetch(`https://api.airtable.com/v0/${base}/${table}`,{method:'POST',headers:headers(),body:JSON.stringify(createPayload)});
  const j2=await r2.json(); if(!r2.ok) throw new Error(`Failed to create Location: ${JSON.stringify(j2)}`);
  return j2.id;
}
function explainAirtableError(j){ try{ if(j&&j.error){ return `${j.error.type||'Error'}: ${j.error.message||''}`; } return JSON.stringify(j);}catch{return String(j);} }

async function saveWine(){
  try{
    const name=q('#nw-name')?.value.trim(); if(!name){alert('Please enter a Name.');return;}
    const vintage=q('#nw-vintage')?.value.trim(); const country=q('#nw-country')?.value.trim();
    const region=q('#nw-region')?.value.trim(); const grape=q('#nw-grape')?.value.trim();
    const label=q('#nw-label-url')?.value.trim(); const dFrom=q('#nw-drink-from')?.value.trim();
    const dTo=q('#nw-drink-to')?.value.trim(); const price=q('#nw-price')?.value.trim();
    const invLoc=q('#nw-location')?.value.trim(); const invQty=q('#nw-qty')?.value.trim();

    const wineFields={Name:name};
    const vN=numOrNull(vintage); if(vN!=null)wineFields['Vintage']=vN;
    if(country)wineFields['Country']=country; if(region)wineFields['Region']=region;
    if(grape)wineFields['Grape']=grape;
    const dfN=numOrNull(dFrom); if(dfN!=null)wineFields['Drinkable from']=dfN;
    const dtN=numOrNull(dTo); if(dtN!=null)wineFields['Drinkable to']=dtN;
    const pN=numOrNull(price); if(pN!=null)wineFields['Price']=pN;
    const labelAtt=attachmentFromUrl(label); if(labelAtt)wineFields['Label Image']=labelAtt;

    const winesUrl=`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}`;
    const r=await fetch(winesUrl,{method:'POST',headers:headers(),body:JSON.stringify({fields:wineFields})});
    const jr=await r.json(); if(!r.ok){alert(`Error saving wine: HTTP ${r.status}\n${explainAirtableError(jr)}`);return;}
    const newWineId=jr.id;

    if(invLoc&&invQty){
      const qtyN=numOrNull(invQty)??0;
      const locationId=await findLocationIdByName(invLoc);
      const invUrl=`https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`;
      const invPayload={fields:{
        "Wine (Link to Wines)":[newWineId],
        "Location (Link to Locations)":[locationId],
        "Quantity":qtyN
      }};
      const rInv=await fetch(invUrl,{method:'POST',headers:headers(),body:JSON.stringify(invPayload)});
      const jInv=await rInv.json();
      if(!rInv.ok){alert(`Wine saved, but failed to create inventory: HTTP ${rInv.status}\n${explainAirtableError(jInv)}`);}
    }

    q('#add-modal')?.classList.remove('open');
    document.querySelectorAll('#add-modal input').forEach(i=>i.value='');
    loadInventory();
    alert('Wine saved successfully ✅');
  }catch(err){console.error(err);alert(`Error: ${err.message}`);}
}

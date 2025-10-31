
const S = {
  get base(){ return localStorage.getItem('tk_base')||''; },
  get token(){ return localStorage.getItem('tk_token')||''; },
  get wines(){ return localStorage.getItem('tk_wines')||'Wines'; },
  get inv(){ return localStorage.getItem('tk_inv')||'Inventory'; },
  get loc(){ return localStorage.getItem('tk_loc')||'Locations'; },
};
const headers = ()=>({ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' });

document.getElementById('btn-scan').addEventListener('click', startScan);
document.getElementById('btn-search').addEventListener('click', ()=>document.getElementById('quickSearch').style.display='block');

async function startScan(){
  const box = document.getElementById('scanBox'); box.style.display='block';
  const video = document.getElementById('video');
  const status = document.getElementById('scanStatus');
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }});
    video.srcObject = stream; video.play();

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async ()=>{
        try{
          const codes = await detector.detect(video);
          if(codes.length){ handleRackValue(codes[0].rawValue); stop(); return; }
        }catch(e){}
        requestAnimationFrame(tick);
      }; tick();
      status.textContent = 'Point camera at Rack QR…';
    } else {
      status.textContent = 'QR API not supported. Use Quick Search or prefilled URL QRs.';
    }

    function stop(){ (stream.getTracks()||[]).forEach(t=>t.stop()); box.style.display='none'; }
    document.getElementById('stopScan').onclick = stop;
  }catch(e){ status.textContent = 'Camera error: '+e.message; }
}

async function handleRackValue(val){
  let rack = '';
  if(val.startsWith('RACK=')) rack = val.split('=')[1];
  else{ try{ const u = new URL(val); rack = u.searchParams.get('prefill_Rack')||''; }catch(e){} }
  if(!rack){ alert('Unrecognized QR.'); return; }

  const row = prompt(`Scanned ${rack}. Row (A–H):`,'A')||'A';
  const col = prompt('Column (1–10):','1')||'1';
  const wine = prompt('Wine (exact Name in Wines table):','')||'';
  const qty = parseInt(prompt('Quantity:','1')||'1',10);

  if(!S.base||!S.token){ alert('Set Base ID & Token in desktop Settings first.'); return; }
  const invUrl = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.inv)}`;
  const body = { records:[{ fields:{
    "Location (Link to Locations)": [`${rack} - ${row}${col}`],
    "Wine (Link to Wines)": [wine],
    "Quantity": qty
  }}]};
  const r = await fetch(invUrl, { method:'POST', headers: headers(), body: JSON.stringify(body) });
  if(r.ok) alert('Added to inventory.'); else alert('Error: '+(await r.text()));
}

document.getElementById('go').addEventListener('click', async ()=>{
  const q = document.getElementById('q').value.trim();
  if(!S.base||!S.token){ alert('Set Base ID & Token in desktop Settings first.'); return; }
  const url = `https://api.airtable.com/v0/${S.base}/${encodeURIComponent(S.wines)}?filterByFormula=FIND(LOWER('${q}'), LOWER({Name}&' '&{Producer}&' '&{Vintage}))&maxRecords=25`;
  const r = await fetch(url, { headers: headers() });
  const data = await r.json();
  const out = (data.records||[]).map(r=>`<div class="card"><b>${r.fields.Name||''}</b> — ${r.fields.Vintage||''}</div>`).join('');
  document.getElementById('results').innerHTML = out || '<p class="badge">No matches.</p>';
});

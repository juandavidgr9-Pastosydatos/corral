'use strict';
/* Corral - recolector de datos. Todo vive en el celular (IndexedDB). */
const VERSION = '4.0.0';
const BACKUP_SHEET = '_respaldo';
const CFG = {
  hlMin: 80, hlMax: 350, entoreMin: 295, destMin: 80, destMax: 190,
  gmdMin: -200, gmdMax: 900, gestRevisar: 300, recordarCada: 25,
  loteDestete: 'DESTETE', loteVenta: 'VENTA', loteEntore: 'VACÍAS SARDINA'
};
const OVARIOS = ['OE','FOD','FOI','CLD','CLI','QUISTE OD','QUISTE OI','ENDOMETRITIS','PIOMETRA','CELO','PP','RP','DESCARTE'];
const DIAS = [28,30,35,40,45,50,55,60,65,70,75,80,85,90];
const EA_TXT = {VP:'Vaca Parida',VS:'Vaca Seca',NV:'Novilla Vientre',HL:'Hembra Levante',CH:'Cría Hembra',CM:'Cría Macho',TR:'Toro',ML:'Macho Levante'};
const TABS = [
  ['inv','Inventario','<path d="M9 5h11M9 12h11M9 19h11"/><path d="M3 5l1.5 1.5L7 4M3 12l1.5 1.5L7 11M3 19l1.5 1.5L7 18"/>'],
  ['palp','Palpar','<path d="M7 11V5a2 2 0 014 0v5M11 10V4a2 2 0 014 0v7M15 10V6a2 2 0 014 0v8a7 7 0 01-7 7h-1a7 7 0 01-6-3l-3-5a2 2 0 013-2l2 2"/>'],
  ['peso','Pesar','<path d="M4 8h16l-2 12H6L4 8z"/><path d="M8 8a4 4 0 018 0M12 13l2-2"/>'],
  ['dest','Destete','<circle cx="8" cy="7" r="3"/><circle cx="17" cy="11" r="2"/><path d="M3 20c0-4 2-7 5-7s5 3 5 7M14 20c0-3 1-5 3-5s3 2 3 5"/>'],
  ['list','Movimientos','<path d="M4 8h14M15 5l3 3-3 3M20 16H6M9 13l-3 3 3 3"/>'],
  ['file','Archivo','<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>']
];

/* ---------- estado ---------- */
let meta = null, animals = new Map(), order = [], crias = new Map();
let tab = 'inv', F = {inv:{}, palp:{}, peso:{}, dest:{}};
let L = {q:'',sexo:'',lote:'',ea:'',repro:'',inv:'',reg:'',vista:'mov'};
/* Filtros del reloj de inventario: usan los datos con que se cargó el Excel */
let TL = 'actual';  // tabla por lote: 'inicial' | 'actual'
let P = {lote:'',ea:'',sexo:'',repro:''}, pSeg = 'faltan', progOpen = false, movRows = [];
let db, installEvt = null, persisted = null;

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2,'0');
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const stamp = () => { const d=new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const dayN = iso => Date.UTC(+iso.slice(0,4), +iso.slice(5,7)-1, +iso.slice(8,10))/864e5;
const daysBetween = (a,b) => dayN(b)-dayN(a);
const sinceBase = () => Math.max(0, daysBetween(meta.baseDate, today()));
const fmtD = iso => iso ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : '—';
const num = (v,d=1) => Number(v).toLocaleString('es-CO',{maximumFractionDigits:d,minimumFractionDigits:0});

/* ---------- datos derivados ---------- */
const ieTxt = a => { const p=[]; if(a.ie) p.push(a.ie.slice(-5)); if(a.az) p.push('AZ '+a.az); return p.join(' · ') || 'Sin chapeta'; };
const colorTxt = a => a.color || 'Sin registro';
const eaNow = a => a.w.entore ? 'NV' : a.ea;
const loteNow = a => a.w.mov ? a.w.mov.a : a.lote;
const estadoNow = a => a.w.palp ? (a.w.palp.res==='V' ? 'Vacía' : 'Preñada') : a.estado;
const gestBaseNow = a => a.estado==='Preñada' ? a.gest + sinceBase() : 0;
const gestNow = a => {
  const p=a.w.palp;
  if(p) return p.res==='V' ? 0 : p.dias + Math.max(0,daysBetween(p.ts.slice(0,10),today()));
  return gestBaseNow(a);
};
const dabNow = a => a.estado==='Vacía' && a.dab>0 ? a.dab + sinceBase() : a.dab;
const mesesNow = a => a.emes + sinceBase()/30.4375;
const anosNow = a => mesesNow(a)/12;
const detNow = a => a.w.palp ? (a.w.palp.res==='V' ? a.w.palp.det : '') : a.dtacto;
const puedePalpar = a => ['VP','VS','NV'].includes(eaNow(a));
const esCria = a => ['CH','CM'].includes(a.ea);
const gmdLabel = a => a.gmd ? `${num(a.gmd,0)} g/día` : '—';

function indexar(){
  crias = new Map();
  for(const id of order){ const a=animals.get(id);
    if(esCria(a) && a.madre){ if(!crias.has(a.madre)) crias.set(a.madre,[]); crias.get(a.madre).push(id); } }
}
const stripZ = s => s.replace(/^0+(?=[0-9A-Z])/,'');
const norm = s => stripZ(String(s).toUpperCase().replace(/^TORO\s*/,'').replace(/\s+/g,''));
function buscar(qRaw){
  const q=qRaw.trim().toUpperCase().replace(/\s+/g,''); if(!q) return {items:[],exact:0};
  const nq=norm(q), ex=[], eq=[], pre=[];
  for(const id of order){ const a=animals.get(id), n=norm(id), up=id.toUpperCase();
    const ie5=a.ie?a.ie.slice(-5):'', az=a.az?stripZ(a.az):'';
    if(up===q) ex.push(a);
    else if(n===nq || (ie5 && stripZ(ie5)===nq) || (az && az===nq)) eq.push(a);
    else if(n.startsWith(nq) || ie5.startsWith(q)) pre.push(a);
  }
  pre.sort((x,y)=>norm(x.id).length-norm(y.id).length);
  return {items:[...ex,...eq,...pre].slice(0,7), exact:ex.length+eq.length};
}

/* ---------- IndexedDB ---------- */
function openDB(){ return new Promise((ok,no)=>{
  const r=indexedDB.open('corral',1);
  r.onupgradeneeded=()=>{ const d=r.result; d.createObjectStore('meta'); d.createObjectStore('animals',{keyPath:'id'}); };
  r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error);
});}
const txDone = t => new Promise((ok,no)=>{ t.oncomplete=ok; t.onerror=()=>no(t.error); t.onabort=()=>no(t.error); });
const tx = () => { try{ return db.transaction(['meta','animals'],'readwrite',{durability:'strict'}); }catch(e){ return db.transaction(['meta','animals'],'readwrite'); } };
async function loadDB(){
  const t=db.transaction(['meta','animals']);
  const get=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  const m=await get(t.objectStore('meta').get('m'));
  const all=await get(t.objectStore('animals').getAll());
  if(!m) return;
  meta=m; animals=new Map(all.map(a=>[a.id,a])); order=m.order; indexar();
}
async function replaceAll(m,list){
  const t=tx(); t.objectStore('animals').clear(); for(const a of list) t.objectStore('animals').put(a);
  m.order=list.map(a=>a.id); t.objectStore('meta').put(m,'m'); await txDone(t);
  meta=m; animals=new Map(list.map(a=>[a.id,a])); order=m.order; indexar();
}
/* Guarda cambios y solo actualiza la pantalla cuando el celular confirma la escritura */
async function commit(changes, delta=1){
  const nextMeta={...meta, cambios:Math.max(0,(meta.cambios||0)+delta)};
  try{
    const t=tx();
    for(const [a,w] of changes) t.objectStore('animals').put({...a,w});
    t.objectStore('meta').put(nextMeta,'m'); await txDone(t);
  }catch(e){ await alertBox('No se pudo guardar','El celular no permitió guardar este dato. Descargue el avance ahora y revise el espacio disponible.'); throw e; }
  for(const [a,w] of changes) a.w=w;
  meta=nextMeta;
}
async function saveMeta(){ const t=tx(); t.objectStore('meta').put(meta,'m'); await txDone(t); }
async function pedirPersistencia(){
  try{ if(navigator.storage&&navigator.storage.persist){ persisted=await navigator.storage.persisted()||await navigator.storage.persist(); } }catch(e){}
}

/* ---------- modales y avisos ---------- */
let toastT;
function toast(msg, undo){
  const el=$('#toast'); el.innerHTML=`<span>${esc(msg)}</span>`+(undo?'<button id="undoBtn">Deshacer</button>':'');
  el.classList.add('show'); clearTimeout(toastT);
  toastT=setTimeout(()=>el.classList.remove('show'), undo?7000:3500);
  if(undo) $('#undoBtn').onclick=async()=>{ el.classList.remove('show'); await undo(); toast('Registro deshecho'); render(); };
}
function modal(html){ const m=$('#modal'); m.innerHTML=`<div class="sheet">${html}</div>`; m.classList.add('show'); return m; }
function closeModal(){ progOpen=false; const m=$('#modal'); m.classList.remove('show'); m.innerHTML=''; }
function confirmBox(title,msg,ok='Confirmar',danger=false,cancel='Volver'){
  return new Promise(res=>{
    const m=modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><button class="big ${danger?'danger':''}" id="mOk">${esc(ok)}</button><button class="big sec" id="mNo">${esc(cancel)}</button>`);
    m.querySelector('#mOk').onclick=()=>{closeModal();res(true);}; m.querySelector('#mNo').onclick=()=>{closeModal();res(false);};
  });
}
function alertBox(title,msg){ return new Promise(res=>{
  const m=modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><button class="big" id="mOk">Entendido</button>`);
  m.querySelector('#mOk').onclick=()=>{closeModal();res();};
});}
function recordatorio(){
  const c=meta?.cambios||0;
  if(c>0 && c%CFG.recordarCada===0) toastBackup(c);
}
function toastBackup(c){
  const el=$('#toast'); el.innerHTML=`<span>Lleva ${c} cambios sin descargar.</span><button id="bk">Descargar</button>`;
  el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),8000);
  $('#bk').onclick=()=>{ el.classList.remove('show'); descargar(); };
}

/* ---------- pantalla ---------- */
function render(){ renderTop(); renderNav(); renderMain(); }
function renderTop(){
  const c=meta?.cambios||0;
  $('#top').innerHTML=`<div class="brand"><b>${esc(meta?meta.finca:'Corral')}</b><small>${meta?`${order.length} animales`:'Pastos & Datos'}</small></div>`+
    (meta?`<button class="pill ${c?'warn':''}" data-a="goFile">${c?`${c} sin descargar`:'Respaldado ✓'}</button>`:'');
}
function renderNav(){
  $('#nav').innerHTML=TABS.map(([k,t,ic])=>`<button data-tab="${k}" class="${k===tab?'on':''}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${t}</button>`).join('');
}
function renderMain(){
  const m=$('#main');
  if(!meta && tab!=='file') tab='file';
  if(tab==='file'){ m.className='narrow'; m.innerHTML=viewFile(); }
  else if(tab==='list'){ m.className='wide'; m.innerHTML=viewList(); }
  else {
    const f=F[tab]; const a=f.id?animals.get(f.id):null;
    m.className='split';
    if(!a) { m.innerHTML=viewSearch(); pintarResultados(); }
    else m.innerHTML = paneles(tab==='inv'?viewInv(a):tab==='palp'?viewPalp(a):tab==='peso'?viewPeso(a):viewDest(a));
  }
  if(!meta) renderNavLock();
}
/* En tablet horizontal: ficha del animal a la izquierda, formulario a la derecha */
function paneles(h){ const i=h.indexOf('<!--R-->'); return i<0?`<div class="pane pr">${h}</div>`:`<div class="pane pl">${h.slice(0,i)}</div><div class="pane pr">${h.slice(i+8)}</div>`; }
function renderNavLock(){ document.querySelectorAll('#nav button').forEach(b=>{ if(b.dataset.tab!=='file') b.style.opacity=.35; }); }

const AYUDA={inv:'Número o chapeta del animal',palp:'Número o chapeta de la vaca',peso:'Número o chapeta del animal',dest:'Número de la vaca'};
function viewSearch(){
  const f=F[tab]; const mode=f.abc?'':'readonly inputmode="none"';
  return `<div class="pane pl"><div class="searchbox"><input id="q" ${mode} autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${AYUDA[tab]}" value="${esc(f.q||'')}"></div>
  <div class="keys">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}
    <button data-k="-">-</button><button data-k="0">0</button><button class="k2" data-k="del" aria-label="Borrar">⌫</button>
    <button class="k2" data-k="abc">${f.abc?'123':'ABC'}</button><button class="go" data-k="ok">Buscar</button></div></div>
  <div class="pane pr"><div class="results" id="res"></div>${tab==='inv'?progHTML()+`<button class="tlbtn" data-a="tlotes">Inventario por lote y estado</button><div class="tlwrap">${tablaLotesHTML()}</div>`:''}</div>`;
}

/* ---------- reloj de progreso del inventario ---------- */
const P_LBL = {lote:'Lote',ea:'Categoría',sexo:'Sexo',repro:'Estado reprod.'};
function progBase(){
  return order.map(i=>animals.get(i)).filter(a=>
    (!P.lote||a.lote===P.lote)&&(!P.ea||a.ea===P.ea)&&(!P.sexo||a.sexo===P.sexo)&&(!P.repro||(a.estado||'Sin dato')===P.repro));
}
function ringSVG(ok,tot){
  const C=2*Math.PI*50, pct=tot?ok/tot:0, len=Math.max(0,Math.min(C,pct*C));
  return `<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${Math.round(pct*100)}% inventariado"><circle class="bg" cx="60" cy="60" r="50"/>
  <circle class="fg" cx="60" cy="60" r="50" stroke-dasharray="${len} ${C}" stroke-linecap="${len>0&&len<C?'round':'butt'}" transform="rotate(-90 60 60)"/>
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central">${Math.round(pct*100)}%</text></svg>`;
}
function filtSelects(){
  const opt=(v,t,c)=>`<option value="${esc(v)}" ${c===v?'selected':''}>${esc(t)}</option>`;
  const all=order.map(i=>animals.get(i));
  const lotes=[...new Set(all.map(a=>a.lote).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  const eas=[...new Set(all.map(a=>a.ea).filter(Boolean))].sort();
  const rep=[...new Set(all.map(a=>a.estado||'Sin dato'))].sort();
  const sel=(k,html)=>`<select data-p="${k}" class="${P[k]?'set':''}" aria-label="${P_LBL[k]}">${html}</select>`;
  return sel('lote',opt('','Lote: todos',P.lote)+lotes.map(l=>opt(l,l,P.lote)).join(''))+
    sel('ea',opt('','Categoría: todas',P.ea)+eas.map(e=>opt(e,`${e} ${EA_TXT[e]||''}`,P.ea)).join(''))+
    sel('sexo',opt('','Sexo: todos',P.sexo)+opt('H','Hembras',P.sexo)+opt('M','Machos',P.sexo))+
    sel('repro',opt('','Reprod.: todos',P.repro)+rep.map(r=>opt(r,r,P.repro)).join(''));
}
function filtroTxt(){ const t=Object.keys(P).filter(k=>P[k]).map(k=>k==='sexo'?(P.sexo==='H'?'Hembras':'Machos'):P[k]); return t.length?t.join(' · '):'Todos los animales'; }
function progHTML(){
  const b=progBase(), ok=b.filter(a=>a.w.inv).length, f=b.length-ok;
  return `<div class="prog full"><button class="ringbtn" data-a="prog">${ringSVG(ok,b.length)}<div class="ptxt"><b>${ok} de ${b.length} inventariados</b>
  <small><span class="ok">${ok} pasaron</span> · <span class="no">${f} faltan</span></small><small>${esc(filtroTxt())}</small></div><span class="pgo">${f?'Ver faltan':'Ver lista'}</span></button>
  <div class="pfilt">${filtSelects()}</div></div>`;
}
/* ---- tabla de inventario por lote x estado animal (EA) ---- */
const EA_ORD = ['VP','VS','NV','HL','CH','CM','ML','TR'];
function tablaLotes(modo){
  const t={}, eas=new Set(), ini={};
  for(const id of order){ const a=animals.get(id);
    const l=modo==='inicial'?a.lote:loteNow(a), e=modo==='inicial'?a.ea:eaNow(a);
    eas.add(e); (t[l]=t[l]||{})[e]=(t[l][e]||0)+1;
    ini[a.lote]=(ini[a.lote]||0)+1;
  }
  const cols=[...eas].sort((x,y)=>(EA_ORD.indexOf(x)+1||99)-(EA_ORD.indexOf(y)+1||99)||x.localeCompare(y));
  const lotes=Object.keys(t).sort((x,y)=>x.localeCompare(y,'es'));
  return {t,cols,lotes,ini};
}
function tablaLotesHTML(){
  const {t,cols,lotes,ini}=tablaLotes(TL), base=TL==='actual'?tablaLotes('inicial').t:null;
  const tot=l=>cols.reduce((s,c)=>s+(t[l][c]||0),0);
  const colTot=c=>lotes.reduce((s,l)=>s+(t[l][c]||0),0);
  const celda=(l,c)=>{ const v=t[l][c]||0, b=base?((base[l]||{})[c]||0):v;
    return `<td class="${v!==b?'chg':''} ${v?'':'z'}">${v||'·'}</td>`; };
  const dif=l=>{ if(!base) return ''; const d=tot(l)-(ini[l]||0); return d?`<small class="${d>0?'up':'dn'}">${d>0?'+':'−'}${Math.abs(d)}</small>`:''; };
  const N=order.length;
  return `<div class="tlhead"><b>Inventario por lote</b><div class="seg sm"><button data-tl="inicial" class="${TL==='inicial'?'on':''}">Inicial</button><button data-tl="actual" class="${TL==='actual'?'on':''}">Actual</button></div></div>
  <p class="hint tlnote">${TL==='inicial'?'Como se cargó el Excel, antes de cualquier cambio.':'Con los movimientos, entores y destetes registrados. En azul lo que cambió; ± frente al inicial.'}</p>
  <div class="tlscroll"><table class="tlot"><thead><tr><th class="lt">Lote</th>${cols.map(c=>`<th title="${esc(EA_TXT[c]||c)}">${esc(c)}</th>`).join('')}<th class="tt">Total</th></tr></thead>
  <tbody>${lotes.map(l=>`<tr><td class="lt">${esc(l)}</td>${cols.map(c=>celda(l,c)).join('')}<td class="tt">${tot(l)}${dif(l)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td class="lt">Total</td>${cols.map(c=>`<td>${colTot(c)}</td>`).join('')}<td class="tt">${N}</td></tr></tfoot></table></div>
  <p class="hint tlnote">${cols.map(c=>`${c}: ${EA_TXT[c]||c}`).join(' · ')}</p>`;
}
function abrirTabla(){
  modal(`<div class="chead"><div class="num" style="font-size:calc(24px*var(--k))">Inventario por lote</div><button class="close" data-a="closeM">Cerrar</button></div>
  <div class="tlwrap open">${tablaLotesHTML()}</div>`);
}
function abrirProg(){
  const b=progBase(), hechos=b.filter(a=>a.w.inv), faltan=b.filter(a=>!a.w.inv);
  const lista=pSeg==='faltan'?faltan:hechos;
  const fila=a=>`<button class="res ${a.w.inv?'done':''}" data-pinv="${esc(a.id)}"><b>${esc(a.id)}</b><span>${esc(a.ea)} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))} · ${esc(a.lote)}</span></button>`;
  const m=modal(`<div class="chead"><div class="num">Inventario</div><button class="close" data-a="closeM">Cerrar</button></div>
  <div class="prog pbig"><div class="ringbtn">${ringSVG(hechos.length,b.length)}<div class="ptxt"><b>${hechos.length} de ${b.length}</b><small><span class="ok">${hechos.length} pasaron</span> · <span class="no">${faltan.length} faltan</span></small><small>${esc(filtroTxt())}</small></div></div>
  <div class="pfilt">${filtSelects()}</div></div>
  <div class="seg"><button data-pseg="faltan" class="${pSeg==='faltan'?'on':''}">Faltan (${faltan.length})</button><button data-pseg="hechos" class="${pSeg==='hechos'?'on':''}">Ya pasaron (${hechos.length})</button></div>
  <p class="hint">${lista.length?'Toque un animal para abrirlo en Inventario.':pSeg==='faltan'?'No falta ningún animal con este filtro.':'Aún no ha pasado ningún animal con este filtro.'}</p>
  <div class="plist">${lista.map(fila).join('')}</div>`);
  progOpen=true;
  return m;
}
function pintarResultados(){
  const f=F[tab], el=$('#res'); if(!el) return;
  const q=(f.q||'').trim();
  if(!q){ el.innerHTML=''; return; }
  const {items,exact}=buscar(q);
  if(!items.length){ el.innerHTML=`<div class="alert a">El ${esc(q)} no está en el inventario. Anótelo en papel para verificarlo después.</div>`; return; }
  const many=exact>1?`<div class="alert b">Hay ${exact} coincidencias. Elija el animal correcto.</div>`:'';
  el.innerHTML=many+items.slice(0,exact>1?7:4).map((a,i)=>`<button class="res ${i<exact?'first':''}" data-pick="${esc(a.id)}"><b>${esc(a.id)}</b><span>${esc(eaNow(a))} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))} · ${esc(loteNow(a))}</span></button>`).join('');
}
function pick(id){
  const a=animals.get(id); if(!a) return;
  if(tab==='dest'){
    let mid=id; if(esCria(a)&&a.madre&&animals.has(a.madre)) mid=a.madre;
    const m=animals.get(mid), cs=esCria(m)?[m.id]:(crias.get(mid)||[]);
    F.dest={id:mid, criaId:cs[0]||null, inv:true};
    if(cs[0]) cargarDest(cs[0]);
  } else if(tab==='palp'){
    const p=a.w.palp;
    F.palp={id, inv:a.w.inv!==false, modo:p?p.res:'', dias:p&&p.res==='P'?p.dias:null, det:p?p.det:'', manual:'', obs:a.w.obs||'', mov:''};
  } else if(tab==='peso'){
    const p=a.w.peso;
    F.peso={id, inv:a.w.inv!==false, valor:p?String(p.peso):'', entore:!!a.w.entore, loteEnt:a.w.entore?a.w.entore.lote:CFG.loteEntore, obs:a.w.obs||'', mov:''};
  } else F.inv={id, inv:a.w.inv!==false, obs:a.w.obs||'', mov:''};
  F[tab]._ini=snap(F[tab]);
  $('#main').scrollTop=0; renderMain();
}
/* ---- aviso de datos sin guardar ---- */
const TAB_TXT = {inv:'Inventario',palp:'Palpar',peso:'Pesar',dest:'Destete'};
function snap(f){ const o={}; for(const k of Object.keys(f).sort()) if(!['q','abc','_ini'].includes(k)) o[k]=f[k]; return JSON.stringify(o); }
function sinGuardar(){
  const f=F[tab]; if(!f||!f.id||!TAB_TXT[tab]) return false;
  if(snap(f)!==f._ini) return true;
  const a=animals.get(f.id);   // en Inventario: abrió el animal pero aún no queda inventariado
  return tab==='inv'&&a&&f.inv&&!a.w.inv;
}
const SAVE = {inv:()=>saveInv(),palp:()=>savePalp(),peso:()=>savePeso(),dest:()=>saveDest()};
/* Devuelve true si se puede salir de la pantalla actual */
function salir(){
  if(!sinGuardar()) return Promise.resolve(true);
  const t=tab, id=F[t].id;
  return new Promise(res=>{
    const m=modal(`<h2>No ha guardado</h2><p>El animal <b>${esc(id)}</b> tiene datos sin guardar en ${TAB_TXT[t]}.</p>
    <button class="big" id="gSave">Guardar ahora</button><button class="big sec" id="gBack">Volver</button><button class="big danger" id="gOut">Salir sin guardar</button>`);
    m.querySelector('#gBack').onclick=()=>{ closeModal(); res(false); };
    m.querySelector('#gOut').onclick=()=>{ closeModal(); F[t]={}; res(true); };
    m.querySelector('#gSave').onclick=async()=>{ closeModal(); await SAVE[t](); res(!F[t].id); };
  });
}
function cargarDest(cid){
  const c=animals.get(cid), d=c.w.dest, f=F.dest;
  f.criaId=cid; f.dec=d?d.dec:''; f.peso=d&&d.peso?String(d.peso):''; f.dst=d?d.dst:''; f.nuevo=d?d.nuevo:'';
  const m=animals.get(f.id); f.obs=m.w.obs||''; f.mov='';
  f._ini=snap(f);
}
function kv(items){ return `<div class="kv">${items.filter(Boolean).map(([k,v,w])=>`<div class="${w?'wide':''}"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>`; }
function head(a){
  const tags=[`<span class="tag">${esc(eaNow(a))} · ${esc(EA_TXT[eaNow(a)]||'')}</span>`];
  if(a.w.inv) tags.push('<span class="tag g">Inventariado</span>');
  if(a.nombre) tags.push(`<span class="tag">${esc(a.nombre)}</span>`);
  if(a.w.mov) tags.push(`<span class="tag b">Movido a ${esc(a.w.mov.a)}</span>`);
  return `<div class="chead"><div class="num">${esc(a.id)}</div><button class="close" data-a="clear">Otro animal</button></div><div class="tags">${tags.join('')}</div>`;
}
const comentLine = a => a.coment ? ['Comentario',a.coment,true] : null;
function comunes(a,f,opts={}){
  const lotes=meta.lotes.filter(l=>l!==loteNow(a));
  const sel=lotes.map(l=>`<option ${f.mov===l?'selected':''}>${esc(l)}</option>`).join('');
  const q=opts.noMov?[]:rapidos(a);
  const quick=q.length?`<div class="quick"><small>Mover rápido (últimos destinos)</small><div class="opts">${q.map(l=>`<button class="opt ${f.mov===l?'on':''}" data-qmov="${esc(l)}">→ ${esc(l)}</button>`).join('')}</div></div>`:'';
  return `<button class="switch ${f.inv?'on':''}" data-a="toggleInv"><span>Inventariado</span><i></i></button>
  ${quick}${opts.noMov?'':`<details ${f.mov?'open':''}><summary>Mover de lote${f.mov?`: ${esc(f.mov)}`:''}</summary><div class="inner"><div class="field"><label for="fMov">Lote actual: ${esc(loteNow(a))}</label>
  <select id="fMov" data-f="mov"><option value="">Sin mover</option>${sel}<option value="__otro">Otro lote…</option></select></div></div></details>`}
  <details ${f.obs?'open':''}><summary>Observación</summary><div class="inner"><div class="field"><textarea data-f="obs" aria-label="Observación" placeholder="Opcional">${esc(f.obs||'')}</textarea></div></div></details>`;
}

/* ---- inventario ---- */
function viewInv(a){
  const f=F.inv;
  return `<div class="card">${head(a)}${kv([['Color',colorTxt(a)],['I.E.',ieTxt(a)],['Lote',loteNow(a)],[a.ea==='TR'||!esCria(a)&&a.emes>=24?'Edad':'Edad',a.emes>=24?`${num(anosNow(a))} años`:`${num(mesesNow(a))} meses`],['Sexo',a.sexo==='H'?'Hembra':'Macho'],a.madre?['Madre',a.madre]:null,comentLine(a)])}</div><!--R-->
  ${comunes(a,f)}
  <div class="savebar"><button class="big" data-a="saveInv">Guardar</button></div>`;
}
async function saveInv(){
  const a=animals.get(F.inv.id), f=F.inv, w=clone(a.w), ts=stamp();
  aplicarComunes(a,w,f,ts);
  await guardar([[a,w]], `${a.id}: ${f.inv?'inventariado':'guardado'}`); F.inv={}; render();
}
/* Últimos destinos usados: primero los que salieron del mismo lote */
function recordarMov(de,a){ const r=(meta.recMov||[]).filter(x=>!(x.de===de&&x.a===a)); r.unshift({de,a}); meta.recMov=r.slice(0,15); }
function rapidos(a){
  const cur=loteNow(a), r=meta.recMov||[], out=[];
  for(const x of [...r.filter(x=>x.de===cur),...r]) if(x.a!==cur&&!out.includes(x.a)) out.push(x.a);
  return out.slice(0,3);
}
function aplicarComunes(a,w,f,ts,sinMov){
  if(f.inv!==!!w.inv||(f.inv&&!w.invTs)){ w.inv=f.inv; w.invTs=ts; }
  if(!sinMov && f.mov){ recordarMov(loteNow(a),f.mov); w.mov={de:a.lote,a:f.mov,motivo:'Movimiento',ts}; }
  const o=(f.obs||'').trim();
  if(o!==(w.obs||'')){ if(o){ w.obs=o; w.obsTs=ts; } else { delete w.obs; delete w.obsTs; } }
  w.ts=ts;
}
async function guardar(changes,msg){
  const prev=changes.map(([a])=>[a,clone(a.w)]);
  await commit(changes,1); renderTop();
  toast('Guardado ✓ '+msg, async()=>{ await commit(prev,-1); });
  recordatorio();
}

/* ---- palpación ---- */
function viewPalp(a){
  const f=F.palp;
  if(!puedePalpar(a)) return `<div class="card">${head(a)}${kv([['Color',colorTxt(a)],['Lote',loteNow(a)]])}</div><div class="alert a">Esta categoría no se palpa.</div><button class="big sec" data-a="toInv">Ir a inventario manual</button>`;
  const pren=a.estado==='Preñada', g=gestNow(a), ya=a.w.palp;
  const items=[['Estado reprod.',estadoNow(a)],['Color',colorTxt(a)],['I.E.',ieTxt(a)],['Lote',loteNow(a)],['Edad',`${num(anosNow(a))} años`],['EA',eaNow(a)],['#P',a.np],
    estadoNow(a)==='Preñada'?['Gest.',`${g} días`]:null,['D.Ab',dabNow(a)],['UIEP',a.uiep],estadoNow(a)==='Vacía'?['Det. Ult. Tacto',detNow(a)||'Sin dato']:null,comentLine(a)];
  const bt=(k,t,c='')=>`<button class="opt ${c} ${f.modo===k?'on':''}" data-modo="${k}">${t}</button>`;
  let out=`<div class="card">${head(a)}${kv(items)}</div><!--R-->`;
  if(ya) out+=`<div class="alert b">Ya tiene palpación registrada. Puede corregirla aquí.</div>`;
  if(pren&&gestBaseNow(a)>=CFG.gestRevisar) out+=`<div class="alert a">Revisar: registra ${gestBaseNow(a)} días de gestación.</div>`;
  out+=`<div class="opts ${pren?'c3':''}">${pren?bt('C','Confirmar preñez')+bt('P','Cambiar días')+bt('V','Vacía','bad'):bt('P','Preñada')+bt('V','Vacía','bad')}</div>`;
  if(f.modo==='C') out+=`<div class="alert g">Se confirma la preñez con ${gestBaseNow(a)} días.</div>`;
  if(f.modo==='P'){
    const m=String(f.manual||'');
    out+=`<div><h3>Días de gestación</h3><div class="opts c4">${DIAS.map(d=>`<button class="opt ${f.dias===d&&!m?'on':''}" data-dias="${d}">${d}</button>`).join('')}</div></div>
    <div class="field"><label for="fManual">Otro valor</label><input id="fManual" data-f="manual" inputmode="numeric" pattern="[0-9]*" value="${esc(m)}" placeholder="Días"></div><div id="live">${alertasGest(a,f)}</div>`;
  }
  if(f.modo==='V'){
    if(pren) out+=`<div class="alert r">Estaba preñada con ${gestBaseNow(a)} días: posible aborto.</div>`;
    out+=`<div><h3>Estado de ovarios / detalle</h3><div class="opts c3">${OVARIOS.map(o=>`<button class="opt ${f.det===o?'on':''}" data-det="${o}">${o}</button>`).join('')}</div></div>`;
  }
  out+=comunes(a,f);
  out+=`<div class="savebar"><button class="big" data-a="savePalp">${ya?'Guardar corrección':'Guardar'}</button></div>`;
  return out;
}
const diasForm = f => { const m=parseInt(f.manual,10); return Number.isFinite(m)?m:f.dias; };
function alertasGest(a,f){
  const d=diasForm(f); if(!d) return ''; const r=[];
  if(d>=CFG.gestRevisar) r.push(`Revisar: ${d} días de gestación.`);
  if(a.estado==='Vacía'&&dabNow(a)>0&&d>dabNow(a)) r.push(`Los días de gestación (${d}) superan los días abiertos (${dabNow(a)}).`);
  return r.map(t=>`<div class="alert a">${esc(t)}</div>`).join('');
}
async function savePalp(){
  const f=F.palp, a=animals.get(f.id);
  if(!f.modo) return alertBox('Falta el resultado','Seleccione un resultado de palpación.');
  const w=clone(a.w), ts=stamp(), alertas=[]; let p;
  const pren=a.estado==='Preñada';
  if(f.modo==='C') p={res:'C',dias:gestBaseNow(a),det:''};
  else if(f.modo==='P'){
    const d=diasForm(f);
    if(!d||d<1||d>400) return alertBox('Faltan los días','Seleccione o escriba los días de gestación.');
    if(d>=CFG.gestRevisar) alertas.push('Gestación para revisar');
    if(a.estado==='Vacía'&&dabNow(a)>0&&d>dabNow(a)) alertas.push('Gestación mayor que días abiertos');
    if(alertas.length&&!await confirmBox('Revise el dato',`${d} días: ${alertas.join('. ')}.`,'Guardar igual')) return;
    p={res:'P',dias:d,det:''};
  } else {
    if(!f.det) return alertBox('Falta el detalle','Seleccione el estado de ovarios o el detalle.');
    if(pren){ if(!await confirmBox('Posible aborto',`${a.id} estaba preñada con ${gestBaseNow(a)} días y ahora sale vacía.`,'Sí, quedó vacía',true)) return; alertas.push('Posible aborto'); }
    p={res:'V',dias:0,det:f.det};
  }
  w.palp={...p,prev:a.estado,prevGest:gestBaseNow(a),alerta:alertas.join('; '),ts};
  aplicarComunes(a,w,f,ts);
  await guardar([[a,w]],`${a.id}: ${p.res==='V'?'Vacía '+p.det:`Preñada ${p.dias} d`}`); F.palp={}; render();
}

/* ---- pesaje ---- */
function calcPeso(a,val){
  const r={alertas:[]}; const p=parseFloat(String(val).replace(',','.')); if(!Number.isFinite(p)||p<=0) return r;
  r.peso=p;
  if(p<CFG.hlMin||p>CFG.hlMax) r.alertas.push({n:'r',t:`Peso fuera del rango (${CFG.hlMin} a ${CFG.hlMax} kg): posible error de digitación.`});
  if(a.upeso>0&&a.fupeso){
    r.dias=daysBetween(a.fupeso,today());
    if(r.dias>0){
      r.gmd=(p-a.upeso)/r.dias*1000; r.kgmes=r.gmd*30/1000;
      if(r.gmd<CFG.gmdMin||r.gmd>CFG.gmdMax) r.alertas.push({n:'r',t:`GMD de ${num(r.gmd,0)} g/día: posible error.`});
      else if(r.gmd<0) r.alertas.push({n:'a',t:`Alerta de pérdida de peso: ${num(r.gmd,0)} g/día.`});
    }
  }
  return r;
}
function livePeso(a,f){
  const c=calcPeso(a,f.valor); let h='';
  if(c.peso){
    h+=c.gmd!==undefined?`<div class="calc"><div><b>${num(c.gmd,0)}</b><small>g/día en ${c.dias} días</small></div><div><b>${num(c.kgmes)}</b><small>kg/mes</small></div></div>`:`<div class="alert b">Sin peso anterior para calcular GMD.</div>`;
    h+=c.alertas.map(x=>`<div class="alert ${x.n}">${esc(x.t)}</div>`).join('');
    if(c.peso>CFG.entoreMin){
      const ls=meta.lotes.map(l=>`<option ${f.loteEnt===l?'selected':''}>${esc(l)}</option>`).join('');
      h+=`<button class="switch ${f.entore?'on':''}" data-a="toggleEntore"><span>ENTORE: pasa a toro</span><i></i></button>`;
      if(f.entore) h+=`<div class="field"><label for="fEnt">Lote destino</label><select id="fEnt" data-f="loteEnt">${ls}<option value="__otro">Otro lote…</option></select></div>`;
    }
  }
  return h;
}
function viewPeso(a){
  const f=F.peso;
  if(a.ea!=='HL') return `<div class="card">${head(a)}${kv([['Color',colorTxt(a)],['Lote',loteNow(a)]])}</div><div class="alert a">Solo se pesan las hembras de levante.</div><button class="big sec" data-a="toInv">Ir a inventario manual</button>`;
  return `<div class="card">${head(a)}${kv([['Color',colorTxt(a)],['Lote',loteNow(a)],['Edad',`${num(mesesNow(a))} meses`],['Fecha último peso',fmtD(a.fupeso)],['Último peso',a.upeso?`${num(a.upeso)} kg`:'—'],['GMD anterior',gmdLabel(a)],['I.E.',ieTxt(a),true],comentLine(a)])}</div><!--R-->
  ${a.w.peso?'<div class="alert b">Ya tiene peso registrado. Puede corregirlo aquí.</div>':''}
  <div class="field"><label for="fPeso">Peso nuevo (kg)</label><input class="huge" id="fPeso" data-f="valor" inputmode="decimal" value="${esc(f.valor)}" placeholder="kg"></div>
  <div id="live" style="display:flex;flex-direction:column;gap:10px">${livePeso(a,f)}</div>
  ${comunes(a,f,{noMov:f.entore})}
  <div class="savebar"><button class="big" data-a="savePeso">${a.w.peso?'Guardar corrección':'Guardar'}</button></div>`;
}
async function savePeso(){
  const f=F.peso, a=animals.get(f.id), c=calcPeso(a,f.valor);
  if(!c.peso) return alertBox('Falta el peso','Digite el peso del animal.');
  if(c.alertas.some(x=>x.n==='r')&&!await confirmBox('Posible error de digitación',`${f.valor} kg. ${c.alertas.map(x=>x.t).join(' ')}`,'Guardar igual',false,'Corregir')) return;
  const w=clone(a.w), ts=stamp(), ent=f.entore&&c.peso>CFG.entoreMin;
  w.peso={peso:c.peso,pesoAnt:a.upeso,fechaAnt:a.fupeso,dias:c.dias??null,gmd:c.gmd??null,kgmes:c.kgmes??null,alerta:c.alertas.map(x=>x.t).join(' '),ts};
  if(ent){ w.entore={lote:f.loteEnt,peso:c.peso,ts}; w.mov={de:a.lote,a:f.loteEnt,motivo:'Entore',ts}; }
  else if(w.entore){ delete w.entore; if(w.mov&&w.mov.motivo==='Entore') delete w.mov; }
  aplicarComunes(a,w,f,ts,ent);
  await guardar([[a,w]],`${a.id}: ${num(c.peso)} kg${ent?' · ENTORE':''}`); F.peso={}; render();
}

/* ---- destete ---- */
function viewDest(a){
  const f=F.dest, list=esCria(a)?[a.id]:(crias.get(a.id)||[]);
  if(!list.length) return `<div class="card">${head(a)}${kv([['Color',colorTxt(a)],['Lote',loteNow(a)]])}</div><div class="alert a">Esta vaca no tiene cría registrada.</div><button class="big sec" data-a="toInv">Ir a inventario manual</button>`;
  const c=animals.get(f.criaId);
  const multi=list.length>1?`<div class="opts">${list.map(i=>`<button class="opt ${i===f.criaId?'on':''}" data-cria="${esc(i)}">${esc(i)}</button>`).join('')}</div>`:'';
  let h=`<div class="card">${head(a)}${esCria(a)?'':kv([['Color',colorTxt(a)],['Lote',loteNow(a)]])}</div>${multi}
  <div class="card"><h3>Cría</h3>${kv([['# de la cría',c.id],['Sexo cría',c.sexo==='H'?'Hembra':'Macho'],['Edad',`${num(mesesNow(c))} meses`],['Color',colorTxt(c)],c.az?['Chapeta','AZ '+c.az,true]:null,comentLine(c)])}</div><!--R-->
  ${c.w.dest?'<div class="alert b">Ya tiene decisión registrada. Puede corregirla aquí.</div>':''}
  <div class="opts"><button class="opt ${f.dec==='si'?'on':''}" data-dec="si">Destetar</button><button class="opt bad ${f.dec==='no'?'on':''}" data-dec="no">No destetar</button></div>`;
  if(f.dec==='si'){
    h+=`<div class="field"><label for="fDP">Peso al destete (kg)</label><input class="huge" id="fDP" data-f="peso" inputmode="decimal" value="${esc(f.peso||'')}" placeholder="kg"></div><div id="live">${alertaDP(f)}</div>
    <div class="opts"><button class="opt ${f.dst==='finca'?'on':''}" data-dst="finca">Queda en finca</button><button class="opt ${f.dst==='venta'?'on':''}" data-dst="venta">Venta</button></div>`;
    if(f.dst==='finca') h+=`<div class="field"><label for="fNew">Número nuevo de la cría</label><input class="huge" id="fNew" data-f="nuevo" autocapitalize="characters" autocomplete="off" value="${esc(f.nuevo||'')}" placeholder="Número"></div><div class="alert g">Cría y madre pasan al lote ${CFG.loteDestete}.</div>`;
    if(f.dst==='venta') h+=`<div class="alert g">La cría pasa al lote ${CFG.loteVenta} y la madre al lote ${CFG.loteDestete}.</div>`;
  }
  h+=comunes(a,f,{noMov:f.dec==='si'});
  h+=`<div class="savebar"><button class="big" data-a="saveDest">${c.w.dest?'Guardar corrección':'Guardar'}</button></div>`;
  return h;
}
const alertaDP = f => { const p=parseFloat(String(f.peso||'').replace(',','.')); return Number.isFinite(p)&&(p<CFG.destMin||p>CFG.destMax)?`<div class="alert r">Peso fuera del rango (${CFG.destMin} a ${CFG.destMax} kg): posible error de digitación.</div>`:''; };
async function saveDest(){
  const f=F.dest, m=animals.get(f.id), c=animals.get(f.criaId);
  if(!f.dec) return alertBox('Falta la decisión','Seleccione Destetar o No destetar.');
  const ts=stamp(), wc=clone(c.w), same=m.id===c.id, wm=same?wc:clone(m.w);
  if(wc.dest&&wc.mov&&wc.mov.motivo==='Destete') delete wc.mov;
  if(!same&&wm.mov&&wm.mov.motivo==='Destete'&&wm.destMadre===c.id) delete wm.mov;
  if(f.dec==='si'){
    const p=parseFloat(String(f.peso||'').replace(',','.'));
    if(!Number.isFinite(p)||p<=0){ if(!await confirmBox('Sin peso al destete','No digitó el peso al destete.','Guardar sin peso',false,'Digitar peso')) return; }
    else if(p<CFG.destMin||p>CFG.destMax){ if(!await confirmBox('Posible error de digitación',`${f.peso} kg está fuera del rango de ${CFG.destMin} a ${CFG.destMax} kg.`,'Guardar igual',false,'Corregir')) return; }
    if(!f.dst) return alertBox('Falta el destino','Seleccione Queda en finca o Venta.');
    const nuevo=(f.nuevo||'').trim().toUpperCase();
    if(f.dst==='finca'){
      if(!nuevo) return alertBox('Falta el número','Escriba el número nuevo de la cría.');
      const usado=animals.has(nuevo)&&nuevo!==c.id||order.some(i=>i!==c.id&&animals.get(i).w.dest&&animals.get(i).w.dest.nuevo===nuevo);
      if(usado&&!await confirmBox('Número repetido',`El número ${nuevo} ya existe en esta finca.`,'Guardar igual',false,'Corregir')) return;
    }
    const lc=f.dst==='venta'?CFG.loteVenta:CFG.loteDestete;
    wc.dest={dec:'si',peso:Number.isFinite(p)&&p>0?p:null,dst:f.dst,nuevo:f.dst==='finca'?nuevo:'',lote:lc,madre:same?'':m.id,ts};
    wc.mov={de:c.lote,a:lc,motivo:'Destete',ts};
    if(!same){ wm.destMadre=c.id; wm.mov={de:m.lote,a:CFG.loteDestete,motivo:'Destete',ts}; }
  } else {
    wc.dest={dec:'no',peso:null,dst:'',nuevo:'',lote:'',madre:same?'':m.id,ts};
    if(!same) delete wm.destMadre;
  }
  if(f.inv){ if(!wc.inv){ wc.inv=true; wc.invTs=ts; } }
  wc.ts=ts;
  aplicarComunes(m,wm,f,ts,f.dec==='si');
  await guardar(same?[[c,wc]]:[[c,wc],[m,wm]],`${c.id}: ${f.dec==='si'?(f.dst==='venta'?'destete, venta':'destete, queda en finca'):'no se desteta'}`);
  F.dest={}; render();
}

/* ---- listado ---- */
function filtrar(){
  const q=L.q.trim();
  return order.map(i=>animals.get(i)).filter(a=>{
    if(L.sexo&&a.sexo!==L.sexo) return false;
    if(L.lote&&loteNow(a)!==L.lote) return false;
    if(L.ea&&eaNow(a)!==L.ea) return false;
    if(L.repro&&estadoNow(a)!==L.repro) return false;
    if(L.inv==='si'&&!a.w.inv) return false;
    if(L.inv==='no'&&a.w.inv) return false;
    if(L.reg==='palp'&&!a.w.palp) return false;
    if(L.reg==='pren'&&!(a.w.palp&&a.w.palp.res!=='V')) return false;
    if(L.reg==='peso'&&!a.w.peso) return false;
    if(L.reg==='entore'&&!a.w.entore) return false;
    if(L.reg==='dest'&&!(a.w.dest&&a.w.dest.dec==='si')) return false;
    if(L.reg==='mov'&&!a.w.mov) return false;
    if(L.reg==='alerta'&&!((a.w.palp&&a.w.palp.alerta)||(a.w.peso&&a.w.peso.alerta))) return false;
    if(q){ const n=norm(q); if(!(norm(a.id).startsWith(n)||(a.ie&&a.ie.slice(-5).startsWith(q))||(a.az&&stripZ(a.az)===n))) return false; }
    return true;
  });
}
function rowHTML(a){
  const w=a.w, t=[];
  if(w.inv) t.push('<span class="tag g">Inventariado</span>');
  if(w.palp) t.push(w.palp.res==='V'?`<span class="tag ${w.palp.alerta?'r':''}">Vacía ${esc(w.palp.det)}</span>`:`<span class="tag g">Preñada ${gestNow(a)} d</span>`);
  if(w.peso) t.push(`<span class="tag ${w.peso.alerta?'a':''}">${num(w.peso.peso)} kg</span>`);
  if(w.entore) t.push('<span class="tag b">Entore</span>');
  if(w.dest) t.push(w.dest.dec==='si'?`<span class="tag b">Destete ${w.dest.dst==='venta'?'venta':'finca'}</span>`:'<span class="tag">No destetado</span>');
  if(w.destMadre) t.push(`<span class="tag b">Destetó ${esc(w.destMadre)}</span>`);
  if(w.mov) t.push(`<span class="tag b">→ ${esc(w.mov.a)}</span>`);
  if(w.obs) t.push('<span class="tag">Obs.</span>');
  return `<button class="row ${w.inv?'done':''}" data-det="${esc(a.id)}" data-open="1"><div class="l1"><b>${esc(a.id)}</b><span>${esc(eaNow(a))} · ${esc(colorTxt(a))} · ${esc(loteNow(a))} · ${esc(estadoNow(a)||'')}</span></div>${t.length?`<div class="tags">${t.join('')}</div>`:''}</button>`;
}
function statsList(){
  const all=order.map(i=>animals.get(i)), inv=all.filter(a=>a.w.inv).length;
  return `<div class="stats"><div><b>${order.length}</b><small>Total</small></div><div><b>${inv}</b><small>Inventariados</small></div><div><b>${order.length-inv}</b><small>Faltan</small></div><div><b>${all.filter(a=>a.w.palp&&a.w.palp.res!=='V').length}</b><small>Preñadas hoy</small></div></div>`;
}
function viewList(){
  const opt=(v,t,c)=>`<option value="${esc(v)}" ${c===v?'selected':''}>${esc(t)}</option>`;
  const lotes=[...new Set(order.map(i=>loteNow(animals.get(i))))].sort();
  const eas=[...new Set(order.map(i=>eaNow(animals.get(i))))].sort();
  const seg=`<div class="seg"><button data-lv="mov" class="${L.vista==='mov'?'on':''}">Resumen de movimientos</button><button data-lv="anim" class="${L.vista!=='mov'?'on':''}">Animales</button></div>`;
  if(L.vista==='mov') return seg+viewMov();
  return `${seg}${statsList()}<div class="filters">
  <input data-l="q" placeholder="Buscar número o chapeta" value="${esc(L.q)}" autocomplete="off">
  <select data-l="sexo" aria-label="Sexo">${opt('','Sexo: todos',L.sexo)+opt('H','Hembras',L.sexo)+opt('M','Machos',L.sexo)}</select>
  <select data-l="lote" aria-label="Lote">${opt('','Lote: todos',L.lote)+lotes.map(l=>opt(l,l,L.lote)).join('')}</select>
  <select data-l="ea" aria-label="Estado del animal">${opt('','Estado: todos',L.ea)+eas.map(e=>opt(e,`${e} ${EA_TXT[e]||''}`,L.ea)).join('')}</select>
  <select data-l="inv" aria-label="Inventario">${opt('','Inventario: todos',L.inv)+opt('si','Inventariados',L.inv)+opt('no','Sin inventariar',L.inv)}</select>
  <select data-l="repro" aria-label="Reproductivo">${opt('','Reprod.: todos',L.repro)+opt('Preñada','Preñadas',L.repro)+opt('Vacía','Vacías',L.repro)}</select>
  <select data-l="reg" aria-label="Registros">${opt('','Registros: todos',L.reg)+opt('palp','Palpadas',L.reg)+opt('pren','Pasaron preñadas',L.reg)+opt('peso','Pesados',L.reg)+opt('entore','Entoradas',L.reg)+opt('dest','Destetados',L.reg)+opt('mov','Movidos',L.reg)+opt('alerta','Con alerta',L.reg)}</select>
  </div><div id="listBody">${listBody()}</div>`;
}
function listBody(){ const r=filtrar(); return `<p class="hint">${r.length} animales</p><div class="list grid">${r.map(rowHTML).join('')}</div>`; }
/* ---- resumen de movimientos: lote de origen -> lote de destino ---- */
const MOTIVOS = ['Movimiento','Entore','Destete'];
function movResumen(){
  const g=new Map();
  for(const id of order){ const a=animals.get(id), m=a.w.mov; if(!m) continue;
    const k=m.de+'\u0001'+m.a;
    if(!g.has(k)) g.set(k,{de:m.de||'Sin lote',a:m.a,n:0,mot:{},ids:[]});
    const r=g.get(k); r.n++; r.mot[m.motivo]=(r.mot[m.motivo]||0)+1; r.ids.push(id);
  }
  return [...g.values()].sort((x,y)=>x.de.localeCompare(y.de,'es')||y.n-x.n||x.a.localeCompare(y.a,'es'));
}
const motTxt = r => MOTIVOS.filter(m=>r.mot[m]).map(m=>`${m==='Movimiento'?'Manual':m} ${r.mot[m]}`).join(' · ');
/* Cuántos había en cada lote al cargar el Excel y cuántos hay ahora */
function conteoLotes(){
  const ini={}, hoy={};
  for(const id of order){ const a=animals.get(id); ini[a.lote]=(ini[a.lote]||0)+1; const l=loteNow(a); hoy[l]=(hoy[l]||0)+1; }
  return {ini,hoy};
}
function viewMov(){
  movRows=movResumen(); const {ini,hoy}=conteoLotes(); const tot=movRows.reduce((s,r)=>s+r.n,0);
  if(!movRows.length) return '<p class="hint">Aún no se ha movido ningún animal de lote.</p>';
  const lotesO=new Set(movRows.map(r=>r.de)).size, lotesD=new Set(movRows.map(r=>r.a)).size;
  return `<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>${tot}</b><small>Animales movidos</small></div><div><b>${lotesO}</b><small>Lotes de origen</small></div><div><b>${lotesD}</b><small>Lotes de destino</small></div></div>
  <table class="mtab"><thead><tr><th>Lote origen</th><th></th><th>Lote destino</th><th class="n">Movidos</th><th class="n">Quedan en origen</th></tr></thead><tbody>
  ${movRows.map((r,i)=>`<tr data-mv="${i}"><td><b>${esc(r.de)}</b></td><td class="ar">→</td><td><b>${esc(r.a)}</b><small>${esc(motTxt(r))}</small></td><td class="n">${r.n}</td><td class="n">${hoy[r.de]||0}<small>de ${ini[r.de]||0}</small></td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${tot}</td><td></td></tr></tfoot></table>
  <p class="hint">Toque una fila para ver los animales. Cuenta el último movimiento de cada animal, desde el lote con que se cargó el Excel. "Quedan en origen" son los animales que hay hoy en ese lote, de los que tenía al cargar.</p>`;
}
function verMov(i){
  const r=movRows[i]; if(!r) return;
  modal(`<div class="chead"><div class="num" style="font-size:calc(24px*var(--k))">${esc(r.de)} → ${esc(r.a)}</div><button class="close" data-a="closeM">Cerrar</button></div>
  <p class="hint">${r.n} animales · ${esc(motTxt(r))}</p>
  <div class="plist">${r.ids.map(id=>{const a=animals.get(id);return `<button class="res" data-det="${esc(id)}" data-open="1"><b>${esc(id)}</b><span>${esc(eaNow(a))} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))} · ${esc(a.w.mov.motivo)}</span></button>`;}).join('')}</div>`);
}
function detalle(id){
  const a=animals.get(id), w=a.w, recs=[];
  const rec=(k,t)=>recs.push(`<div class="rec"><span>${esc(t)}</span><button data-del="${k}" data-id="${esc(id)}">Borrar</button></div>`);
  if(w.inv) rec('inv','Inventariado');
  if(w.palp) rec('palp',w.palp.res==='V'?`Palpación: Vacía ${w.palp.det}`:`Palpación: Preñada ${w.palp.dias} días`);
  if(w.peso) rec('peso',`Peso: ${num(w.peso.peso)} kg`);
  if(w.entore) rec('entore',`Entore: ${w.entore.lote}`);
  if(w.dest) rec('dest',w.dest.dec==='si'?`Destete: ${w.dest.dst==='venta'?'Venta':'Queda en finca, nuevo '+w.dest.nuevo}${w.dest.peso?`, ${num(w.dest.peso)} kg`:''}`:'No destetado');
  if(w.destMadre) rec('destM',`Destetó la cría ${w.destMadre}`);
  if(w.mov&&w.mov.motivo==='Movimiento') rec('mov',`Movimiento: ${w.mov.a}`);
  if(w.obs) rec('obs',`Observación: ${w.obs}`);
  const links=[`<button class="opt" data-go="inv" data-id="${esc(id)}">Inventario</button>`];
  if(puedePalpar(a)) links.push(`<button class="opt" data-go="palp" data-id="${esc(id)}">Palpar</button>`);
  if(a.ea==='HL') links.push(`<button class="opt" data-go="peso" data-id="${esc(id)}">Pesar</button>`);
  if(crias.has(id)||esCria(a)) links.push(`<button class="opt" data-go="dest" data-id="${esc(id)}">Destete</button>`);
  modal(`<div class="chead"><div class="num">${esc(id)}</div><button class="close" data-a="closeM">Cerrar</button></div>
  ${kv([['EA',eaNow(a)],['Color',colorTxt(a)],['I.E.',ieTxt(a)],['Lote',loteNow(a)],['Estado reprod.',estadoNow(a)||'—'],estadoNow(a)==='Preñada'?['Gest.',`${gestNow(a)} días`]:null])}
  <h3>Registros</h3>${recs.join('')||'<p class="hint">Sin registros.</p>'}<h3>Abrir o corregir en</h3><div class="opts">${links.join('')}</div>`);
}
async function borrar(k,id){
  if(k==='destM'){ id=animals.get(id).w.destMadre; k='dest'; }
  const a=animals.get(id);
  if(!await confirmBox('Borrar registro',`Se borrará este registro de ${id}.`,'Borrar',true)) return detalle(id);
  const w=clone(a.w), ts=stamp(), ch=[[a,w]];
  if(k==='inv'){ w.inv=false; w.invTs=ts; }
  if(k==='palp') delete w.palp;
  if(k==='peso'){ delete w.peso; if(w.entore){ delete w.entore; if(w.mov?.motivo==='Entore') delete w.mov; } }
  if(k==='entore'){ delete w.entore; if(w.mov?.motivo==='Entore') delete w.mov; }
  if(k==='mov') delete w.mov;
  if(k==='obs'){ delete w.obs; delete w.obsTs; }
  if(k==='dest'){
    const m=w.dest.madre&&animals.get(w.dest.madre);
    delete w.dest; if(w.mov?.motivo==='Destete') delete w.mov;
    if(m){ const wm=clone(m.w); delete wm.destMadre; if(wm.mov?.motivo==='Destete') delete wm.mov; wm.ts=ts; ch.push([m,wm]); }
  }
  w.ts=ts; await commit(ch,1); render(); toast('Registro borrado'); detalle(id);
}

/* ---------- archivo ---------- */
function viewFile(){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent), standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  const inst=standalone?'':ios?`<div class="alert a">En iPhone, instale la app para proteger los datos: en Safari toque Compartir y luego "Agregar a inicio". Use siempre el ícono, no el navegador.</div>`:
    installEvt?`<button class="big sec" data-a="install">Instalar la app</button>`:'';
  if(!meta) return `<div class="empty"><h2>Cargue el inventario</h2><p>Suba el Excel del Software Ganadero o un archivo de avance descargado de esta app.</p>${inst}<button class="big" data-a="upload">Subir Excel</button><p class="hint">Versión ${VERSION}. Funciona sin internet.</p></div>`;
  const c=meta.cambios||0;
  return `<h2>${esc(meta.finca)}</h2>${inst}
  ${statsList()}
  <div class="alert ${c?'a':'g'}">${c?`${c} cambios sin descargar.`:'Todo el avance está descargado.'}</div>
  <button class="big" data-a="download">Descargar Excel</button>
  <button class="big sec" data-a="share">Enviar por WhatsApp o Drive</button>
  <button class="big sec" data-a="upload">Subir otro Excel</button>
  <p class="hint">${order.length} animales · Inventario cargado el ${fmtD(meta.baseDate)}${meta.lastExport?` · Última descarga ${fmtD(meta.lastExport.slice(0,10))} ${meta.lastExport.slice(11,16)}`:''}<br>${persisted===false?'El celular no garantiza el almacenamiento: descargue con frecuencia.<br>':''}Versión ${VERSION}</p>`;
}
const serial = iso => dayN(iso)+25569;
const cD = iso => iso?{t:'n',v:serial(iso),z:'dd/mm/yyyy'}:'';
const fecha = ts => ts?cD(ts.slice(0,10)):'';
const hora = ts => ts?ts.slice(11,16):'';
function hoja(wb,name,head,rows){
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]);
  ws['!cols']=head.map(h=>({wch:Math.max(10,String(h).length+2)}));
  if(rows.length) ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:head.length-1}})};
  XLSX.utils.book_append_sheet(wb,ws,name);
}
function construirExcel(){
  const wb=XLSX.utils.book_new(), all=order.map(i=>animals.get(i));
  hoja(wb,'Inventario',['Número','Nuevo número','Sexo','EA','EA actualizado','Color','I.E.','Lote anterior','Lote actual','Estado reprod.','Gest. hoy','Detalle tacto','Peso nuevo','Inventariado','Observación','Última modificación fecha','Última modificación hora'],
    all.map(a=>{const w=a.w;return [a.id,w.dest?.nuevo||'',a.sexo,a.ea,eaNow(a),a.color,ieTxt(a),a.lote,loteNow(a),estadoNow(a)||'',estadoNow(a)==='Preñada'?gestNow(a):'',detNow(a)||'',w.peso?.peso??w.dest?.peso??'',w.inv?'SI':'NO',w.obs||'',fecha(w.ts),hora(w.ts)];}));
  const P=[],W=[],E=[],D=[],M=[],O=[];
  for(const a of all){ const w=a.w;
    if(w.palp){const p=w.palp;P.push([a.id,ieTxt(a),a.ea,loteNow(a),p.prev||'',p.prevGest||'',p.res==='V'?'Vacía':p.res==='C'?'Preñez confirmada':'Preñada',p.res==='V'?'':p.dias,p.det||'',p.alerta||'',fecha(p.ts),hora(p.ts)]);}
    if(w.peso){const p=w.peso;W.push([a.id,ieTxt(a),loteNow(a),cD(p.fechaAnt),p.pesoAnt||'',p.peso,p.dias??'',p.gmd==null?'':Math.round(p.gmd),p.kgmes==null?'':Math.round(p.kgmes*10)/10,p.alerta||'',fecha(p.ts),hora(p.ts)]);}
    if(w.entore){const p=w.entore;E.push([a.id,ieTxt(a),p.peso,a.lote,p.lote,'NV',fecha(p.ts),hora(p.ts)]);}
    if(w.dest){const d=w.dest;D.push([d.madre||'',a.id,a.sexo==='H'?'Hembra':'Macho',Math.round(mesesNow(a)*10)/10,colorTxt(a),d.dec==='si'?'SI':'NO',d.peso??'',d.dst==='venta'?'Venta':d.dst==='finca'?'Queda en finca':'',d.nuevo||'',d.lote||'',d.dec==='si'&&d.madre?CFG.loteDestete:'',fecha(d.ts),hora(d.ts)]);}
    if(w.mov){const m=w.mov;M.push([a.id,m.de,m.a,m.motivo,fecha(m.ts),hora(m.ts)]);}
    if(w.obs) O.push([a.id,loteNow(a),w.obs,fecha(w.obsTs),hora(w.obsTs)]);
  }
  hoja(wb,'Palpaciones',['Número','I.E.','EA','Lote','Estado anterior','Gest. anterior','Resultado','Días gestación','Detalle','Alerta','Fecha','Hora'],P);
  hoja(wb,'Pesajes',['Número','I.E.','Lote','Fecha peso anterior','Peso anterior','Peso','Días','GMD g/día','Kg/mes','Alerta','Fecha','Hora'],W);
  hoja(wb,'Entores',['Número','I.E.','Peso','Lote anterior','Lote destino','EA nuevo','Fecha','Hora'],E);
  hoja(wb,'Destetes',['Madre','Cría','Sexo cría','Edad meses','Color','Destetada','Peso destete','Destino','Número nuevo','Lote cría','Lote madre','Fecha','Hora'],D);
  hoja(wb,'Movimientos',['Número','Lote anterior','Lote nuevo','Motivo','Fecha','Hora'],M);
  const CL=conteoLotes(), RM=movResumen().map(r=>[r.de,r.a,r.mot.Movimiento||0,r.mot.Entore||0,r.mot.Destete||0,r.n,CL.ini[r.de]||0,CL.hoy[r.de]||0]);
  if(RM.length) RM.push(['TOTAL','',...[2,3,4,5].map(c=>RM.reduce((s,r)=>s+r[c],0)),'','']);
  for(const [modo,nom] of [['inicial','Inv. lote inicial'],['actual','Inv. lote actual']]){
    const {t,cols,lotes}=tablaLotes(modo);
    const rows=lotes.map(l=>{ const v=cols.map(c=>t[l][c]||0); return [l,...v,v.reduce((a,b)=>a+b,0)]; });
    rows.push(['TOTAL',...cols.map((c,i)=>rows.reduce((s,r)=>s+r[i+1],0)),order.length]);
    hoja(wb,nom,['Lote',...cols,'Total'],rows);
  }
  hoja(wb,'Resumen movimientos',['Lote origen','Lote destino','Movimiento manual','Entore','Destete','Total animales','Había en origen','Quedan en origen'],RM);
  hoja(wb,'Observaciones',['Número','Lote','Observación','Fecha','Hora'],O);
  const m={...meta,order:undefined,cambios:0};
  const bk=XLSX.utils.aoa_to_sheet([['APP_CORRAL',1,order.length],['META',JSON.stringify(m)],...all.map(a=>[a.id,JSON.stringify(a)])]);
  XLSX.utils.book_append_sheet(wb,bk,BACKUP_SHEET);
  wb.Workbook={Sheets:wb.SheetNames.map(n=>({name:n,Hidden:n===BACKUP_SHEET?1:0}))};
  return wb;
}
function nombreArchivo(){
  const f=meta.finca.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const d=new Date(); return `Corral_${f}_${today()}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}
function excelFile(){
  const buf=XLSX.write(construirExcel(),{type:'array',bookType:'xlsx',compression:true});
  const name=nombreArchivo();
  return {name,blob:new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})};
}
async function marcarDescargado(){ meta.cambios=0; meta.lastExport=stamp(); await saveMeta(); render(); }
async function descargar(){
  const {name,blob}=excelFile();
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent), standalone=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  if(ios&&standalone) return enviar();
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  await marcarDescargado(); toast('Archivo descargado: '+name);
}
async function enviar(){
  const {name,blob}=excelFile(), file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],title:name}); await marcarDescargado(); toast('Archivo enviado'); }
    catch(e){ if(e.name!=='AbortError') toast('No se pudo enviar. Use Descargar Excel.'); }
  } else return alertBox('No disponible','Este celular no permite enviar directamente. Use Descargar Excel y compártalo desde sus archivos.');
}

/* ---- leer Excel ---- */
function parseDate(v){
  if(typeof v==='number'&&v>1000) return new Date(Date.UTC(1899,11,30)+Math.round(v)*864e5).toISOString().slice(0,10);
  if(v instanceof Date) return v.toISOString().slice(0,10);
  const s=String(v||'').trim(); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return s.slice(0,10);
  m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:'';
}
const toNum = v => { const n=typeof v==='number'?v:parseFloat(String(v||'').replace(',','.')); return Number.isFinite(n)?n:0; };
const txt = v => String(v??'').trim();
function leerSG(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const hi=rows.findIndex(r=>r.map(txt).includes('Número')&&r.map(txt).includes('EA'));
  if(hi<0) throw new Error('El archivo no tiene las columnas esperadas (Número, EA).');
  const H=rows[hi].map(txt), col=n=>H.indexOf(n);
  const need=['Número','Sexo','EA','Color','Nomb. Lote','Estado reprod.','Gest.','U.Peso','F. Ult Peso','I.E.','# Madre','Det. Ult. Tacto','E.Mes','#P','D.Ab','UIEP','gr/día 2 U. P.'];
  const falta=need.filter(n=>col(n)<0);
  if(falta.length) throw new Error('Faltan columnas: '+falta.join(', '));
  const g=(r,n)=>col(n)<0?'':r[col(n)], list=[], seen=new Set(), dups=[]; let total=null;
  for(const r of rows.slice(hi+1)){
    const id=txt(g(r,'Número')), t=id.match(/^Total animales:\s*(\d+)/i);
    if(t){ total=+t[1]; continue; }
    if(!id||!txt(g(r,'Sexo'))) continue;
    if(seen.has(id)){ dups.push(id); continue; } seen.add(id);
    const cr=txt(g(r,'Color')), azm=cr.match(/^\(AZ\)\s*([0-9A-Za-z]+)/i);
    const ie=txt(g(r,'I.E.'));
    list.push({id,nombre:txt(g(r,'Nombre')),sexo:txt(g(r,'Sexo')),emes:toNum(g(r,'E.Mes')),fnto:parseDate(g(r,'F. Nto')),ea:txt(g(r,'EA')),
      madre:txt(g(r,'# Madre')),color:azm?'':cr,colorRaw:cr,az:azm?azm[1]:'',coment:txt(g(r,'Coment')),lote:txt(g(r,'Nomb. Lote')),np:toNum(g(r,'#P')),
      ie:ie.replace(/\.0+$/,''),gest:toNum(g(r,'Gest.')),estado:txt(g(r,'Estado reprod.')),dab:toNum(g(r,'D.Ab')),uiep:toNum(g(r,'UIEP')),
      upeso:toNum(g(r,'U.Peso')),fupeso:parseDate(g(r,'F. Ult Peso')),gmd:toNum(g(r,'gr/día 2 U. P.')),ftacto:parseDate(g(r,'F. Ult. Tacto')),dtacto:txt(g(r,'Det. Ult. Tacto')),w:{}});
  }
  if(!list.length) throw new Error('No se encontraron animales en el archivo.');
  return {list,total,dups};
}
function leerRespaldo(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[BACKUP_SHEET],{header:1,raw:true,defval:''});
  if(rows[0][0]!=='APP_CORRAL'||rows[1][0]!=='META') throw new Error('El archivo de avance está dañado.');
  const m=JSON.parse(rows[1][1]), list=rows.slice(2).filter(r=>r[1]).map(r=>JSON.parse(r[1]));
  if(list.length!==rows[0][2]) throw new Error('El archivo de avance está incompleto.');
  return {m,list};
}
function lotesDe(list){ return [...new Set([...list.map(a=>a.lote).filter(Boolean),CFG.loteDestete,CFG.loteVenta,CFG.loteEntore])].sort((a,b)=>a.localeCompare(b,'es')); }
async function alSubir(file){
  let wb; try{ wb=XLSX.read(await file.arrayBuffer(),{type:'array'}); }catch(e){ return alertBox('No se pudo leer','El archivo no es un Excel válido.'); }
  try{
    if(wb.SheetNames.includes(BACKUP_SHEET)){
      const {m,list}=leerRespaldo(wb);
      const hechos=list.filter(a=>a.w.inv).length;
      return pasoReemplazo(`Archivo de avance de ${m.finca}: ${list.length} animales, ${hechos} inventariados.`,null,async()=>{
        await replaceAll({...m,cambios:0},list); F={inv:{},palp:{},peso:{},dest:{}}; tab='list'; render(); toast('Avance restaurado');
      });
    }
    const {list,total,dups}=leerSG(wb);
    const avisos=[]; if(total&&total!==list.length) avisos.push(`El archivo indica ${total} animales y se leyeron ${list.length}.`);
    if(dups.length) avisos.push(`Números repetidos ignorados: ${dups.slice(0,8).join(', ')}.`);
    return pasoReemplazo(`Excel con ${list.length} animales.`+(avisos.length?' '+avisos.join(' '):''),meta?.finca||'',async finca=>{
      await replaceAll({finca,baseDate:today(),fileName:file.name,lotes:lotesDe(list),cambios:0,lastExport:null},list);
      F={inv:{},palp:{},peso:{},dest:{}}; tab='inv'; render(); toast('Inventario cargado'); pedirPersistencia();
    });
  }catch(e){ return alertBox('Archivo no válido',e.message); }
}
function pasoReemplazo(desc,finca,run){
  const c=meta?.cambios||0, hay=!!meta;
  const m=modal(`<h2>Cargar archivo</h2><p>${esc(desc)}</p>
  ${finca!==null?`<div class="field"><label for="mF">Nombre de la finca</label><input id="mF" value="${esc(finca)}" autocomplete="off"></div>`:''}
  ${hay?`<div class="alert r">Esto borra el inventario actual de ${esc(meta.finca)}.${c?` Tiene ${c} cambios sin descargar.`:''}</div>`:''}
  ${hay?'<button class="big sec" id="mDl">Descargar avance actual primero</button>':''}
  <button class="big ${hay?'danger':''}" id="mGo">${hay?'Borrar y cargar':'Cargar'}</button><button class="big sec" id="mNo">Cancelar</button>`);
  if(hay) m.querySelector('#mDl').onclick=async e=>{ await descargar(); e.target.textContent='Avance descargado ✓'; };
  m.querySelector('#mNo').onclick=closeModal;
  m.querySelector('#mGo').onclick=async()=>{
    let f=null;
    if(finca!==null){ f=m.querySelector('#mF').value.trim(); if(!f){ m.querySelector('#mF').focus(); return; } }
    if(hay&&(meta.cambios||0)>0&&!await segundo()) return;
    closeModal(); await run(f);
  };
  function segundo(){ return new Promise(res=>{ const s=document.createElement('div'); s.className='alert r';
    s.innerHTML='Aún hay cambios sin descargar y se perderán.<br><br><button class="big danger">Perder cambios y cargar</button>';
    m.querySelector('.sheet').prepend(s); s.querySelector('button').onclick=()=>res(true); m.querySelector('.sheet').scrollTop=0; }); }
}

/* ---------- eventos ---------- */
document.addEventListener('click',async e=>{
  if(!e.target.closest('#toast')) $('#toast').classList.remove('show');
  const t=e.target.closest('button,[data-a],[data-mv]'); if(!t) return;
  const d=t.dataset;
  if(d.tab){ if(!meta&&d.tab!=='file') return; if(d.tab!==tab&&!await salir()) return; tab=d.tab; $('#main').scrollTop=0; return render(); }
  if(d.k!==undefined){
    const f=F[tab];
    if(d.k==='del') f.q=(f.q||'').slice(0,-1);
    else if(d.k==='abc'){ f.abc=!f.abc; renderMain(); if(f.abc){ const q=$('#q'); q.focus(); } return; }
    else if(d.k==='ok'){ const r=buscar(f.q||''); if(r.exact===1||r.items.length===1) pick(r.items[0].id); return; }
    else f.q=(f.q||'')+d.k;
    $('#q').value=f.q; return pintarResultados();
  }
  if(d.pick) return pick(d.pick);
  if(d.pinv){ const id=d.pinv; closeModal(); if(!await salir()) return; tab='inv'; F.inv={}; render(); return pick(id); }
  if(d.pseg){ pSeg=d.pseg; return abrirProg(); }
  if(d.lv){ L.vista=d.lv; $('#main').scrollTop=0; return renderMain(); }
  if(d.mv!==undefined) return verMov(+d.mv);
  if(d.open) return detalle(d.det);
  if(d.del) { return borrar(d.del,d.id); }
  if(d.go){ closeModal(); if(!await salir()) return; tab=d.go; F[tab]={}; render(); return pick(d.id); }
  const P=F.palp;
  if(d.modo){ if(P.modo!==d.modo){ P.modo=d.modo; if(d.modo!=='V') P.det=''; if(d.modo!=='P'){P.dias=null;P.manual='';} } return renderMain(); }
  if(d.dias){ P.dias=+d.dias; P.manual=''; return renderMain(); }
  if(d.det&&!d.open){ P.det=d.det; return renderMain(); }
  if(d.dec){ F.dest.dec=d.dec; return renderMain(); }
  if(d.dst){ F.dest.dst=d.dst; return renderMain(); }
  if(d.tl){ TL=d.tl; if($('#modal .tlwrap.open')) abrirTabla(); return renderMain(); }
  if(d.qmov){ F[tab].mov=F[tab].mov===d.qmov?'':d.qmov; return renderMain(); }
  if(d.cria){ cargarDest(d.cria); return renderMain(); }
  switch(d.a){
    case 'goFile': if(!await salir()) return; tab='file'; return render();
    case 'clear': if(!await salir()) return; F[tab]={}; return renderMain();
    case 'toInv': { const id=F[tab].id; F[tab]={}; tab='inv'; render(); return pick(id); }
    case 'toggleInv': F[tab].inv=!F[tab].inv; return renderMain();
    case 'toggleEntore': F.peso.entore=!F.peso.entore; return renderMain();
    case 'saveInv': return saveInv();
    case 'savePalp': return savePalp();
    case 'savePeso': return savePeso();
    case 'saveDest': return saveDest();
    case 'closeM': return closeModal();
    case 'prog': return abrirProg();
    case 'tlotes': return abrirTabla();
    case 'upload': return $('#file').click();
    case 'download': return descargar();
    case 'share': return enviar();
    case 'install': if(installEvt){ installEvt.prompt(); installEvt=null; renderMain(); } return;
  }
});
function otroLote(f,key){
  const n=(prompt('Nombre del lote nuevo')||'').trim().toUpperCase();
  if(n){ if(!meta.lotes.includes(n)){ meta.lotes.push(n); meta.lotes.sort((a,b)=>a.localeCompare(b,'es')); saveMeta(); } f[key]=n; } else if(key==='mov') f[key]='';
  renderMain();
}
document.addEventListener('input',e=>{
  const el=e.target, k=el.dataset.f;
  if(el.id==='q'){ F[tab].q=el.value.toUpperCase(); return pintarResultados(); }
  if(el.dataset.l==='q'){ L.q=el.value; $('#listBody').innerHTML=listBody(); return; }
  if(!k||!F[tab]) return;
  if(el.tagName==='SELECT') return;
  F[tab][k]=el.value;
  const live=$('#live');
  if(k==='valor'&&live){ live.innerHTML=livePeso(animals.get(F.peso.id),F.peso); if(F.peso.entore&&calcPeso(animals.get(F.peso.id),F.peso.valor).peso<=CFG.entoreMin) F.peso.entore=false; }
  if(k==='manual'&&live) live.innerHTML=alertasGest(animals.get(F.palp.id),F.palp);
  if(k==='peso'&&live) live.innerHTML=alertaDP(F.dest);
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.p){ P[el.dataset.p]=el.value; if(progOpen) abrirProg(); return renderMain(); }
  if(el.dataset.l&&el.dataset.l!=='q'){ L[el.dataset.l]=el.value; return renderMain(); }
  if(el.tagName==='SELECT'&&el.dataset.f){
    const k=el.dataset.f;
    if(el.value==='__otro') return otroLote(F[tab],k);
    F[tab][k]=el.value; renderMain();
  }
});
$('#file').addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; if(f) alSubir(f); });
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installEvt=e; if(tab==='file') renderMain(); });
window.addEventListener('beforeunload',e=>{ if(meta&&((meta.cambios||0)>0||sinGuardar())){ e.preventDefault(); e.returnValue=''; } });

(async function init(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  try{ db=await openDB(); await loadDB(); }
  catch(e){ await alertBox('Error de almacenamiento','Este navegador no permite guardar datos. Salga del modo privado o use otro navegador.'); }
  if(meta) await pedirPersistencia();
  render();
  if(meta&&meta.cambios>0) toastBackup(meta.cambios);
})();

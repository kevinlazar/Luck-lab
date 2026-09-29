(function(){
const DATA = JSON.parse(document.getElementById('site-data').textContent || '{"players":[],"coverage":{}}');
const P = DATA.players;
const byId = Object.fromEntries(P.map(p=>[p.id,p]));
const $ = s=>document.querySelector(s);
if(!window.claude){ const si=document.getElementById('start-intro'); if(si) si.textContent='Your best lineup for this week by projection, compared with what you have set in Sleeper.'; }
const esc = s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1 = v=>v==null?'–':(+v).toFixed(1);
const sgn = v=>(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(1);
const pct = (v,d=0)=>v==null?'–':(v*100).toFixed(d)+'%';
const cls = d=>d<=-1?'cold':d>=1?'hot':'';

let pos='WR';
try{ const h=(location.hash||'').slice(1).toUpperCase(); if(['QB','RB','WR','TE'].includes(h)) pos=h; else { const s=localStorage.getItem('ll-pos'); if(s) pos=s; } }catch(e){}
let sortKey='diff', sortDir=1, qOnly=true, query='';

// status
(function(){
  const c=DATA.coverage||{}; const el=$('#status');
  let wk = c.lastWeek ? `Through Week ${c.lastWeek}` : 'No games yet';
  let part = (c.lastWeek && c.gamesInLastWeek<c.totalInLastWeek) ? `${c.gamesInLastWeek} of ${c.totalInLastWeek} Week ${c.lastWeek} games played` : (c.lastWeek?`All Week ${c.lastWeek} games played`:'');
  let upd = DATA.updated ? new Date(DATA.updated.replace('Z',':00Z')) : null;
  let updS = upd && !isNaN(upd) ? 'Updated '+upd.toLocaleDateString(undefined,{month:'short',day:'numeric'})+', '+upd.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : '';
  const maxG = Math.max(0,...P.map(p=>p.g));
  el.innerHTML = `<b>${c.season||''} season · ${wk}</b><span>${esc(part)}</span><span>${esc(updS)}</span>` + (maxG && maxG<4 ? `<span class="early">Early season: ${maxG} game${maxG>1?'s':''} of data</span>`:'');
})();

function usageLine(p){
  const bits=[];
  if(p.pos==='QB'){ bits.push(`${Math.round(p.att/p.g)} att/g`); if(p.car) bits.push(`${(p.car/p.g).toFixed(1)} car/g`); if(p.rz) bits.push(`${p.rz} RZ touches`); }
  else if(p.pos==='RB'){ bits.push(`${(p.car/p.g).toFixed(1)} car/g`, `${(p.tgt/p.g).toFixed(1)} tgt/g`); if(p.gl) bits.push(`${p.gl} GL carries`); else if(p.rz) bits.push(`${p.rz} RZ touches`); }
  else { bits.push(`${pct(p.ts)} tgt share`, `${(p.tgt/p.g).toFixed(1)} tgt/g`); if(p.rz) bits.push(`${p.rz} RZ touches`); }
  return bits.join(' · ');
}
function card(p,kind){
  return `<button class="card ${kind}" data-id="${p.id}"><span class="nm">${esc(p.name)}</span><span class="big">${sgn(p.diff)}</span><span class="tm">${esc(p.team)} · ${f1(p.ppr)} actual vs ${f1(p.xfp)} exp</span><span class="ln">${esc(usageLine(p))}</span></button>`;
}
function renderMoves(){
  const q=P.filter(p=>p.pos===pos && p.q);
  let buy=q.filter(p=>p.diff<=-2).sort((a,b)=>b.xfp-a.xfp).slice(0,4);
  if(buy.length<4) buy=buy.concat(q.filter(p=>p.diff<0 && !buy.includes(p)).sort((a,b)=>a.diff-b.diff).slice(0,4-buy.length));
  let sell=q.filter(p=>p.diff>=2).sort((a,b)=>b.diff-a.diff).slice(0,4);
  $('#buy').innerHTML = buy.length?buy.map(p=>card(p,'cold')).join(''):'<div class="empty">No clear buy-low players yet.</div>';
  $('#sell').innerHTML = sell.length?sell.map(p=>card(p,'hot')).join(''):'<div class="empty">No clear sell-high players yet.</div>';
}

// scatter
function renderScatter(){
  const svg=$('#scatter'); const W=Math.max(320,$('#chart-box').clientWidth-32); const H=Math.round(Math.min(460,Math.max(300,W*0.55)));
  const m={l:44,r:16,t:14,b:40};
  const pts=P.filter(p=>p.pos===pos && (qOnly?p.q:p.g>0));
  const mx=Math.max(5,...pts.map(p=>Math.max(p.xfp,p.ppr)));
  const top=Math.ceil(mx/5)*5; const lo=Math.min(0,...pts.map(p=>p.ppr)); const bot=lo<0?Math.floor(lo/5)*5:0;
  const x=v=>m.l+(v)/(top)*(W-m.l-m.r), y=v=>H-m.b-(v-bot)/(top-bot)*(H-m.t-m.b);
  const step=top<=20?5:top<=40?10:10;
  let g='';
  for(let v=0;v<=top;v+=step){ g+=`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H-m.b}"/><text x="${x(v)}" y="${H-m.b+16}" text-anchor="middle">${v}</text>`; }
  for(let v=bot;v<=top;v+=step){ g+=`<line class="grid" x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`; }
  g+=`<polygon class="band-l" points="${x(0)},${y(0)} ${x(0)},${y(top)} ${x(top)},${y(top)}"/>`;
  g+=`<polygon class="band-u" points="${x(0)},${y(Math.max(bot,0))} ${x(top)},${y(top)} ${x(top)},${y(bot)} ${x(0)},${y(bot)}"/>`;
  g+=`<line class="par" x1="${x(0)}" y1="${y(0)}" x2="${x(top)}" y2="${y(top)}"/>`;
  g+=`<text class="zone" x="${m.l+10}" y="${m.t+18}" style="fill:var(--hot)">Lucky</text><text class="zone" x="${W-m.r-10}" y="${H-m.b-10}" text-anchor="end" style="fill:var(--cold)">Unlucky</text>`;
  g+=`<text class="axis-t" x="${(m.l+W-m.r)/2}" y="${H-6}" text-anchor="middle">Expected PPR / game</text>`;
  g+=`<text class="axis-t" transform="translate(12 ${(m.t+H-m.b)/2}) rotate(-90)" text-anchor="middle">Actual PPR / game</text>`;
  const col=d=>d<=-1?'var(--cold)':d>=1?'var(--hot)':'var(--neutral-dot)';
  const sorted=[...pts].sort((a,b)=>Math.abs(a.diff)-Math.abs(b.diff));
  sorted.forEach(p=>{ g+=`<circle data-id="${p.id}" cx="${x(p.xfp).toFixed(1)}" cy="${y(p.ppr).toFixed(1)}" r="${W<500?4.5:5.5}" fill="${col(p.diff)}" fill-opacity=".85"/>`; });
  const lab=[...pts].sort((a,b)=>a.diff-b.diff); const pick=[...lab.slice(0,3),...lab.slice(-3).filter(p=>p.diff>0)];
  const placed=[];
  pick.forEach(p=>{ const px=x(p.xfp), py=y(p.ppr); const right=px<W*0.7;
    if(placed.some(q=>Math.abs(q[0]-px)<(W<500?70:110)&&Math.abs(q[1]-py)<14)) return; placed.push([px,py]); const last=p.name.split(' ').slice(-1)[0].replace(/^(Jr\.|Sr\.|II|III|IV)$/,'')||p.name; g+=`<text class="lbl" x="${px+(right?8:-8)}" y="${py+4}" text-anchor="${right?'start':'end'}">${esc(p.name.length>16?last:p.name)}</text>`; });
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML=g;
}
const tip=$('#tip');
$('#scatter').addEventListener('mousemove',e=>{
  const c=e.target.closest('circle'); if(!c){tip.hidden=true;return;}
  const p=byId[c.dataset.id]; const box=$('#chart-box').getBoundingClientRect();
  tip.innerHTML=`<b>${esc(p.name)}</b> · ${esc(p.team)}<br>${f1(p.ppr)} actual · ${f1(p.xfp)} expected<br>Diff ${sgn(p.diff)} per game`;
  tip.hidden=false; let lx=e.clientX-box.left+14, ly=e.clientY-box.top-10;
  if(lx+tip.offsetWidth>box.width-8) lx=e.clientX-box.left-tip.offsetWidth-14;
  tip.style.left=lx+'px'; tip.style.top=ly+'px';
});
$('#scatter').addEventListener('mouseleave',()=>tip.hidden=true);
$('#scatter').addEventListener('click',e=>{const c=e.target.closest('circle'); if(c) openPlayer(c.dataset.id);});

// table
function cols(){
  const c=[{k:'name',h:'Player'},{k:'g',h:'G'},{k:'ppr',h:'PPR/G'},{k:'xfp',h:'xFP/G'},{k:'diff',h:'Diff/G'},{k:'snap',h:'Snap %'}];
  if(pos==='QB') c.push({k:'att',h:'Pass Att'});
  c.push({k:'car',h:'Carries'},{k:'tgt',h:'Targets'},{k:'ts',h:'Tgt Share'},{k:'rz',h:'RZ Touch'},{k:'gl',h:'GL Car'});
  return c;
}
function renderTable(){
  const C=cols();
  $('#board thead').innerHTML='<tr>'+C.map(c=>`<th data-k="${c.k}" ${c.k===sortKey?`aria-sort="${sortDir>0?'ascending':'descending'}"`:''} tabindex="0" scope="col">${c.h}</th>`).join('')+'</tr>';
  let rows=P.filter(p=>p.pos===pos && (!qOnly||p.q));
  if(query){ const q=query.toLowerCase(); rows=rows.filter(p=>p.name.toLowerCase().includes(q)||p.team.toLowerCase()===q); }
  rows.sort((a,b)=>{ const A=a[sortKey],B=b[sortKey]; if(typeof A==='string') return sortDir*A.localeCompare(B); return sortDir*((A??-1)-(B??-1)); });
  const maxAbs=Math.max(3,...rows.map(p=>Math.abs(p.diff)));
  $('#board tbody').innerHTML=rows.map(p=>{
    const w=Math.min(50,Math.abs(p.diff)/maxAbs*50); const c=p.diff<0?'var(--cold)':'var(--hot)';
    const bar=`<span class="dbar"><i style="${p.diff<0?`right:50%`:`left:50%`};width:${w}%;background:${c}"></i></span>`;
    const cells={name:`<span class="pn">${esc(p.name)}</span><span class="pt">${esc(p.team)}</span>`, g:p.g, ppr:f1(p.ppr), xfp:f1(p.xfp),
      diff:`<span class="dcell">${bar}<span class="dval ${p.diff<=-1?'cold-t':p.diff>=1?'hot-t':''}">${sgn(p.diff)}</span></span>`,
      snap:pct(p.snap), att:p.att, car:p.car, tgt:p.tgt, ts:pct(p.ts,1), rz:p.rz, gl:p.gl};
    return `<tr data-id="${p.id}">`+C.map(c=>`<td class="${(c.k!=='name'&&c.k!=='diff'&&(cells[c.k]===0||cells[c.k]==='0.0%'))?'dim':''}">${cells[c.k]}</td>`).join('')+'</tr>';
  }).join('') || `<tr><td colspan="${C.length}" style="text-align:left;color:var(--ink-3)">No players match that search.</td></tr>`;
  $('#count').textContent=`${rows.length} player${rows.length===1?'':'s'}`;
}
$('#board thead').addEventListener('click',e=>{const th=e.target.closest('th'); if(!th) return; const k=th.dataset.k; if(k===sortKey) sortDir*=-1; else {sortKey=k; sortDir=(k==='name'||k==='diff')?1:-1;} renderTable();});
$('#board thead').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault(); e.target.click();}});
$('#board tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-id]'); if(tr) openPlayer(tr.dataset.id);});
$('#search').addEventListener('input',e=>{query=e.target.value.trim(); renderTable();});
$('#qonly').addEventListener('change',e=>{qOnly=e.target.checked; renderTable(); renderScatter();});
document.querySelector('.moves').addEventListener('click',e=>{const b=e.target.closest('.card'); if(b) openPlayer(b.dataset.id);});

// drawer
let lastFocus=null;
function openPlayer(id){
  const p=byId[id]; if(!p) return; lastFocus=document.activeElement;
  const k=cls(p.diff);
  const verdict = p.diff<=-2 ? `Scoring ${Math.abs(p.diff).toFixed(1)} points per game less than his usage usually produces. If the role holds, his points should rise.`
    : p.diff>=2 ? `Scoring ${p.diff.toFixed(1)} points per game more than his usage usually produces. Some of that is likely to fade.`
    : `Scoring about what his usage predicts. What you see is roughly what his role is worth.`;
  const u=[['Snap %',pct(p.snap)],...(p.pos==='QB'?[['Pass att/g',(p.att/p.g).toFixed(1)]]:[]),['Carries/g',(p.car/p.g).toFixed(1)],['Targets/g',(p.tgt/p.g).toFixed(1)],['Target share',pct(p.ts,1)],['RZ touches',p.rz],['GL carries',p.gl]];
  const wkRows=p.wk.map(w=>`<tr><td>Wk ${w.w}</td><td style="text-align:left">${esc(w.opp||'')}</td><td>${f1(w.ppr)}</td><td>${f1(w.xfp)}</td><td class="${w.ppr-w.xfp<=-1?'cold-t':w.ppr-w.xfp>=1?'hot-t':''}">${sgn(w.ppr-w.xfp)}</td><td>${pct(w.snap)}</td>${p.pos==='QB'?`<td>${w.att}</td>`:''}<td>${w.car}</td><td>${w.tgt}</td><td>${w.rec}</td><td>${w.yds}</td><td>${w.td}</td><td>${w.rz}</td></tr>`).join('');
  $('#drawer').innerHTML=`
    <div class="d-top"><div><h2 id="d-name">${esc(p.name)}</h2><div class="sub">${esc(p.pos)} · ${esc(p.team)} · ${p.g} game${p.g>1?'s':''}${p.q?'':' · limited role'}${injText(p)?` · <span class="tag">${esc(injText(p))}</span>`:''}</div><div class="sub">${esc(matchupText(p))}</div></div><button class="close" id="close">Close</button></div>
    ${curLg?`<div class="sub" style="margin-top:-12px">${team.roster.includes(p.id)?'On your team':owner(p.id)?`Rostered by ${esc(owner(p.id).name)}`:'Free agent'} in ${esc(lg().name)}</div>`:''}
    <button class="btn add" id="d-add">${team.roster.includes(p.id)?'On your team':curLg?(trade.get.includes(p.id)?'In your trade':'Add to a trade'):'Add to my team'}</button>
    <div class="kpis"><div class="kpi"><div class="k">Actual / g</div><div class="v">${f1(p.ppr)}</div></div><div class="kpi"><div class="k">Expected / g</div><div class="v">${f1(p.xfp)}</div></div><div class="kpi"><div class="k">Diff / g</div><div class="v ${k==='cold'?'cold-t':k==='hot'?'hot-t':''}">${sgn(p.diff)}</div></div></div>
    <div class="verdict ${k}">${verdict}</div>
    ${matchupHtml(p)}
    <div class="d-sec"><h3>Week by week</h3><svg id="wkchart" role="img" aria-label="Actual and expected points by week"></svg>
      <div class="legend"><span><i style="background:var(--ink);border-radius:2px"></i>Actual</span><span><i style="background:transparent;border:2px solid var(--accent);border-radius:2px"></i>Expected</span></div></div>
    <div class="d-sec"><h3>Usage</h3><div class="usage">${u.map(([a,b])=>`<div class="kpi"><div class="k">${a}</div><div class="v" style="font-size:22px">${b}</div></div>`).join('')}</div></div>
    <div class="d-sec"><h3>Game log</h3><div class="wk-tbl"><table><thead><tr><th>Week</th><th style="text-align:left">Opp</th><th>PPR</th><th>xFP</th><th>Diff</th><th>Snap</th>${p.pos==='QB'?'<th>Att</th>':''}<th>Car</th><th>Tgt</th><th>Rec</th><th>Yds</th><th>TD</th><th>RZ</th></tr></thead><tbody>${wkRows}</tbody></table></div></div>`;
  $('#scrim').hidden=false; document.body.style.overflow='hidden';
  drawWeeks(p); $('#close').addEventListener('click',closePlayer); $('#close').focus();
  const addB=$('#d-add'); if(team.roster.includes(p.id)||(curLg&&trade.get.includes(p.id))) addB.disabled=true;
  addB.addEventListener('click',()=>{
    if(curLg){ if(!trade.get.includes(p.id)) trade.get.push(p.id); renderTradeMeter(); setMode('trade'); setView('team'); closePlayer(); return; }
    addToRoster(p.id); addB.textContent='Added to your team'; addB.disabled=true; });
}
function drawWeeks(p){
  const svg=$('#wkchart'); const W=Math.max(280,svg.clientWidth||500), H=180, m={l:34,r:10,t:12,b:26};
  const n=p.wk.length; const mx=Math.max(5,...p.wk.map(w=>Math.max(w.ppr,w.xfp))); const top=Math.ceil(mx/10)*10; const lo=Math.min(0,...p.wk.map(w=>w.ppr)); const bot=lo<0?-5:0;
  const y=v=>H-m.b-(v-bot)/(top-bot)*(H-m.t-m.b); const bw=(W-m.l-m.r)/Math.max(n,1);
  let g=''; const st=top<=20?5:10;
  for(let v=bot;v<=top;v+=st) g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${m.l-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`;
  p.wk.forEach((w,i)=>{ const cx=m.l+bw*i+bw/2, b=Math.min(34,bw*0.34);
    g+=`<rect x="${cx-b-2}" y="${Math.min(y(w.ppr),y(0))}" width="${b}" height="${Math.abs(y(w.ppr)-y(0))}" rx="3" fill="var(--ink)"/>`;
    g+=`<rect x="${cx+2}" y="${y(w.xfp)}" width="${b}" height="${y(0)-y(w.xfp)}" rx="3" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    g+=`<text x="${cx}" y="${H-8}" text-anchor="middle">Wk ${w.w}</text>`; });
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML=g;
}
function closePlayer(){ $('#scrim').hidden=true; document.body.style.overflow=''; if(lastFocus) lastFocus.focus(); }
$('#scrim').addEventListener('click',e=>{ if(e.target.id==='scrim') closePlayer(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('#scrim').hidden) closePlayer(); });

// tabs
function setPos(p){ pos=p; document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.pos===p?'true':'false'));
  try{localStorage.setItem('ll-pos',p);}catch(e){}
  if(sortKey==='att' && p!=='QB') sortKey='diff';
  renderMoves(); renderScatter(); renderTable(); }
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(b) setPos(b.dataset.pos);});
let rt; window.addEventListener('resize',()=>{clearTimeout(rt); rt=setTimeout(renderScatter,120);});

/* ================= My team & advisor ================= */
const TEAMS = DATA.teams||{};
const COV = DATA.coverage||{};
const DEFAULT_LG = {teams:12,QB:1,RB:2,WR:2,TE:1,FLEX:1,SF:false};
const custom = {roster:[], league:{...DEFAULT_LG}};
let team = custom;
let store = {kind:'none', ref:null};

// ---- Sleeper leagues ----
const SL = (()=>{ try{ return JSON.parse(document.getElementById('sleeper-data').textContent); }catch(e){ return null; } })();
const SLP = (SL&&SL.players)||{};
const LEAGUES = (SL&&SL.leagues)||[];
const sid2slp = {}; Object.entries(SLP).forEach(([k,v])=>{ if(v.sid) sid2slp[v.sid]=k; });
let curLg=null, viewRid=null, booted=false, pendingLg;
function lg(){ return curLg ? LEAGUES.find(l=>l.id===curLg)||null : null; }
function myTeam(L){ L=L||lg(); return L ? L.teams.find(t=>t.me)||L.teams[0] : null; }
function rec(t){ return `${t.w}-${t.l}${t.t?'-'+t.t:''}`; }
let _own=null, _ownLg=null;
function owner(id){ const L=lg(); if(!L) return undefined;
  if(_ownLg!==L.id){ _own={}; L.teams.forEach(t=>t.players.forEach(pid=>{ const s=SLP[pid]; if(s&&s.sid) _own[s.sid]=t; })); _ownLg=L.id; }
  return _own[id]||null; }
function ownerTag(id){ const o=owner(id); if(o===undefined) return ''; return o ? (o.me?'your team':o.name) : 'free agent'; }
function slotName(k){ return k==='SUPER_FLEX'?'SF':k; }
function lineupText(L){ const s=L.slots; return ['QB','RB','WR','TE','FLEX','SUPER_FLEX','K','DEF'].filter(k=>s[k]).map(k=>`${s[k]} ${slotName(k)}`).join(', '); }
function selectLeague(id, quiet){
  const L = id ? LEAGUES.find(l=>l.id===id) : null;
  curLg = L ? L.id : null;
  if(L){ const me=myTeam(L);
    team={roster:me.players.map(p=>SLP[p]&&SLP[p].sid).filter(id=>id&&byId[id]), league:{teams:L.size,QB:L.slots.QB||0,RB:L.slots.RB||0,WR:L.slots.WR||0,TE:L.slots.TE||0,FLEX:L.slots.FLEX||0,SF:(L.slots.SUPER_FLEX||0)>0}};
    viewRid=me.rid;
  } else { team=custom; viewRid=null; }
  trade.give=[]; trade.get=[]; dealIds=[]; dealId=null; $('#deal-out').innerHTML=''; $('#deal-pills').innerHTML='';
  try{ localStorage.setItem('ll-league', curLg||''); }catch(e){}
  if(!quiet) persist();
  refreshAll();
}
function refreshAll(){
  $('#add-picker').hidden=!!curLg; $('#league').hidden=!!curLg; $('#fa-box').hidden=!curLg;
  syncLeagueInputs(); renderLeagueBar(); renderRoster(); refreshGiveSel(); renderTradeMeter(); renderDeal(); renderFA(); renderSugg(); renderPartners();
}
function renderLeagueBar(){
  if(!LEAGUES.length){ document.querySelector('.lgbar').hidden=true; return; }
  const d=new Date(SL.pulled+'T12:00:00');
  $('#lg-src').textContent=`Live from Sleeper for ${SL.user}.`;
  const btn=L=>{ const me=myTeam(L); return `<button class="lg-btn" data-lg="${L.id}" aria-pressed="${curLg===L.id}"><b>${esc(L.name)}</b><small>${L.size} teams · you're ${rec(me)}</small></button>`; };
  const red=LEAGUES.filter(l=>l.type==='redraft'), dyn=LEAGUES.filter(l=>l.type==='dynasty');
  $('#lg-groups').innerHTML=(red.length?`<div class="lg-group"><span>Redraft</span><div class="lg-btns">${red.map(btn).join('')}</div></div>`:'')
    +(dyn.length?`<div class="lg-group"><span>Dynasty</span><div class="lg-btns">${dyn.map(btn).join('')}</div></div>`:'')
    +`<div class="lg-group"><span>Other</span><div class="lg-btns"><button class="lg-btn" data-lg="" aria-pressed="${!curLg}"><b>Custom team</b><small>Build any roster by hand</small></button></div></div>`;
  const L=lg(), info=$('#lg-info');
  if(!L){ info.innerHTML=`<div class="spec"><b>Custom team</b><span>Add players by hand and set your lineup slots in the team panel.</span></div>`; return; }
  const sc=L.scoring;
  const scoring=[`${sc.rec} per catch`,`${sc.pass_td} per pass TD`,`${sc.pass_int} per INT`].concat(sc.te_bonus?[`+${sc.te_bonus} per TE catch`]:[]).join(' · ');
  const extras=[`${L.slots.BN} bench`,L.ir?`${L.ir} IR`:'',L.taxi?`${L.taxi} taxi`:'',L.faab?`$${L.faab} FAAB`:'',L.playoffTeams?`${L.playoffTeams} teams make the playoffs, starting Week ${L.playoffStart}`:''].filter(Boolean).join(' · ');
  const sorted=[...L.teams].sort((a,b)=>b.w-a.w||b.pf-a.pf);
  info.innerHTML=`<div class="spec"><b>${esc(L.name)}<span class="lg-type ${L.type==='dynasty'?'dyn':''}">${L.type}</span></b><span>${L.size} teams · Lineup: ${lineupText(L)}</span><span>Scoring: ${scoring}</span><span>${extras}</span></div>
    <label class="teamsel" for="team-sel">View team<select id="team-sel">${sorted.map((t,i)=>`<option value="${t.rid}" ${t.rid===viewRid?'selected':''}>${i+1}. ${esc(t.name)}${t.me?' (you)':''} · ${rec(t)} · ${t.pf.toFixed(1)} pts</option>`).join('')}</select></label>`;
}
$('#lg-groups').addEventListener('click',e=>{ const b=e.target.closest('.lg-btn'); if(b) selectLeague(b.dataset.lg||null); });
$('#lg-info').addEventListener('change',e=>{ if(e.target.id==='team-sel'){ viewRid=+e.target.value; renderRoster(); } });
// ---- projections & matchups ----
const MX=(()=>{ try{ return JSON.parse(document.getElementById('matchup-data').textContent); }catch(e){ return null; } })();
const MXP=(MX&&MX.proj)||{}, MXT=(MX&&MX.teams)||{}, MXW=(MX&&MX.nextWeek)||COV.nextWeek;
const SKILL=['QB','RB','WR','TE'];
function lvals(sleeperId){ const L=lg(); return L&&L.vals?L.vals[sleeperId]||null:null; }
function lvSite(siteId){ const s=sid2slp[siteId]; return s?lvals(s):null; }
function combM(pos,rm,cm){ return pos==='RB'?0.6*rm+0.4*cm:pos==='QB'?0.25*rm+0.75*cm:cm; }
function gradeOf(m){ return m>=1.05?'A':m>=1.017?'B':m>=0.983?'C':m>=0.95?'D':'F'; }
function gradeChip(g){ return `<span class="grade g-${g}" title="Matchup grade, A = easiest">${g}</span>`; }
function nextGame(mid){ const p=MXP[mid]; if(!p||!p.weeks||!p.weeks.length) return null; const w=p.weeks[0]; return {w:w[0],opp:w[1],home:!!w[2],m:combM(p.pos,w[3],w[4]),why:p.why||[]}; }
function cap(x){ return x.charAt(0).toUpperCase()+x.slice(1); }
function ord(n){ return n==null?'–':ordinal(n); }
function xv(pid){ const v=lvals(pid); if(v&&v[1]!=null) return v[1]; const s=SLP[pid]; const p=s&&s.sid&&byId[s.sid]; return p?p.xfp:-1; }
function isLocked(pid){ const s=SLP[pid]; if(!s) return false; const v=lvals(pid); if(!v||v[0]!=null) return false; const t=TEAMS[s.tm]; return !!(t&&!t.bye&&t.next&&t.next.w>MXW); }
function slpRow(pid,slot){
  const s=SLP[pid]; if(!s) return '';
  const sl=`<span class="slot">${slot?esc(slotName(slot)):''}</span>`;
  const p=s.sid&&byId[s.sid]; const mid=s.mid||(p&&p.id); const v=lvals(pid); const ng=mid?nextGame(mid):null;
  const it=s.inj||(p?injText(p):'');
  const locked=isLocked(pid);
  const pc=v?`<span class="proj">${v[0]==null?'–':f1(v[0])}<small>${v[0]==null?(locked?'played':'no game'):'proj'}</small></span>`:'';
  const mline=ng?`<span style="display:inline-flex;gap:6px;align-items:center">${gradeChip(gradeOf(ng.m))}Wk ${ng.w} ${ng.home?'vs':'at'} ${esc(ng.opp)}</span>`:'';
  const nm=p?`<span class="nm" data-open="${p.id}">`:`<span class="nm">`;
  const chip=p?`<span class="chip ${cls(p.diff)}" title="Actual minus expected points per game">${sgn(p.diff)}</span>`:`<span class="chip">–</span>`;
  const stat=p?`${f1(p.ppr)} actual · ${f1(p.xfp)} exp`:(s.pos==='K'||s.pos==='DEF'?'Kickers and defenses aren\'t projected here':(v?'No games yet this season':'No games in the data yet'));
  const ros=v&&v[1]!=null?` · ROS ${Math.round(v[1])}`:'';
  return `<div class="rp flat${pc?' pj':''}${p?'':' nostat'}"${p?` data-id="${p.id}"`:''}>${sl}${nm}${esc(p?p.name:s.n)} <span class="pt muted">${esc(s.tm||(p&&p.team)||'FA')}</span>${it?`<span class="tag">${esc(it)}</span>`:''}</span>${pc}${chip}<span class="sub" style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center">${mline}<span>${stat}${ros}</span></span></div>`;
}
// best lineup by next-week projection, compared with the Sleeper lineup
function suggestLineup(){
  const L=lg(); if(!L) return null;
  const me=myTeam(L); const elig={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],FLEX:['RB','WR','TE'],SUPER_FLEX:SKILL};
  const pool=me.players.filter(pid=>!me.ir.includes(pid)&&!me.taxi.includes(pid)&&SLP[pid]&&SKILL.includes(SLP[pid].pos))
    .map(pid=>({pid,pos:SLP[pid].pos,v:isLocked(pid)&&me.starters.includes(pid)?999:(lvals(pid)||[])[0]})).filter(x=>x.v!=null);
  const used=new Set(), out={};
  const idx=L.lineup.map((s,i)=>[s,i]).filter(([s])=>elig[s]);
  const order=[...idx.filter(([s])=>SKILL.includes(s)),...idx.filter(([s])=>s==='FLEX'),...idx.filter(([s])=>s==='SUPER_FLEX')];
  for(const [s,i] of order){ const c=pool.filter(x=>!used.has(x.pid)&&elig[s].includes(x.pos)).sort((a,b)=>b.v-a.v)[0]; if(c){ used.add(c.pid); out[i]=c; } }
  const cur=idx.map(([s,i])=>me.starters[i]).filter(x=>x&&x!=='0');
  const pv=pid=>{ const v=lvals(pid); return v&&v[0]!=null?v[0]:0; };
  const ins=[...used].filter(x=>!cur.includes(x)).sort((a,b)=>pv(b)-pv(a)), outs=cur.filter(x=>!used.has(x)).sort((a,b)=>pv(b)-pv(a));
  const swaps=ins.map((x,i)=>({in:x,out:outs[i],gain:pv(x)-(outs[i]?pv(outs[i]):0)}));
  return {L,idx,out,swaps};
}
function renderSugg(){
  const box=$('#lineup-sugg'); const S=suggestLineup(); if(!S){ box.innerHTML=''; return; }
  const {L,idx,out,swaps}=S;
  let h=`<div class="sugg"><b>Best Week ${MXW} lineup by projection</b>`;
  h+=idx.map(([s,i])=>{ const c=out[i]; const n=c?SLP[c.pid].n:'(empty)'; const v=c?(c.v===999?'played':f1(c.v)):''; return `<div class="ln"><span class="slot">${esc(slotName(s))}</span><span>${esc(n)}</span><span class="num">${v}</span></div>`; }).join('');
  h+= swaps.length ? swaps.map(w=>`<div class="swap">Start ${esc(SLP[w.in].n)}${w.out?` over ${esc(SLP[w.out].n)} (+${w.gain.toFixed(1)})`:''}</div>`).join('') : `<div class="muted">Your Sleeper lineup already matches the projections.</div>`;
  box.innerHTML=h+'</div>';
}
function suggText(){ const S=suggestLineup(); if(!S) return ''; const {idx,out,swaps}=S;
  return `SUGGESTED LINEUP BY PROJECTION (site model): `+idx.map(([s,i])=>{ const c=out[i]; return `${slotName(s)} ${c?SLP[c.pid].n+(c.v===999?' (already played)':' '+f1(c.v)):'(empty)'}`; }).join('; ')+(swaps.length?`. Suggested swaps vs my Sleeper lineup: `+swaps.map(w=>`start ${SLP[w.in].n}${w.out?' over '+SLP[w.out].n:''}`).join('; '):'. Matches my Sleeper lineup.')+'\n'; }
// ---- matchup detail for the player drawer ----
function matchupHtml(p){
  const m=MXP[p.id]; if(!m) return '';
  const ng=nextGame(p.id); const L=lg(); const v=lvSite(p.id); const st=m.style||{};
  const tm=(MXT[m.team]||{}).off||{};
  let h=`<div class="d-sec"><h3>Matchup</h3>`;
  if(ng){
    const od=MXT[ng.opp]||{}, dr=od.drank||{}, dd=od.def||{};
    h+=`<div class="row" style="margin-bottom:8px">${gradeChip(gradeOf(ng.m))}<span>Week ${ng.w} ${ng.home?'vs':'at'} ${esc(ng.opp)}${v&&v[0]!=null?` · projected <b>${f1(v[0])}</b> in ${esc(L.name)}`:''}</span></div>`;
    h+= ng.why.length?`<ul class="whys">${ng.why.map(x=>`<li>${esc(cap(x))}</li>`).join('')}</ul>`:`<p class="muted" style="margin:0">No single factor stands out. It grades close to an average matchup.</p>`;
    const f=[];
    if(p.pos==='RB'||p.pos==='QB'){ if(st.in_share!=null) f.push(['His inside runs',pct(st.in_share)]); if(st.rush_epa!=null) f.push(['His EPA per carry',st.rush_epa.toFixed(2)]); }
    if(p.pos==='WR'||p.pos==='TE'||(p.pos==='RB'&&st.tgt_n)){ if(st.adot!=null) f.push(['Avg depth of target',st.adot.toFixed(1)+' yds']); if(st.deep_share!=null) f.push(['Deep targets (15+)',pct(st.deep_share)]); if(st.zone_epa!=null&&st.man_epa!=null) f.push(['EPA/target vs zone · man',`${st.zone_epa.toFixed(2)} · ${st.man_epa.toFixed(2)}`]); }
    if(tm.pass_rate!=null) f.push([`${esc(m.team)} neutral pass rate`,pct(tm.pass_rate)]);
    if(tm.in_share!=null&&p.pos==='RB') f.push([`${esc(m.team)} inside runs`,pct(tm.in_share)]);
    f.push([`${esc(ng.opp)} run D`,`${ord(dr.run)} of 32`]);
    if(p.pos==='RB'||p.pos==='QB'){ f.push([`${esc(ng.opp)} vs inside runs`,`${ord(dr.inside)}`],[`${esc(ng.opp)} vs outside runs`,`${ord(dr.outside)}`]); }
    f.push([`${esc(ng.opp)} pass D`,`${ord(dr.pass)} of 32`]);
    if(p.pos!=='RB') f.push([`${esc(ng.opp)} deep pass D`,`${ord(dr.deep)}`]);
    if(dd.zone!=null&&p.pos!=='RB') f.push([`${esc(ng.opp)} zone rate (2025)`,pct(dd.zone)]);
    h+=`<div class="facts" style="margin-top:10px">${f.map(([a,b])=>`<div class="kpi"><div class="k">${a}</div><div class="v">${b}</div></div>`).join('')}</div>`;
    h+=`<p class="note" style="margin:6px 0 0">Defense ranks: 1st = toughest, 32nd = softest, by EPA allowed this season blended with last season.</p>`;
  }
  if(m.weeks&&m.weeks.length){
    const po=L?L.playoffStart:15;
    h+=`<h3 style="margin-top:14px">Rest of season</h3><div class="strip">${m.weeks.map(w=>{ const g=gradeOf(combM(m.pos,w[3],w[4])); const isPo=w[0]>=po&&w[0]<=po+2; return `<div class="g-${g}${isPo?' po':''}" title="${isPo?'Playoff week':''}">Wk ${w[0]}<b>${g}</b>${w[2]?'':'@'}${esc(w[1])}</div>`; }).join('')}</div>`;
    h+=`<p class="note" style="margin:6px 0 0">Blue border = your playoff weeks, weighted 1.5x in trade values.${v?` Rest of season: ${Math.round(v[1])} pts projected · trade value ${Math.round(v[2])} · how others see him ${Math.round(v[3])}${mktLabel(sid2slp[p.id])?' · '+mktLabel(sid2slp[p.id]):''}.`:''}</p>`;
  }
  return h+'</div>';
}
// ---- trade partners ----
function pickLabel(k,L){ const [,season,round,orig]=k.split(':'); const t=L.teams.find(x=>x.rid===+orig); const rn=['','1st','2nd','3rd','4th','5th'][+round]||round+'th'; return `${season} ${rn}${t&&!t.me?` (from ${t.name})`:''}`; }
function pName(sid,L){ return sid.startsWith('pick:')?pickLabel(sid,L):(SLP[sid]?SLP[sid].n:sid); }
function needLab(z){ return z<=-0.75?['lo','Need']:z>=0.75?['hi','Strong']:['','OK']; }
function offerWhy(o,L,t){
  const me=myTeam(L); const gp=o.give.filter(x=>!x.startsWith('pick:')).map(x=>SLP[x]&&SLP[x].pos), rp=o.get.map(x=>SLP[x]&&SLP[x].pos);
  const bits=[];
  gp.forEach(ps=>{ if(ps&&t.needs[ps]<=-0.5) bits.push(`they're thin at ${ps}`); });
  rp.forEach(ps=>{ if(ps&&me.needs[ps]<=-0.5) bits.push(`you need a ${ps}`); else if(ps&&t.needs[ps]>=0.5) bits.push(`they're deep at ${ps}`); });
  const g=o.get.map(x=>{ const s=SLP[x]; const p=s&&s.sid&&byId[s.sid]; return p&&p.diff<=-2?`${s.n} is scoring ${Math.abs(p.diff).toFixed(1)} under his usage`:null; }).filter(Boolean);
  if(t.prof&&t.prof.tags.includes('Active trader')) bits.push('they trade often');
  const all=[...new Set(bits)].concat(g);
  return all.length?cap(all.join(', '))+'.':'Their manager gets more of what shows up in the box score; you get more of what the usage and schedule say is coming.';
}
function renderPartners(){
  const sec=$('#partners'); const L=lg(); if(!L||!L.offers){ sec.hidden=true; return; } sec.hidden=false;
  const sorted=[...L.teams].sort((a,b)=>b.w-a.w||b.pf-a.pf);
  const dyn=L.type==='dynasty';
  $('#needs-tbl').innerHTML=`<thead><tr><th>Team</th><th>Record</th><th>Playoff odds</th>${SKILL.map(p=>`<th>${p}</th>`).join('')}${dyn?'<th>Window</th>':''}<th style="text-align:left">Trade style</th></tr></thead><tbody>`+sorted.map(t=>`<tr class="${t.me?'me':''}"><td><b>${esc(t.name)}</b>${t.me?' <span class="muted">(you)</span>':''}</td><td class="num">${rec(t)}</td><td class="num">${pct0(t.odds)}</td>${SKILL.map(ps=>{ const z=(t.needs||{})[ps]||0; const [c,l]=needLab(z); return `<td><span class="need ${c}" title="Starter strength vs league average: ${z>0?'+':''}${z.toFixed(1)} SD">${l}</span></td>`; }).join('')}${dyn?`<td>${t.mode?esc(t.mode.mode):''}</td>`:''}<td style="text-align:left;font-size:12.5px;color:var(--ink-2)">${t.prof?esc([...(t.prof.tags||[]), t.prof.trades?`${t.prof.trades} trade${t.prof.trades>1?'s':''} in 3 seasons`:''].filter(Boolean).join(' · ')):''}</td></tr>`).join('')+'</tbody>';
  const cl=(L.cliffs||[]); $('#tp-sub').textContent='Every roster graded by position, with playoff odds and trade habits from Sleeper history. Offers pair your surplus with their holes and are built to look fair or better to them.'+(cl.length?' Sell window: '+cl.map(c=>`${SLP[c.sid]?SLP[c.sid].n:c.sid} (${c.pos}, ${c.age})`).join(', ')+' are at the age where value usually drops.':'');
  const offers=L.offers.slice(0,9);
  if(!offers.length){ $('#offers').innerHTML='<p class="muted">No offers clear the bar right now: nothing both helps your lineup and looks fair to the other manager. Check back after this week\'s games.</p>'; return; }
  $('#offers').innerHTML=offers.map((o,i)=>{ const t=L.teams.find(x=>x.rid===o.to);
    const chip=(v,lab)=>`<span class="chip ${v>=1?'hot':v<=-1?'cold':''}">${lab} ${v>0?'+':''}${Math.round(v)}</span>`;
    return `<div class="offer"><h4>${esc(t.name)} <span class="muted" style="font-family:var(--body);font-size:12px;text-transform:none;letter-spacing:0">${rec(t)}</span></h4>
      <div class="sw"><span>You give</span><span>${o.give.map(x=>esc(pName(x,L))).join(' + ')}</span><span>You get</span><span>${o.get.map(x=>esc(pName(x,L))).join(' + ')}</span></div>
      <div class="nums">${chip(o.myGain,'Your lineup')}${chip(o.myValue,'Value')}${chip(o.theirGain,'Their lineup')}${chip(o.theirSeen,'They see')}</div>
      ${o.po?`<div class="nums"><span class="chip ${o.po[1]-o.po[0]>=0.02?'hot':o.po[1]-o.po[0]<=-0.02?'cold':''}">Your playoff odds ${pct0(o.po[0])} → ${pct0(o.po[1])}</span><span class="chip">Theirs ${pct0(o.po[2])} → ${pct0(o.po[3])}</span></div>`:''}
      <p class="why">${esc(offerWhy(o,L,t))}</p>
      <div class="row"><button class="btn" data-check="${i}">Check this trade</button><button class="btn" data-askoffer="${i}">Ask Claude</button><button class="btn" data-pitch="${i}">Write a pitch</button></div></div>`; }).join('');
}
$('#offers').addEventListener('click',e=>{
  const L=lg(); if(!L) return; const c=e.target.closest('[data-check]'), a=e.target.closest('[data-askoffer]');
  const pz=e.target.closest('[data-pitch]');
  if(pz){ const o=L.offers[+pz.dataset.pitch]; const t=L.teams.find(x=>x.rid===o.to);
    const names=arr=>arr.map(x=>pName(x,L)).join(' and ');
    const needs=SKILL.filter(p=>(t.needs||{})[p]<=-0.5), deep=SKILL.filter(p=>(t.needs||{})[p]>=0.5);
    const prompt=`Write a short trade pitch message I can send to ${t.owner} (their team is ${t.name}) in our Sleeper league chat. I'm offering ${names(o.give)} for ${names(o.get)}.\n\nWhat they gain: their weak spots are ${needs.join(', ')||'none obvious'}${deep.length?` and they're deep at ${deep.join(', ')}`:''}. Their playoff odds ${o.po?`go from ${pct0(o.po[2])} to ${pct0(o.po[3])}`:'are about the same'} by our model. Their record is ${rec(t)}.${t.prof&&t.prof.tags.length?` Their trade habits: ${t.prof.tags.join(', ')}.`:''}${L.type==='dynasty'&&t.mode?` They look like a ${t.mode.mode.toLowerCase()} team.`:''}\n\nRules: sound like a normal league mate texting, casual and friendly, 3 to 5 short sentences. Lead with what they get and why it fixes their roster. Use real stats only if helpful and keep numbers light. Don't mention models, projections software, or odds percentages. No emojis, no hashtags, no dashes used as punctuation. Then, on a new line, give one shorter backup message if they say no, offering a small sweetener that is still reasonable.\n\nPlayer notes:\n${[...o.give,...o.get].filter(x=>!x.startsWith('pick:')).map(x=>{ const s=SLP[x]; const p=s&&s.sid&&byId[s.sid]; return '- '+(p?pLine(p,replacement()):(s?s.n:x)); }).join('\n')}`;
    setMode('trade'); ask(`Pitch to ${t.name}`,prompt,'default'); $('#adv-h').scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if(c){ const o=L.offers[+c.dataset.check]; const site=x=>SLP[x]&&SLP[x].sid; trade.give=o.give.map(site).filter(Boolean); trade.get=o.get.map(site).filter(Boolean);
    setTradeKind('mine'); refreshGiveSel(); renderTradeMeter(); setMode('trade'); $('#adv-h').scrollIntoView({behavior:'smooth',block:'start'}); }
  if(a){ const o=L.offers[+a.dataset.askoffer]; const t=L.teams.find(x=>x.rid===o.to); const rep=replacement();
    const line=x=>{ if(x.startsWith('pick:')) return '- '+pickLabel(x,L)+' (draft pick)'; const s=SLP[x]; const p=s&&s.sid&&byId[s.sid]; return '- '+(p?pLine(p,rep):`${s?s.n:x} (${s?s.pos:''}, no stats this season)`); };
    const prompt=`${RULES}\n\nTASK: The site suggested this trade offer from me to ${t.name}. Tell me if I should send it, how likely ${t.name} is to accept and why, and how to pitch it to them (what they gain). Give one fallback version if they say no. Base it on usage, matchups and rest-of-season schedule, and on both teams' needs.\n\nI GIVE:\n${o.give.map(line).join('\n')}\n\nI GET:\n${o.get.map(line).join('\n')}\n\nSITE MODEL: my lineup ${o.myGain>0?'+':''}${o.myGain} rest-of-season pts, my trade value ${o.myValue>0?'+':''}${o.myValue}, their lineup ${o.theirGain>0?'+':''}${o.theirGain}, value as they likely see it ${o.theirSeen>0?'+':''}${o.theirSeen}.\n${teamRosterText(t,'THEIR')}\n${context(false)}`;
    setMode('trade'); ask(`Offer to ${t.name}`,prompt,'default'); }
});
function teamRosterText(t,label){ if(!t) return ''; return `\n${label} ROSTER (${t.name}, ${rec(t)}; position strength vs league: ${SKILL.map(p=>`${p} ${((t.needs||{})[p]||0).toFixed(1)}`).join(', ')}): `+t.players.map(pid=>{ const s=SLP[pid]; if(!s) return pid; const v=lvals(pid); return `${s.n} (${s.pos}${v?`, proj next ${v[0]==null?'-':f1(v[0])}, ROS ${Math.round(v[1])}`:''})`; }).join('; ')+'\n'; }
// ---- This week view ----
const HIST=(()=>{ try{ return JSON.parse(document.getElementById('history-data').textContent); }catch(e){ return null; } })();
function pct0(v){ return v==null?'–':Math.round(v*100)+'%'; }
function openLeague(id){ selectLeague(id); setView('team'); window.scrollTo({top:0}); }
function renderWeek(){
  if(!LEAGUES.length){ $('#view-week').innerHTML='<p class="muted">Enter your Sleeper username at the top to see your matchups, waivers and alerts.</p>'; return; }
  const nameOf=sid=>SLP[sid]?SLP[sid].n:sid;
  // alerts
  const order={high:0,med:1,low:2}; const al=[];
  LEAGUES.forEach(L=>(L.alerts||[]).forEach(a=>al.push({...a,L})));
  al.sort((a,b)=>order[a.lvl]-order[b.lvl]);
  $('#alerts').innerHTML=al.length?al.map(a=>`<div class="alert ${a.lvl}"><i></i><b>${esc(a.L.name)}</b><span>${esc(a.text)}</span></div>`).join(''):'<p class="muted">Nothing urgent. Your lineups look set.</p>';
  // matchups
  $('#mu-grid').innerHTML=LEAGUES.map(L=>{
    const me=myTeam(L); const w=me.week; const opp=w&&L.teams.find(t=>t.rid===w.opp);
    const odds=me.odds!=null?`Playoff odds ${pct0(me.odds)} · projected ${me.projW} wins`:'';
    if(!w||!opp) return `<div class="mu"><h3>${esc(L.name)}</h3><p class="muted">No matchup this week.</p><div class="meta2">${odds}</div></div>`;
    const p=w.win??0.5; const fin=w.rows.some(r=>r[5]==='final');
    const rowsT=t=>`<table><thead><tr><th>Slot</th><th style="text-align:left">${esc(t.name)}</th><th>Proj</th><th>Range</th></tr></thead><tbody>${t.week.rows.map(r=>`<tr><td>${esc(slotName(r[0]))}</td><td style="text-align:left">${r[1]?esc(nameOf(r[1])):'<span class="muted">empty</span>'}</td><td>${r[5]==='final'?'<b>'+f1(r[2])+'</b>':f1(r[2])}</td><td class="muted">${r[5]==='final'?'final':r[5]==='avg'?'avg':`${f1(r[3])}–${f1(r[4])}`}</td></tr>`).join('')}</tbody></table>`;
    return `<div class="mu"><h3>${esc(L.name)} <small>${L.type} · ${rec(me)}</small></h3>
      <div class="vs"><div class="side2"><span>You</span><b>${f1(w.mean)}</b></div><span class="mid">VS</span><div class="side2"><span>${esc(opp.name)} (${rec(opp)})</span><b>${f1(opp.week.mean)}</b></div></div>
      <div class="wp" title="Win chance"><i style="width:${Math.round(p*100)}%"></i></div>
      <div class="meta2"><b class="${p>=0.5?'hot-t':'cold-t'}">${pct0(p)} to win</b>${fin?'<span>Includes finished games</span>':''}<span>${odds}</span></div>
      <details><summary>Lineups, projections and ranges</summary><div class="tbl-wrap" style="margin-top:6px">${rowsT(me)}</div><div class="tbl-wrap" style="margin-top:6px">${rowsT(opp)}</div><p class="note" style="margin:6px 0 0">Range = a normal bad week to a normal good week (20th to 80th percentile).</p></details>
      <div class="row"><button class="btn" data-openlg="${L.id}">Open league</button></div></div>`;
  }).join('');
  // waivers
  $('#wv-grid').innerHTML=LEAGUES.map(L=>{
    const W=L.waivers; if(!W) return '';
    const me=myTeam(L);
    const head=W.type===2?`FAAB left: $${W.remaining} · bidding ${W.mood} (${rec(me)})`:`Waiver priority: ${W.position??'–'} (${W.type===1?'reverse standings':'rolling'})`;
    const rows=W.adds.slice(0,4).map(a=>{ const s=SLP[a.add]||{}; const p=s.sid&&byId[s.sid];
      return `<div class="cand"><span class="nm"${p?` data-open="${p.id}" style="cursor:pointer"`:''}>${esc(nameOf(a.add))} <span class="muted">${esc(s.pos||'')} · ${esc(s.tm||'')}</span></span><span class="chip hot">${a.bid!=null?'$'+a.bid:'+'+Math.round(a.gain)}</span><span class="why">+${Math.round(a.gain)} rest-of-season pts to your lineup${L.type==='dynasty'?` · dynasty value ${a.value>=0?'+':'−'}${Math.abs(Math.round(a.value))}`:''}${a.drop?` · drop ${esc(nameOf(a.drop))}`:''}${a.rivals?` · ${a.rivals} other team${a.rivals>1?'s':''} need this position`:''}</span></div>`; }).join('');
    return `<div class="mu"><h3>${esc(L.name)} <small>${esc(head)}</small></h3>${rows?`<div class="cands">${rows}</div>`:'<p class="muted" style="margin:0">No free agent would clearly help your lineup right now.</p>'}</div>`;
  }).join('');
  // breakouts
  const B=(SL&&SL.breakouts)||[];
  $('#bo-list').innerHTML=B.slice(0,12).map(b=>{ const p=byId[b.id]; if(!p) return '';
    const sid=(b.sids||[])[0]; const free=LEAGUES.filter(L=>{ const rostered=L.teams.some(t=>t.players.includes(sid)); return sid&&!rostered; });
    return `<div class="cand"><span class="nm" data-open="${p.id}" style="cursor:pointer">${esc(p.name)} <span class="muted">${p.pos} · ${esc(p.team)} · ${b.type==='opening'?'opening':'usage jump'}</span></span><span class="chip">${f1(p.xfp)} exp</span><span class="why">${esc(cap(b.text))}</span><span class="lgchips">${free.length?free.map(L=>`<span class="lgchip">Free in ${esc(L.name)}</span>`).join(''):'<span class="muted" style="font-size:12px">Rostered in all your leagues</span>'}</span></div>`; }).join('')||'<p class="muted">No clear breakouts this week.</p>';
  renderAccuracy();
}
function renderAccuracy(){
  const el=$('#acc'); const bt=HIST&&HIST.backtest; if(!bt){ el.innerHTML='<p class="muted">The accuracy report appears after the next data refresh.</p>'; return; }
  const k=bt.byK['0.5']||bt.byK['1.0'], b=bt.baseline, k0=bt.byK['0.0'], k1=bt.byK['1.0'];
  let h=`<div class="acc-grid">
    <div class="kpi"><div class="k">Start/sit calls right</div><div class="v">${pct0(k.pairs)}</div><div class="s">vs ${pct0(b.pairs)} picking by season average. Pairs of same-position players 1+ point apart.</div></div>
    <div class="kpi"><div class="k">Average miss per player</div><div class="v">${k.mae.toFixed(2)} pts</div><div class="s">vs ${b.mae.toFixed(2)} for season average. Lower is better.</div></div>
    <div class="kpi"><div class="k">Matchup effect</div><div class="v">Half strength</div><div class="s">Full-strength matchup adjustments missed by ${k1.mae.toFixed(2)}; none at all ${k0.mae.toFixed(2)}; half ${k.mae.toFixed(2)}. So the model uses half.</div></div>
    <div class="kpi"><div class="k">Tested on</div><div class="v">${bt.n.toLocaleString()}</div><div class="s">player games, 2025 weeks ${bt.weeks[0]} to ${bt.weeks[1]}.</div></div></div>`;
  const G=bt.grades||{};
  h+=`<div class="tbl-wrap" style="margin-top:12px"><table class="cal"><thead><tr><th>Matchup grade (full strength)</th><th>Player games</th><th>Usage baseline</th><th>Actual</th><th>Actual vs baseline</th></tr></thead><tbody>${['A','B','C','D','F'].filter(g=>G[g]).map(g=>`<tr><td>${gradeChip(g)}</td><td>${G[g].n}</td><td>${G[g].avg_base.toFixed(1)}</td><td>${G[g].avg_act.toFixed(1)}</td><td class="${G[g].ratio>=1.01?'hot-t':G[g].ratio<=0.99?'cold-t':''}">${G[g].ratio>=1?'+':'−'}${Math.abs((G[g].ratio-1)*100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
  h+=`<p class="note" style="margin:8px 0 0">Tough matchups (F) really did cost players about ${Math.round((1-(G.F?G.F.ratio:1))*100)}% of their usual output in 2025, but easy ones (A) only added about ${Math.round(((G.A?G.A.ratio:1)-1)*100)}%. Usage matters far more than matchup, which is why the model leans on usage and uses matchups as a tiebreaker.</p>`;
  const R=HIST.results||{}; const wks=Object.keys(R).sort((a,b)=>a-b);
  h+=`<h3 class="subh" style="margin-top:16px">2026, live</h3>`+(wks.length?`<div class="tbl-wrap"><table class="cal"><thead><tr><th>Week</th><th>Players</th><th>Model miss</th><th>Baseline miss</th><th>Start/sit right</th></tr></thead><tbody>${wks.map(w=>`<tr><td>Week ${w}</td><td>${R[w].n}</td><td>${R[w].mae.toFixed(2)}</td><td>${R[w].mae_base.toFixed(2)}</td><td>${pct0(R[w].pairs)}</td></tr>`).join('')}</tbody></table></div>`:`<p class="muted" style="margin:0">Projections for Week ${MXW} are saved before kickoff and scored once games finish. First results show after this week's games.</p>`);
  el.innerHTML=h;
}
$('#view-week').addEventListener('click',e=>{ const o=e.target.closest('[data-openlg]'); if(o){ openLeague(o.dataset.openlg); return; } const n=e.target.closest('[data-open]'); if(n) openPlayer(n.dataset.open); });
// ---- playoff odds simulation for trades (in the browser) ----
function simOdds(L,factor){
  const S=L.sim; if(!S||!S.weeks||!S.weeks.length) return null;
  const T=L.teams, rids=T.map(t=>t.rid), made={}; rids.forEach(r=>made[r]=0);
  let seed=987654321; const rnd=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return (seed+0.5)/4294967296; };
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()))*Math.cos(2*Math.PI*rnd());
  const N=1500;
  for(let k=0;k<N;k++){ const W={},PF={}; T.forEach(t=>{ W[t.rid]=t.w+0.5*(t.t||0); PF[t.rid]=t.pf; });
    for(const w of S.weeks){ const sc={};
      for(const r of rids){ const lv=S.live[r]; let m,v;
        if(lv&&w===MXW){ [m,v]=lv; } else { [m,v]=(S.tw[r]||{})[w]||[0,1]; m*=((factor||{})[r]||1); }
        sc[r]=m+Math.sqrt(v)*gauss(); PF[r]+=sc[r]; }
      (S.schedule[w]||[]).forEach(([a,b])=>{ if(sc[a]>sc[b]) W[a]++; else W[b]++; }); }
    rids.slice().sort((a,b)=>(W[b]*1e4+PF[b])-(W[a]*1e4+PF[a])).slice(0,S.playoffTeams).forEach(r=>made[r]++); }
  const o={}; rids.forEach(r=>o[r]=made[r]/N); return o;
}
function renderLeagueRoster(){
  const L=lg(); const t=L.teams.find(x=>x.rid===viewRid)||myTeam(L); const el=$('#roster');
  $('#team-h').textContent=t.me?'My team':t.name;
  const st=t.starters||[];
  const bench=t.players.filter(p=>!st.includes(p)&&!t.ir.includes(p)&&!t.taxi.includes(p)).sort((a,b)=>xv(b)-xv(a));
  let h=t.me?'':`<div class="viewing"><span>Viewing ${esc(t.name)} (${esc(t.owner)}), ${rec(t)}. The advisor still works from your roster.</span><button class="btn" id="back-me">Back to my team</button></div>`;
  h+=`<div class="rgroup"><h4>Starters</h4>${L.lineup.map((slot,i)=>st[i]&&st[i]!=='0'?slpRow(st[i],slot):`<div class="rp flat nostat"><span class="slot">${esc(slotName(slot))}</span><span class="nm muted">Empty</span></div>`).join('')}</div>`;
  if(bench.length) h+=`<div class="rgroup"><h4>Bench</h4>${bench.map(p=>slpRow(p,SLP[p]&&SLP[p].pos)).join('')}</div>`;
  if(t.ir.length) h+=`<div class="rgroup"><h4>IR</h4>${t.ir.map(p=>slpRow(p,SLP[p]&&SLP[p].pos)).join('')}</div>`;
  if(t.taxi.length) h+=`<div class="rgroup"><h4>Taxi squad</h4>${t.taxi.map(p=>slpRow(p,SLP[p]&&SLP[p].pos)).join('')}</div>`;
  h+=`<div class="muted">${t.players.length} players. Starters as set in Sleeper. Big number = projected points this week in this league's scoring. Letter = matchup grade. Chip = actual minus expected points per game (luck).</div>`;
  el.innerHTML=h;
  const bm=$('#back-me'); if(bm) bm.addEventListener('click',()=>{ viewRid=myTeam(L).rid; $('#team-sel').value=String(viewRid); renderRoster(); });
  updateStartIntro();
}
let faPos='ALL';
function renderFA(){
  const L=lg(); if(!L){ $('#fa-box').hidden=true; return; }
  const rep=replacement();
  const ok=p=>L.slots[p.pos]||(p.pos==='QB'&&L.slots.SUPER_FLEX);
  const ros=p=>{ const v=lvSite(p.id); return v&&v[1]!=null?v[1]:-1; };
  const list=P.filter(p=>!owner(p.id)&&ok(p)&&(faPos==='ALL'||p.pos===faPos)&&ros(p)>0).sort((a,b)=>ros(b)-ros(a)).slice(0,8);
  $('#fa-list').innerHTML=list.length?list.map(p=>{ const v=lvSite(p.id); return candLine(p,rep,`proj ${v[0]==null?'–':f1(v[0])} next · ${Math.round(v[1])} rest of season`); }).join(''):'<p class="muted">No free agents with a real role at this position.</p>';
}
$('#fa-pos').addEventListener('click',e=>{ const b=e.target.closest('button[data-p]'); if(!b) return; faPos=b.dataset.p;
  document.querySelectorAll('#fa-pos button').forEach(x=>x.setAttribute('aria-selected',x===b?'true':'false')); renderFA(); });
$('#fa-list').addEventListener('click',e=>{ const n=e.target.closest('[data-open]'); if(n) openPlayer(n.dataset.open); });

function injText(p){ const i=p.inj; if(!i) return ''; if(i.status) return i.status+(i.injury?` (${i.injury})`:''); if(i.practice){ const m=i.practice.match(/Did Not/i)?'DNP at practice':i.practice.match(/Limited/i)?'Limited at practice':''; return m; } return ''; }
function matchupText(p){
  const t=TEAMS[p.team]; if(!t) return '';
  if(t.bye) return `Week ${COV.nextWeek}: bye`;
  const n=t.next; if(!n) return 'No games left';
  const d=(TEAMS[n.opp]&&TEAMS[n.opp].dvp&&TEAMS[n.opp].dvp[p.pos])||null;
  let s=(COV.nextWeek&&n.w>COV.nextWeek?`Played Wk ${COV.nextWeek} · next `:'')+`Wk ${n.w} ${n.home?'vs':'at'} ${n.opp}`;
  if(n.implied!=null) s+=` · team total ${n.implied}`;
  if(d) s+=` · ${n.opp} ${ordinal(d.rank)} easiest vs ${p.pos}`;
  return s;
}
function ordinal(n){ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }

// ---- value model ----
function trueVal(p){ return 0.7*p.xfp + 0.3*p.ppr; }
function replacement(){
  const L=team.league, N=+L.teams||12, out={};
  const slots={QB:L.QB+(L.SF?1:0)*0.9, RB:L.RB+L.FLEX*0.45, WR:L.WR+L.FLEX*0.45, TE:L.TE+L.FLEX*0.1};
  for(const ps of ['QB','RB','WR','TE']){
    const pool=P.filter(p=>p.pos===ps && p.g>=1);
    const R=Math.max(1,Math.round(N*slots[ps]));
    const m=pool.map(p=>p.ppr).sort((a,b)=>b-a), t=pool.map(trueVal).sort((a,b)=>b-a);
    out[ps]={m:m[Math.min(R,m.length-1)]||0, t:t[Math.min(R,t.length-1)]||0, R};
  }
  return out;
}
function vals(p,rep){ rep=rep||replacement(); const r=rep[p.pos]; return {m:p.ppr-r.m, t:trueVal(p)-r.t}; }
const pos0=v=>Math.max(0,v);
const sv=v=>(v>=0?'+':'−')+Math.abs(v).toFixed(1);

// ---- storage ----
function saveState(msg){ $('#save-state').textContent=msg; }
let saveTimer=null, saving=false, dirty=false;
function persist(){ clearTimeout(saveTimer); saveTimer=setTimeout(doSave,600); }
async function doSave(){
  if(saving){ dirty=true; return; }
  saving=true;
  const body={roster:custom.roster, league:custom.league, leagueId:curLg, updatedAt:new Date().toISOString()};
  try{
    if(store.kind==='db'){ await store.ref.set(body); saveState('Saved to your account'); }
    else { localStorage.setItem('ll-team',JSON.stringify(body)); saveState('Saved on this device'); }
  }catch(e){
    try{ localStorage.setItem('ll-team',JSON.stringify(body)); store.kind='local'; saveState('Saved on this device'); }catch(_){ saveState('Could not save. Your team will reset when you close the page.'); }
  }
  saving=false; if(dirty){ dirty=false; doSave(); }
}
function applyLoaded(b){
  if(!b) return;
  if(Array.isArray(b.roster)) custom.roster=b.roster.filter(id=>byId[id]);
  if(b.league) custom.league={...DEFAULT_LG,...b.league};
  if(!booted){ if(b.leagueId!==undefined) pendingLg=b.leagueId; return; }
  if(b.leagueId!==undefined && (b.leagueId||null)!==curLg){ selectLeague(b.leagueId,true); return; }
  refreshAll();
}
(async function initStore(){
  try{ const raw=localStorage.getItem('ll-team'); if(raw){ applyLoaded(JSON.parse(raw)); store.kind='local'; } }catch(e){}
  saveState(custom.roster.length?'Saved on this device':'');
  try{
    const [db,user]=await Promise.all([window.claude?.use?.('db'),window.claude?.use?.('user')]);
    const uid = user ? await user.id() : null;
    if(db && uid){
      const ref=db.doc('data/users/'+uid+'/team');
      const snap=await ref.get();
      store={kind:'db',ref};
      if(snap.exists) { applyLoaded(snap.data()); saveState('Saved to your account'); }
      else if(custom.roster.length){ doSave(); }
      else saveState('');
    }
  }catch(e){ /* keep local */ }
})();

// ---- league settings ----
function syncLeagueInputs(){ const L=team.league; $('#lg-teams').value=String(L.teams); ['QB','RB','WR','TE','FLEX'].forEach(k=>$('#lg-'+k).value=L[k]); $('#lg-SF').checked=!!L.SF; }
$('#league').addEventListener('change',()=>{
  const L=team.league; L.teams=+$('#lg-teams').value; ['QB','RB','WR','TE','FLEX'].forEach(k=>{ L[k]=Math.max(0,Math.min(5,parseInt($('#lg-'+k).value)||0)); }); L.SF=$('#lg-SF').checked;
  persist(); renderRoster(); renderTradeMeter(); renderDeal();
});
function leagueText(){
  const SLg=lg();
  if(SLg){ const sc=SLg.scoring, me=myTeam(SLg);
    return `${SLg.name} on Sleeper: ${SLg.size}-team ${SLg.type.toUpperCase()} league ${SLg.type==='dynasty'?'(players are kept year to year, so weigh age and long-term value as well as this season)':'(redraft: only this season matters)'}. Scoring: ${sc.rec} per catch, ${sc.pass_td} per passing TD, ${sc.pass_int} per interception${sc.te_bonus?`, +${sc.te_bonus} bonus per TE catch`:''}. Starting lineup: ${lineupText(SLg)}. FLEX = RB/WR/TE${SLg.slots.SUPER_FLEX?', SF = QB/RB/WR/TE':''}. Bench ${SLg.slots.BN}${SLg.taxi?`, taxi ${SLg.taxi}`:''}${SLg.ir?`, IR ${SLg.ir}`:''}. My record: ${rec(me)}, ${me.pf} points for. The expected-points numbers on this site assume full PPR with 4-point passing TDs, so nudge QBs up in 6-point leagues and TEs up when there is a TE bonus.`; }
  const L=team.league; return `${L.teams}-team, full PPR. Starting lineup: ${L.QB} QB, ${L.RB} RB, ${L.WR} WR, ${L.TE} TE, ${L.FLEX} FLEX (RB/WR/TE)${L.SF?', 1 SUPERFLEX (QB/RB/WR/TE)':''}.`; }

// ---- player pickers ----
function makePicker(inputSel, resSel, onPick, filter){
  const inp=$(inputSel), res=$(resSel); let act=0, list=[];
  function draw(){
    const q=inp.value.trim().toLowerCase();
    if(!q){ res.hidden=true; return; }
    list=P.filter(p=>(!filter||filter(p)) && (p.name.toLowerCase().includes(q)||p.team.toLowerCase()===q)).sort((a,b)=>b.xfp-a.xfp).slice(0,8);
    if(!list.length){ res.innerHTML='<div class="muted" style="padding:8px 10px">No players match.</div>'; res.hidden=false; return; }
    act=Math.min(act,list.length-1);
    res.innerHTML=list.map((p,i)=>`<button type="button" data-id="${p.id}" class="${i===act?'act':''}"><span><b>${esc(p.name)}</b> <span class="meta">${p.pos} · ${esc(p.team)}${ownerTag(p.id)?' · '+esc(ownerTag(p.id)):''}</span></span><span class="meta">${f1(p.ppr)} / ${f1(p.xfp)} exp</span></button>`).join('');
    res.hidden=false;
  }
  inp.addEventListener('input',()=>{act=0; draw();});
  inp.addEventListener('focus',draw);
  inp.addEventListener('keydown',e=>{
    if(res.hidden) return;
    if(e.key==='ArrowDown'){e.preventDefault(); act=Math.min(act+1,list.length-1); draw();}
    else if(e.key==='ArrowUp'){e.preventDefault(); act=Math.max(act-1,0); draw();}
    else if(e.key==='Enter'){e.preventDefault(); if(list[act]){ onPick(list[act].id); inp.value=''; res.hidden=true; }}
    else if(e.key==='Escape'){ res.hidden=true; }
  });
  res.addEventListener('mousedown',e=>{ const b=e.target.closest('button[data-id]'); if(!b) return; e.preventDefault(); onPick(b.dataset.id); inp.value=''; res.hidden=true; });
  inp.addEventListener('blur',()=>setTimeout(()=>res.hidden=true,120));
}
makePicker('#add-search','#add-results',id=>addToRoster(id),p=>!team.roster.includes(p.id));

// ---- roster ----
function addToRoster(id){ if(!byId[id]||team.roster.includes(id)) return; team.roster.push(id); persist(); renderRoster(); refreshGiveSel(); renderDeal(); }
function removeFromRoster(id){ team.roster=team.roster.filter(x=>x!==id); trade.give=trade.give.filter(x=>x!==id); persist(); renderRoster(); refreshGiveSel(); renderTradeMeter(); renderDeal(); }
function renderRoster(){
  if(curLg){ renderLeagueRoster(); return; }
  $('#team-h').textContent='My team';
  const el=$('#roster'); const R=team.roster.map(id=>byId[id]).filter(Boolean);
  if(!R.length){
    el.innerHTML=`<div class="muted">Search above to add your players. Your team saves automatically, so you only do this once.</div><div><button class="btn" id="demo">Try it with an example team</button></div>`;
    $('#demo').addEventListener('click',loadExample); updateStartIntro(); return;
  }
  const groups={QB:[],RB:[],WR:[],TE:[]}; R.forEach(p=>groups[p.pos].push(p));
  el.innerHTML=Object.entries(groups).filter(([,a])=>a.length).map(([ps,a])=>`<div class="rgroup"><h4>${ps}</h4>`+a.sort((x,y)=>y.xfp-x.xfp).map(p=>{
    const it=injText(p);
    return `<div class="rp" data-id="${p.id}"><span class="nm" data-open="${p.id}">${esc(p.name)} <span class="pt muted">${esc(p.team)}</span>${it?`<span class="tag">${esc(it)}</span>`:''}</span>
      <span class="chip ${cls(p.diff)}" title="Actual minus expected points per game">${sgn(p.diff)}</span>
      <button class="x" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>
      <span class="sub">${f1(p.ppr)} actual · ${f1(p.xfp)} exp · ${esc(matchupText(p))}</span></div>`; }).join('')+'</div>').join('')
    + `<div class="muted">${R.length} player${R.length>1?'s':''}. Chip = actual minus expected points per game.</div>`;
  updateStartIntro();
}
$('#roster').addEventListener('click',e=>{ const rm=e.target.closest('[data-rm]'); if(rm){ removeFromRoster(rm.dataset.rm); return; } const o=e.target.closest('[data-open]'); if(o) openPlayer(o.dataset.open); });
function loadExample(){
  const pick=(ps,n,skip=0)=>P.filter(p=>p.pos===ps&&p.q).sort((a,b)=>b.xfp-a.xfp).slice(skip*2,skip*2+30).filter((_,i)=>i%5===2).slice(0,n).map(p=>p.id);
  team.roster=[...pick('QB',2),...pick('RB',5),...pick('WR',5),...pick('TE',2)];
  persist(); renderRoster(); refreshGiveSel(); renderDeal();
}
function updateStartIntro(){
  const w=COV.nextWeek; $('#start-go').textContent = w?`Set my Week ${w} lineup`:'Set my lineup';
  $('#start-go').disabled = team.roster.length<2;
}

// ---- trade builder ----
const trade={give:[],get:[]};
function refreshGiveSel(){
  const s=$('#give-sel'); const opts=team.roster.map(id=>byId[id]).filter(p=>p&&!trade.give.includes(p.id)).sort((a,b)=>b.xfp-a.xfp);
  s.innerHTML=`<option value="">${team.roster.length?'Add from your team…':'Add players to your team first'}</option>`+opts.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.pos}, ${esc(p.team)})</option>`).join('');
}
$('#give-sel').addEventListener('change',e=>{ if(e.target.value){ trade.give.push(e.target.value); refreshGiveSel(); renderTradeMeter(); } });
let tradeKind='mine';
const inTrade=id=>trade.give.includes(id)||trade.get.includes(id);
makePicker('#give-search','#give-results',id=>{ if(!inTrade(id)){ trade.give.push(id); refreshGiveSel(); renderTradeMeter(); } },p=>!inTrade(p.id));
makePicker('#get-search','#get-results',id=>{ if(!inTrade(id)){ trade.get.push(id); refreshGiveSel(); renderTradeMeter(); } },p=>!inTrade(p.id)&&(tradeKind==='any'||!team.roster.includes(p.id)));
// Name a side after the league team that owns all its players, when there is one.
function sideOwner(ids){ if(!curLg||!ids.length) return null; const os=ids.map(id=>owner(id)); const o=os[0]; return o&&os.every(x=>x===o)?o:null; }
function sideNames(){
  if(tradeKind==='mine') return {a:'You',b:'Them'};
  const oa=sideOwner(trade.give), ob=sideOwner(trade.get);
  let a=oa?oa.name:'Team A', b=ob?ob.name:'Team B'; if(a===b){ a+=' (A)'; b+=' (B)'; }
  return {a,b};
}
function setTradeKind(k){ tradeKind=k;
  document.querySelectorAll('#trade-kind button').forEach(x=>x.setAttribute('aria-selected',x.dataset.k===k?'true':'false'));
  $('#give-sel').hidden=k==='any';
  $('#trade-intro').textContent=k==='mine'?'Build the trade, see the value math instantly, then ask Claude for a verdict and a counteroffer. Either side can include any player.':'Check a trade between any two teams, like one your league mates are discussing. Add what each team sends and see who comes out ahead.';
  $('#trade-go').textContent=k==='mine'?'Evaluate this trade':'Who wins this trade?';
  renderTradeMeter(); }
$('#trade-kind').addEventListener('click',e=>{ const b=e.target.closest('button[data-k]'); if(b) setTradeKind(b.dataset.k); });
function pills(ids,side){ return ids.map(id=>{const p=byId[id]; const o=ownerTag(id); return `<span class="pill">${esc(p.name)} <span class="muted">${p.pos}${o&&!(tradeKind==='mine'&&o==='your team')?' · '+esc(o):''}</span><button data-side="${side}" data-id="${id}" aria-label="Remove ${esc(p.name)}">×</button></span>`;}).join(''); }
document.querySelector('.sides').addEventListener('click',e=>{ const b=e.target.closest('.pill button'); if(!b) return; trade[b.dataset.side]=trade[b.dataset.side].filter(x=>x!==b.dataset.id); refreshGiveSel(); renderTradeMeter(); });
function tradeTotals(){
  // A package is worth its best player plus whatever the others add above replacement (a below-replacement player adds nothing).
  const rep=replacement(); const sum=ids=>{ const vs=ids.map(id=>vals(byId[id],rep)); const out={m:0,t:0};
    for(const k of ['m','t']){ const arr=vs.map(v=>v[k]).sort((a,b)=>b-a); out[k]=arr.length?arr[0]+arr.slice(1).reduce((s,v)=>s+pos0(v),0):0; } return out; };
  return {give:sum(trade.give), get:sum(trade.get)};
}
function lineupRos(ids){
  const L=lg(); const slots=L.slots;
  const pool=ids.map(sid=>{ const s=SLP[sid]; const v=lvals(sid); return s&&v&&SKILL.includes(s.pos)?{pos:s.pos,v:v[1]||0}:null; }).filter(Boolean).sort((a,b)=>b.v-a.v);
  const used=new Set(); let tot=0;
  const take=(ok,n)=>{ for(let k=0;k<n;k++){ const i=pool.findIndex((x,j)=>!used.has(j)&&ok(x.pos)); if(i<0) return; used.add(i); tot+=pool[i].v; } };
  SKILL.forEach(p=>take(q=>q===p,slots[p]||0)); take(q=>q!=='QB',slots.FLEX||0); take(()=>true,slots.SUPER_FLEX||0);
  return tot+0.12*pool.filter((_,j)=>!used.has(j)).slice(0,4).reduce((s,x)=>s+x.v,0);
}
function renderLeagueMeter(N){
  const L=lg(); const sl=id=>sid2slp[id]; const V=id=>lvals(sl(id));
  if([...trade.give,...trade.get].some(id=>!V(id))) return false;
  const pack=(ids,k)=>{ const a=ids.map(id=>V(id)[k]||0).sort((x,y)=>y-x); return a.length?a[0]+a.slice(1).reduce((s,x)=>s+Math.max(0,x),0):0; };
  const tg=pack(trade.give,2), tr=pack(trade.get,2), pg=pack(trade.give,3), pr=pack(trade.get,3);
  const mine=tradeKind==='mine', dyn=L.type==='dynasty';
  const A=mine?myTeam(L):sideOwner(trade.give), B=sideOwner(trade.get);
  const gs=trade.give.map(sl), rs=trade.get.map(sl);
  let a0=null,a1=null,b0=null,b1=null;
  if(A){ a0=lineupRos(A.players); a1=lineupRos(A.players.filter(x=>!gs.includes(x)).concat(rs)); }
  if(B&&B!==A){ b0=lineupRos(B.players); b1=lineupRos(B.players.filter(x=>!rs.includes(x)).concat(gs)); }
  const scale=dyn?150:60, R=v=>(v>=0?'+':'−')+Math.abs(Math.round(v));
  const row=(lab,a,b)=>{ const d=b-a, w=Math.min(50,Math.abs(d)/scale*50), c=d>=0?'var(--hot)':'var(--cold)';
    return `<span class="lab">${lab}</span><span class="bar" style="background:var(--line)"><i style="${d>=0?'left:50%':'left:'+(50-w)+'%'};width:${w}%;background:${c};border-radius:0"></i><i style="left:50%;width:1px;background:var(--ink-3)"></i></span><span class="num">${Math.round(a)} → ${Math.round(b)} (<b class="${d>=0?'hot-t':'cold-t'}">${R(d)}</b>)</span>`; };
  const dl=a0!=null?a1-a0:0, dv=tr-tg, dp=pg-pr;
  let oddsTxt='';
  if(L.sim&&L.sim.weeks&&L.sim.weeks.length&&A){ const f={}; if(a0) f[A.rid]=a1/a0; if(B&&b0) f[B.rid]=b1/b0;
    const o0=simOdds(L,{}), o1=simOdds(L,f);
    if(o0&&o1){ oddsTxt=` ${mine?'Your':esc(N.a)} playoff odds: ${pct0(o0[A.rid])} → ${pct0(o1[A.rid])}`+(B&&B!==A?`; ${mine?'theirs':esc(N.b)}: ${pct0(o0[B.rid])} → ${pct0(o1[B.rid])}.`:'.'); } }
  const sc=dyn?dv+0.5*dl:dl+0.5*dv;
  let v;
  if(mine){ v=sc>=8?'This helps you.':sc<=-8?'This hurts you.':'Close to even for you.';
    v+=dp>=-3?' On paper it looks fair or better to them, so it has a real chance.':' On points so far they come out behind, so expect them to ask for more.'; }
  else { v=sc>=8?`${N.a} wins this.`:sc<=-8?`${N.b} wins this.`:'Close to even.';
    if(Math.abs(sc)>=8 && Math.sign(-dp)!==Math.sign(sc) && Math.abs(dp)>3) v+=' On paper it looks like the other side wins, which is why it may get accepted.'; }
  let rows='';
  if(a0!=null) rows+=row(mine?'Your lineup, rest of season':`${esc(N.a)} lineup`,a0,a1);
  if(b0!=null) rows+=row(mine?'Their lineup':`${esc(N.b)} lineup`,b0,b1);
  rows+=row(dyn?'Dynasty trade value':'Trade value',tg,tr)+row('How it looks on paper',pg,pr);
  const note=`Projected points for the rest of the season in this league's scoring, playoff weeks counted 1.5x. Trade value = points above a replacement starter${dyn?', plus future seasons adjusted for age':''}. Paper value uses points scored so far and last season, the way most managers judge players. Green = ${mine?'you gain':esc(N.a)+' gains'}.`;
  $('#trade-meter').innerHTML=`<div class="meter"><span class="verdict2">${esc(v)}${oddsTxt}</span>${rows}<span class="note" style="grid-column:1/-1">${note}</span></div>`;
  return true;
}
function renderTradeMeter(){
  $('#give-pills').innerHTML=pills(trade.give,'give'); $('#get-pills').innerHTML=pills(trade.get,'get');
  const N=sideNames();
  $('#give-h').textContent=tradeKind==='mine'?'You give':`${N.a} sends`; $('#get-h').textContent=tradeKind==='mine'?'You get':`${N.b} sends`;
  $('#trade-go').disabled=!(trade.give.length&&trade.get.length);
  if(!(trade.give.length&&trade.get.length)){ $('#trade-meter').innerHTML=''; return; }
  if(curLg && renderLeagueMeter(N)) return;
  const T=tradeTotals(); const row=(lab,a,b)=>{ const d=b-a, w=Math.min(50,Math.abs(d)/10*50), c=d>=0?'var(--hot)':'var(--cold)';
    return `<span class="lab">${lab}</span><span class="bar" style="background:var(--line)"><i style="${d>=0?'left:50%':'left:'+(50-w)+'%'};width:${w}%;background:${c};border-radius:0"></i><i style="left:50%;width:1px;background:var(--ink-3)"></i></span><span class="num">${sv(a)} → ${sv(b)} (<b class="${d>=0?'hot-t':'cold-t'}">${sv(d)}</b>)</span>`; };
  const dt=T.get.t-T.give.t, dm=T.get.m-T.give.m;
  let v;
  if(tradeKind==='mine'){
    v = dt>=1.5 ? 'You win this on usage.' : dt<=-1.5 ? 'You lose value on usage.' : 'About even on usage.';
    if(dt>=1.5 && dm<=0.5) v+=' It also looks fair or better for them on paper, so they may accept.';
    else if(dt>=1.5) v+=' It looks lopsided on paper too, so expect pushback.';
  } else {
    v = dt>=1.5 ? `${N.a} wins this on usage.` : dt<=-1.5 ? `${N.b} wins this on usage.` : 'About even on usage.';
    if(Math.abs(dt)>=1.5 && Math.sign(dm)!==Math.sign(dt) && Math.abs(dm)>0.5) v+=' On points so far it looks like the other side wins, which is why it may get accepted.';
  }
  const noteTxt = tradeKind==='mine' ? 'Points per game above a replacement-level starter in your league (negative = a player you could find on waivers), give → get. Green bar = you gain.'
    : `Points per game above a replacement-level starter (negative = waiver level). Left number is what ${esc(N.a)} sends, right is what it gets back. Green bar = ${esc(N.a)} gains.`;
  $('#trade-meter').innerHTML=`<div class="meter"><span class="verdict2">${esc(v)}</span>${row('Points so far',T.give.m,T.get.m)}${row('Usage-based',T.give.t,T.get.t)}<span class="note" style="grid-column:1/-1">${noteTxt}</span></div>`;
}

// ---- deal finder ----
let dealId=null, dealIds=[];
function setDeal(ids){ dealIds=ids; dealId=ids[0]||null;
  $('#deal-pills').innerHTML=ids.map(id=>{ const p=byId[id]; const o=ownerTag(id); return `<span class="pill">${esc(p.name)} <span class="muted">${p.pos}${o?' · '+esc(o):''}</span><button data-rmdeal="${id}" aria-label="Remove ${esc(p.name)}">×</button></span>`; }).join('');
  renderDeal(); }
makePicker('#deal-search','#deal-results',id=>{ if(!curLg){ setDeal([id]); return; } if(!dealIds.includes(id)) setDeal(dealIds.concat([id])); },p=>!dealIds.includes(p.id));
$('#deal-pills').addEventListener('click',e=>{ const b=e.target.closest('[data-rmdeal]'); if(b) setDeal(dealIds.filter(x=>x!==b.dataset.rmdeal)); });
function candLine(p,rep,extra){ const v=vals(p,rep), o=ownerTag(p.id); return `<div class="cand"><span class="nm" data-open="${p.id}" style="cursor:pointer">${esc(p.name)} <span class="muted">${p.pos} · ${esc(p.team)}${o?` · <span class="own">${esc(o)}</span>`:''}</span></span><span class="chip ${cls(p.diff)}">${sgn(p.diff)}</span><span class="why">${f1(p.ppr)} actual vs ${f1(p.xfp)} expected · ${esc(usageLine(p))}${extra?' · '+extra:''}</span></div>`; }
function dealCandidates(){
  const X=byId[dealId]; if(!X) return null; const rep=replacement(); const vx=vals(X,rep); const mine=team.roster.includes(X.id);
  if(mine){
    const c=P.filter(p=>!team.roster.includes(p.id)&&p.q).map(p=>({p,v:vals(p,rep)}))
      .filter(o=>o.v.t>vx.t+0.5 && o.v.m<=vx.m+1 && o.p.diff<0)
      .sort((a,b)=>(b.v.t-b.v.m)-(a.v.t-a.v.m)).slice(0,6);
    const similar=c.length?[]:P.filter(p=>!team.roster.includes(p.id)&&p.q).map(p=>({p,v:vals(p,rep)}))
      .filter(o=>o.v.t>=vx.t-2&&o.v.m<vx.m-1).sort((a,b)=>b.v.t-a.v.t).slice(0,5).map(o=>o.p);
    return {mine,X,targets:c.map(o=>o.p),similar};
  }
  const R=team.roster.map(id=>byId[id]).filter(p=>p&&p.id!==X.id).map(p=>({p,v:vals(p,rep)}));
  const offers=[];
  // 1-for-1: looks at least as good on paper (so his manager says yes) without a big overpay
  R.forEach(a=>{ if(a.v.m>=vx.m-0.5 && a.v.m<=vx.m+3) offers.push({ps:[a.p],m:a.v.m,t:a.v.t}); });
  // 2-for-1: two players who each fall short on paper but together clear the bar
  for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++){ const a=R[i].v, b=R[j].v; const hi=Math.max(a.m,b.m), lo=Math.min(a.m,b.m);
    const m=hi+pos0(lo), t=Math.max(a.t,b.t)+pos0(Math.min(a.t,b.t));
    if(a.m<vx.m-0.5&&b.m<vx.m-0.5&&lo>0.5&&m>=vx.m+1&&m<=vx.m+5) offers.push({ps:[R[i].p,R[j].p],m,t}); }
  offers.sort((a,b)=>a.t-b.t);
  const alts=P.filter(p=>p.pos===X.pos&&p.id!==X.id&&!team.roster.includes(p.id)&&p.q).map(p=>({p,v:vals(p,rep)}))
    .filter(o=>o.v.t>=vx.t-1&&o.p.ppr<X.ppr-1).sort((a,b)=>b.v.t-a.v.t).slice(0,4);
  return {mine,X,offers:offers.slice(0,4),alts:alts.map(o=>o.p)};
}
// ---- league-aware deal finder: our value, market value and each team's lineup ----
function mktOf(sid){ const v=lvals(sid); return v?(v[4]!=null?v[4]:v[2]):0; }
function pkg(ids,f){ const a=ids.map(f).sort((x,y)=>y-x); return a.length?a[0]+a.slice(1).reduce((s,x)=>s+Math.max(0,x),0):0; }
function mktLabel(sid){ const v=lvals(sid); if(!v) return ''; const b=[]; if(v[5]) b.push(`#${v[5]} on the trade market`); if(v[6]){ const L=lg(); const n=L.size; b.push(`drafted ${Math.ceil(v[6]/n)}.${String((v[6]-1)%n+1).padStart(2,'0')} here`); } return b.join(' · '); }
function combosOf(arr,maxN){ const out=[]; const n=arr.length;
  for(let i=0;i<n;i++){ out.push([arr[i]]); if(maxN<2) continue;
    for(let j=i+1;j<n;j++){ out.push([arr[i],arr[j]]); if(maxN<3||i>=8||j>=8) continue;
      for(let k=j+1;k<Math.min(n,9);k++) out.push([arr[i],arr[j],arr[k]]); } }
  return out; }
function countPrem(nGet,nGive){ return nGet>nGive?0.85:nGet<nGive?1.1:1.0; } // consolidating into fewer, better players costs a premium
function leagueDeals(){
  const L=lg(); if(!L||!dealIds.length) return null;
  const sids=dealIds.map(id=>sid2slp[id]).filter(s=>s&&lvals(s)); if(!sids.length) return null;
  const me=myTeam(L); const mineSel=sids.filter(s=>me.players.includes(s)), theirSel=sids.filter(s=>!me.players.includes(s));
  const owners=[...new Set(theirSel.map(s=>L.teams.find(t=>t.players.includes(s))).filter(Boolean))];
  const fa=theirSel.filter(s=>!L.teams.some(t=>t.players.includes(s)));
  const skill=t=>t.players.filter(p=>SLP[p]&&SKILL.includes(SLP[p].pos)&&lvals(p)&&!t.ir.includes(p));
  const tv=p=>lvals(p)[2]||0, pv=p=>lvals(p)[3]||0;
  const P_=(ids,f)=>pkg(ids,f);
  const myIds=skill(me), base=lineupRos(myIds);
  const res={L,me,sids,mineSel,theirSel,owners,fa,kind:null,list:[],core:null};
  if(fa.length){ res.kind='fa'; return res; }
  if(owners.length>1){ res.kind='multi'; return res; }
  const O=owners[0];
  const evalDeal=(give,get,t)=>{ const gain=lineupRos(myIds.filter(p=>!give.includes(p)).concat(get))-base;
    const tb=lineupRos(skill(t)); const their=lineupRos(skill(t).filter(p=>!get.includes(p)).concat(give))-tb;
    return {t,give,get,gain,dv:P_(get,tv)-P_(give,tv),mk:P_(get,mktOf)-P_(give,mktOf),their,
      fairThem:P_(give,pv)>=countPrem(give.length,get.length)*P_(get,pv)-3, fairMe:P_(get,mktOf)>=0.9*P_(give,mktOf)&&P_(get,tv)>=0.95*P_(give,tv)}; };
  if(!theirSel.length){                      // selling a package of mine
    res.kind='sell';
    L.teams.filter(t=>!t.me).forEach(t=>{
      const th=skill(t).sort((a,b)=>tv(b)-tv(a)).slice(0,12);
      combosOf(th,Math.min(3,mineSel.length+1)).forEach(g=>{ if(g.length>1&&g.some(p=>tv(p)<=0)) return;
        const d=evalDeal(mineSel,g,t); if(d.fairThem&&d.fairMe&&d.their>=-25) res.list.push(d); }); });
  } else if(!mineSel.length){                // buying a package from one team
    res.kind='buy';
    const mine=myIds.filter(p=>!theirSel.includes(p)).sort((a,b)=>tv(b)-tv(a)).slice(0,12);
    combosOf(mine,Math.min(3,theirSel.length+1)).forEach(g=>{ if(g.length>1&&g.some(p=>pv(p)<=0)) return;
      const d=evalDeal(g,theirSel,O); if(!d.fairThem) return; if(P_(g,mktOf)>1.3*P_(theirSel,mktOf)) return; if(d.their<-25) return; res.list.push(d); });
  } else {                                   // a stacked deal: balance it
    res.kind='balance'; res.core=evalDeal(mineSel,theirSel,O);
    if(!res.core.fairThem){                  // add one of mine
      myIds.filter(p=>!mineSel.includes(p)).forEach(p=>{ const d=evalDeal(mineSel.concat([p]),theirSel,O); if(d.fairThem&&d.their>=-25) { d.add=p; d.side='you'; res.list.push(d); } });
    } else if(!res.core.fairMe){             // ask them to add one of theirs
      skill(O).filter(p=>!theirSel.includes(p)).forEach(p=>{ const d=evalDeal(mineSel,theirSel.concat([p]),O); if(d.fairMe&&d.fairThem&&d.their>=-25){ d.add=p; d.side='them'; res.list.push(d); } });
    }
  }
  const sc=d=>L.type==='dynasty'?d.dv+0.5*d.gain:d.gain+0.3*d.dv;
  res.list.sort((a,b)=>res.kind==='balance'?(a.side==='you'?tv(a.add)-tv(b.add):sc(b)-sc(a)):sc(b)-sc(a));
  const seen=new Set(), top=[];
  for(const d of res.list){ const k=d.t.rid+':'+d.give.join(',')+'>'+d.get.join(','); if(seen.has(k)) continue; seen.add(k);
    if(res.kind==='sell'&&top.filter(x=>x.t===d.t).length>=2) continue; top.push(d); if(top.length>=6) break; }
  res.list=top; return res;
}
function renderLeagueDeal(){
  const out=$('#deal-out'); const D=leagueDeals(); $('#deal-go').disabled=!D||['fa','multi'].includes(D&&D.kind);
  if(!D){ out.innerHTML=dealIds.length?'<p class="muted">No projection for that player in this league yet.</p>':''; return; }
  const nm=s=>SLP[s]?SLP[s].n:s, names=a=>a.map(s=>esc(nm(s))).join(' + ');
  const sgnr=v=>(v>=0?'+':'−')+Math.abs(Math.round(v));
  const head=D.sids.map(s=>{ const v=lvals(s); return `<div class="cand" style="border-color:var(--ink-3)"><span class="nm">${esc(nm(s))} <span class="muted">${esc(SLP[s].pos)} · ${esc(SLP[s].tm)} · ${D.me.players.includes(s)?'yours':esc(ownerTag(SLP[s].sid)||'')}</span></span><span class="chip">value ${Math.round(v[2])}</span><span class="why">${esc(mktLabel(s)||'no market data')} · ${Math.round(v[1])} projected pts rest of season</span></div>`; }).join('');
  if(D.kind==='fa'){ out.innerHTML=head+`<p class="muted">${names(D.fa)} ${D.fa.length>1?'are free agents':'is a free agent'} here, so you can pick ${D.fa.length>1?'them':'him'} up instead of trading.</p>`; return; }
  if(D.kind==='multi'){ out.innerHTML=head+`<p class="muted">Those players are on different teams (${D.owners.map(t=>esc(t.name)).join(', ')}). A deal can only include one other team, so remove the players from all but one.</p>`; return; }
  const card=d=>`<div class="cand"><span class="nm">${D.kind==='sell'?`${esc(d.t.name)}: `:''}${D.kind==='balance'?`${d.side==='you'?'You add':'They add'} ${esc(nm(d.add))}`:names(D.kind==='sell'?d.get:d.give)}</span><span class="chip ${d.gain>=3?'hot':d.gain<=-3?'cold':''}">lineup ${sgnr(d.gain)}</span><span class="why">You give ${names(d.give)} · you get ${names(d.get)} · value ${sgnr(d.dv)} for you · market ${sgnr(d.mk)} · their lineup ${sgnr(d.their)}</span><span class="row" style="grid-column:1/-1"><button class="btn" data-dealcheck='${JSON.stringify([d.give,d.get])}'>Open in Trade check</button></span></div>`;
  let h=head;
  if(D.kind==='sell'){ h+=`<h5 class="subh">What ${D.mineSel.length>1?'this package':esc(nm(D.mineSel[0]))} should bring back</h5><p class="note">Returns of one to three players worth at least 90% of the market value and our value of what you send, that the other manager should see as fair.</p>`; }
  if(D.kind==='buy'){ h+=`<h5 class="subh">Offers ${esc(D.owners[0].name)} should accept</h5><p class="note">One to three of your players. Sending more players than you get back needs a premium; paying more than 30% over market is filtered out.</p>`; }
  if(D.kind==='balance'){ const c=D.core;
    h+=`<h5 class="subh">Your stacked deal with ${esc(D.owners[0].name)}</h5><div class="cand"><span class="nm">You give ${names(c.give)} · you get ${names(c.get)}</span><span class="chip ${c.gain>=3?'hot':c.gain<=-3?'cold':''}">lineup ${sgnr(c.gain)}</span><span class="why">Value ${sgnr(c.dv)} for you · market ${sgnr(c.mk)} · their lineup ${sgnr(c.their)} · ${c.fairThem&&c.fairMe?'<b class="hot-t">Fair to both sides as is.</b>':!c.fairThem?'<b class="cold-t">They likely say no: it looks light to them.</b>':'<b class="cold-t">You would be selling under market.</b>'}</span><span class="row" style="grid-column:1/-1"><button class="btn" data-dealcheck='${JSON.stringify([c.give,c.get])}'>Open in Trade check</button></span></div>`;
    if(!(c.fairThem&&c.fairMe)) h+=`<h5 class="subh">${!c.fairThem?'Add one of yours to get it done':'Ask them to add one of theirs'}</h5>`; }
  if(!(D.kind==='balance'&&D.core.fairThem&&D.core.fairMe))
    h+=D.list.length?`<div class="cands">${D.list.map(card).join('')}</div>`:`<p class="muted">${D.kind==='sell'?'No team has a fair return right now without you taking a loss. That usually means hold.':D.kind==='buy'?'Nothing on your roster gets there without overpaying.':'No single player balances it. Try swapping a piece instead.'}</p>`;
  out.innerHTML=h;
}
$('#deal-out').addEventListener('click',e=>{ const b=e.target.closest('[data-dealcheck]'); if(!b) return; const [g,r]=JSON.parse(b.dataset.dealcheck); const site=x=>SLP[x]&&SLP[x].sid;
  trade.give=g.map(site).filter(Boolean); trade.get=r.map(site).filter(Boolean); setTradeKind('mine'); refreshGiveSel(); renderTradeMeter(); setMode('trade'); });
function renderDeal(){
  if(curLg){ renderLeagueDeal(); return; }
  const out=$('#deal-out'); const D=dealCandidates(); $('#deal-go').disabled=!D;
  if(!D){ out.innerHTML=''; return; }
  const X=D.X, rep=replacement();
  let h=`<div class="cand" style="border-color:var(--ink-3)"><span class="nm">${esc(X.name)} <span class="muted">${X.pos} · ${esc(X.team)} · ${D.mine?'on your team':'not on your team'}</span></span><span class="chip ${cls(X.diff)}">${sgn(X.diff)}</span><span class="why">${f1(X.ppr)} actual vs ${f1(X.xfp)} expected · ${esc(usageLine(X))}</span></div>`;
  if(D.mine){
    h+=`<h5 class="subh">Buy-low targets for ${esc(X.name.split(' ').slice(-1)[0])}</h5><p class="note">Players who have scored no more than ${esc(X.name)} so far (so the trade looks fair to the other manager) but whose usage is worth more.</p>`;
    if(D.targets.length) h+=`<div class="cands">${D.targets.map(p=>candLine(p,rep)).join('')}</div>`;
    else if(D.similar.length) h+=`<p class="muted">Nobody with a clearly better role costs less on paper, which makes ${esc(X.name)} a sell-high candidate. These players have nearly the same usage but have scored less, so you can ask for one of them plus an extra piece.</p><div class="cands">${D.similar.map(p=>candLine(p,rep)).join('')}</div>`;
    else h+='<p class="muted">No clear upgrades at this price yet.</p>';
  } else {
    h+=`<h5 class="subh">Offers that should work</h5>`;
    h+= D.offers.length?`<div class="cands">${D.offers.map(o=>`<div class="cand"><span class="nm">${o.ps.map(p=>esc(p.name)).join(' + ')}</span><span class="chip">${o.ps.length} for 1</span><span class="why">Matches his value on paper while costing you the least usage-based value. ${o.ps.map(p=>`${esc(p.name)}: ${f1(p.ppr)} actual / ${f1(p.xfp)} exp`).join(' · ')}</span></div>`).join('')}</div>`
      : `<p class="muted">${team.roster.length?'Nothing on your roster matches his value on paper by itself or in a pair.':'Add your team first to see offers from your roster.'}</p>`;
    h+=`<h5 class="subh">Cheaper players with similar usage</h5>`;
    h+= D.alts.length?`<div class="cands">${D.alts.map(p=>candLine(p,rep)).join('')}</div>`:'<p class="muted">No cheaper look-alikes right now.</p>';
  }
  out.innerHTML=h;
}
$('#deal-out').addEventListener('click',e=>{ const n=e.target.closest('[data-open]'); if(n) openPlayer(n.dataset.open); });

// ---- modes ----
let mode='start';
function setMode(m){ mode=m;
  document.querySelectorAll('#modes button').forEach(x=>x.setAttribute('aria-selected',x.dataset.mode===m?'true':'false'));
  ['start','trade','deal','ask'].forEach(k=>$('#mode-'+k).hidden=k!==m); }
$('#modes').addEventListener('click',e=>{ const b=e.target.closest('button[data-mode]'); if(b) setMode(b.dataset.mode); });

// ---- prompt building ----
function pLine(p,rep){
  rep=rep||replacement(); const v=vals(p,rep); const t=TEAMS[p.team]||{}; const n=t.next;
  let s=`${p.name} (${p.pos}, ${p.team}) | G ${p.g} | PPR/G ${f1(p.ppr)} | xFP/G ${f1(p.xfp)} | diff ${p.diff>0?'+':''}${(+p.diff).toFixed(1)} | snap ${pct(p.snap)}`;
  if(p.pos==='QB') s+=` | pass att/g ${(p.att/p.g).toFixed(1)}`;
  s+=` | car/g ${(p.car/p.g).toFixed(1)} | tgt/g ${(p.tgt/p.g).toFixed(1)} | tgt share ${pct(p.ts,1)} | RZ touches ${p.rz} | GL carries ${p.gl}`;
  s+=` | value above replacement: points-so-far ${v.m.toFixed(1)}, usage-based ${v.t.toFixed(1)}`;
  if(t.bye) s+=` | NEXT: BYE in week ${COV.nextWeek}`;
  if(!t.bye && n && COV.nextWeek && n.w>COV.nextWeek) s+=` | ALREADY PLAYED in week ${COV.nextWeek} (locked; points count as scored)`;
  if(!t.bye && n){ const d=TEAMS[n.opp]&&TEAMS[n.opp].dvp&&TEAMS[n.opp].dvp[p.pos]; s+=` | NEXT: wk ${n.w} ${n.home?'vs':'at'} ${n.opp} on ${n.date}`+(n.implied!=null?`, team implied total ${n.implied}, spread ${n.spread>0?'+':''}${n.spread}`:'')+(d?`, ${n.opp} allows ${d.pts} PPR/g to ${p.pos} (rank ${d.rank}/32, 1 = most allowed)`:''); }
  const it=p.inj; if(it) s+=` | INJURY REPORT wk ${it.w}: ${[it.status,it.practice,it.injury].filter(Boolean).join(', ')}`;
  const sp=SLP[sid2slp[p.id]]; if(sp&&sp.age) s+=` | age ${sp.age}`;
  const lv=lvSite(p.id); if(lv){ const ng=nextGame(p.id); s+=` | THIS LEAGUE: proj next game ${lv[0]==null?'none (bye or already played)':f1(lv[0])}${ng?` (matchup grade ${gradeOf(ng.m)} wk ${ng.w} ${ng.home?'vs':'at'} ${ng.opp}${ng.why.length?': '+ng.why.join('; '):''})`:''}, rest-of-season proj ${Math.round(lv[1])} pts, trade value ${Math.round(lv[2])}, value as other managers likely see him ${Math.round(lv[3])}`; const m=MXP[p.id]; if(m&&m.weeks) s+=` | ROS schedule grades: `+m.weeks.map(w=>`W${w[0]} ${w[1]} ${gradeOf(combM(m.pos,w[3],w[4]))}`).join(', '); }
  if(curLg){ const o=owner(p.id); s+=` | ${o?(o.me?'ON MY TEAM':'rostered by '+o.name):'FREE AGENT'}`; const ml=mktLabel(sid2slp[p.id]); if(ml) s+=` | ${ml}`; }
  s+=` | weekly PPR/xFP: `+p.wk.map(w=>`W${w.w} ${f1(w.ppr)}/${f1(w.xfp)}`).join(', ');
  return s;
}
function context(extraPool){
  const rep=replacement(); const R=team.roster.map(id=>byId[id]).filter(Boolean);
  let c=`LEAGUE: ${leagueText()}\n`;
  c+=`DATA: nflverse, ${COV.season} regular season through week ${COV.lastWeek} (${COV.gamesInLastWeek} of ${COV.totalInLastWeek} week-${COV.lastWeek} games played so far). Next week to set lineups for: ${COV.nextWeek}. Data refreshed ${DATA.updated||'recently'}.\n`;
  c+=`DEFINITIONS: PPR/G = actual PPR points per game. xFP/G = expected PPR points per game from nflverse's ffopportunity model (what an average player scores with the same opportunities, graded by field position, down, distance, air yards). diff = PPR/G minus xFP/G (negative = unlucky, usually rebounds; positive = lucky, usually fades). Value above replacement = points per game above the replacement-level starter at that position in this league (negative = roughly waiver-level); "points-so-far" value uses actual PPR/G (how other managers see him), "usage" value uses 0.7*xFP + 0.3*PPR (what he is likely worth going forward). THIS LEAGUE numbers are the site's projection model: usage-based points per game adjusted per game for Vegas team total, the opponent's run defense on the runner's inside/outside mix, pass defense, deep defense, points allowed to the position and man/zone fit, scored in this league's settings. Matchup grade A = easiest, F = hardest. Rest-of-season points weight playoff weeks 1.5x. Trade value = points above replacement (dynasty adds future seasons by age). Prefer these projections over raw PPR/G when they disagree, and explain matchups in plain words.\n\n`;
  c+=`MY ROSTER (${R.length} players with stats):\n`+(R.length?R.map(p=>'- '+pLine(p,rep)).join('\n'):'(empty)')+'\n';
  const SLg=lg();
  if(SLg){ const me=myTeam(SLg);
    c+=`\nMY CURRENT SLEEPER LINEUP: `+SLg.lineup.map((slot,i)=>{ const s=SLP[me.starters[i]]; return `${slotName(slot)} ${s?s.n:'(empty)'}`; }).join('; ')+'\n';
    const nost=me.players.filter(pid=>{ const s=SLP[pid]; return s&&!(s.sid&&byId[s.sid]); }).map(pid=>{ const s=SLP[pid]; return `${s.n} (${s.pos}, ${s.tm}${s.inj?', '+s.inj:''}${s.age?', age '+s.age:''})`; });
    if(nost.length) c+=`ALSO ON MY ROSTER, NO STATS IN THIS DATA (kickers, defenses, injured or not yet played): ${nost.join('; ')}\n`;
    c+=suggText();
    if(me.odds!=null) c+=`MY PLAYOFF ODDS (site simulation): ${pct0(me.odds)}, projected ${me.projW} wins. This week: ${me.week?`${f1(me.week.mean)} projected vs ${f1((SLg.teams.find(t=>t.rid===me.week.opp)||{week:{}}).week.mean)}, win chance ${pct0(me.week.win)}`:'no matchup'}.\n`;
    if(SLg.waivers&&SLg.waivers.adds.length) c+=`TOP WAIVER ADDS FOR ME: `+SLg.waivers.adds.slice(0,4).map(a=>`${SLP[a.add]?SLP[a.add].n:a.add} (+${Math.round(a.gain)} ROS lineup pts${a.bid!=null?', suggested bid $'+a.bid:''}${a.drop?', drop '+(SLP[a.drop]?SLP[a.drop].n:a.drop):''})`).join('; ')+'\n';
    c+=`TEAM NEEDS IN THIS LEAGUE (starter strength by position vs league average in SD; negative = need): `+SLg.teams.map(t=>`${t.name}${t.me?' (me)':''} ${rec(t)}: `+SKILL.map(p=>`${p} ${((t.needs||{})[p]||0).toFixed(1)}`).join(' ')).join(' | ')+'\n';
    if(me.ir.length) c+=`ON MY IR: ${me.ir.map(pid=>SLP[pid]?SLP[pid].n:pid).join(', ')}\n`;
    if(me.taxi.length) c+=`ON MY TAXI SQUAD: ${me.taxi.map(pid=>SLP[pid]?SLP[pid].n:pid).join(', ')}\n`;
  }
  if(extraPool){
    const pool=P.filter(p=>p.q&&!team.roster.includes(p.id)).sort((a,b)=>b.xfp-a.xfp).slice(0,120);
    c+=SLg?`\nOTHER PLAYERS WITH REAL ROLES (owner in my league shown: FREE AGENT means I can pick him up; otherwise the team that rosters him):\n`:`\nOTHER PLAYERS WITH REAL ROLES (not on my roster; they may be on other teams in my league or on waivers, I don't know which):\n`;
    c+=pool.map(p=>`- ${SLg?'['+(owner(p.id)?owner(p.id).name:'FREE AGENT')+'] ':''}${p.name} (${p.pos}, ${p.team}) PPR/G ${f1(p.ppr)}, xFP/G ${f1(p.xfp)}, diff ${(+p.diff).toFixed(1)}, ${usageLine(p)}, value so-far ${vals(p,rep).m.toFixed(1)} / usage ${vals(p,rep).t.toFixed(1)}`).join('\n')+'\n';
  }
  return c;
}
const RULES=`You are a sharp, practical fantasy football analyst advising one manager in a PPR league. Use ONLY the data provided below; do not invent injuries, depth-chart news, or stats that are not listed. If something important is unknown (for example the latest injury news), say so in one short line. The sample is small early in the season, so lean on expected points and usage more than on actual points, but don't lecture about sample size. Write for someone new to analytics: plain English, short sentences, no jargon without a quick explanation. Format in Markdown: start with a one- or two-sentence bottom line in bold, then short sections with ### headings and bullet points. No tables. Keep it under 350 words.`;

// ---- asking Claude ----
let ctl=null, samplePromise=null;
function getSample(){ if(!samplePromise) samplePromise=(window.claude?.use?.('sample')||Promise.resolve(null)); return samplePromise; }
function mdToHtml(src){
  const lines=esc(src).split('\n'); let h='', list=null;
  const inline=s=>s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g,'$1<em>$2</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const close=()=>{ if(list){ h+=`</${list}>`; list=null; } };
  for(const raw of lines){ const l=raw.trimEnd();
    let m;
    if(m=l.match(/^#{1,6}\s+(.*)/)){ close(); h+=`<h3>${inline(m[1])}</h3>`; }
    else if(m=l.match(/^\s*[-*•]\s+(.*)/)){ if(list!=='ul'){ close(); h+='<ul>'; list='ul'; } h+=`<li>${inline(m[1])}</li>`; }
    else if(m=l.match(/^\s*\d+[.)]\s+(.*)/)){ if(list!=='ol'){ close(); h+='<ol>'; list='ol'; } h+=`<li>${inline(m[1])}</li>`; }
    else if(!l.trim()){ close(); }
    else { close(); h+=`<p>${inline(l)}</p>`; }
  }
  close(); return h;
}
const ERR={not_granted:'Claude access was declined for this page. Reload the page to be asked again.',sampling_disabled:'Claude isn\'t available for this account.',not_declared:'The advisor is turned off on this version of the page.',capability_disabled:'The advisor isn\'t available in this view. Open the page in the Claude app or at claude.ai.',capability_removed:'The advisor isn\'t available in this view. Open the page in the Claude app or at claude.ai.',rate_limited:'Too many requests right now, or you\'ve hit your Claude usage limit. Try again in a few minutes.',session_expired:'Please sign in to Claude again, then retry.',refused:'Claude declined that request. Try rephrasing it.',empty_completion:'Claude returned an empty answer. Try again with a shorter question.',prompt_too_large:'That request was too big. Remove a few players and try again.'};
async function ask(title, prompt, tier){
  const sample=await getSample();
  const box=$('#answer'), body=$('#answer-body'), note=$('#answer-note'), stop=$('#stop');
  box.hidden=false; $('#answer-title').textContent=title; note.textContent='';
  if(!sample){ body.innerHTML=`<p class="err">The AI advisor only works when this page is open in the Claude app or at claude.ai.</p>`; return; }
  const goBtns=['#start-go','#trade-go','#deal-go','#ask-go'].map(s=>$(s)); goBtns.forEach(b=>b.dataset.was=b.disabled); goBtns.forEach(b=>b.disabled=true);
  body.innerHTML=`<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Claude is thinking. This usually takes 10 to 40 seconds.</div>`;
  stop.hidden=false; ctl=new AbortController();
  box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
  try{
    const r=await sample(prompt,{signal:ctl.signal,modelTier:tier||'default',cache:false,onText:({text})=>{ body.innerHTML=`<div class="md">${mdToHtml(text)}</div>`; }});
    body.innerHTML=`<div class="md">${mdToHtml(r.text)}</div>`;
    if(r.truncated) note.textContent='The answer was cut short. Ask a narrower question for the rest.';
  }catch(e){
    const keep=e&&e.text; body.innerHTML= keep?`<div class="md">${mdToHtml(keep)}</div>`:'';
    if(e&&e.code==='cancelled') note.textContent='Stopped.';
    else body.insertAdjacentHTML('beforeend',`<p class="err">${esc(ERR[e&&e.code]||'Something went wrong reaching Claude. Try again.')}</p>`);
  }finally{
    stop.hidden=true; ctl=null; goBtns.forEach(b=>b.disabled=b.dataset.was==='true');
    updateStartIntro(); $('#trade-go').disabled=!(trade.give.length&&trade.get.length); $('#deal-go').disabled=!dealIds.length;
  }
}
$('#stop').addEventListener('click',()=>ctl&&ctl.abort());

$('#start-go').addEventListener('click',()=>{
  const note=$('#start-note').value.trim();
  const prompt=`${RULES}\n\nTASK: Set my starting lineup for week ${COV.nextWeek}. Fill every starting slot from my roster, respecting byes and injury designations. For each slot name the player and give a one-line reason (usage, expected points, matchup, team total). Then list my bench, and flag the 1-2 closest calls and what would flip them. If a player's team already played this week, note that he is locked.${note?`\n\nMY NOTE: ${note}`:''}\n\n${context(false)}`;
  ask(`Week ${COV.nextWeek} lineup`,prompt,'default');
});
$('#trade-go').addEventListener('click',()=>{
  const rep=replacement(), T=tradeTotals();
  const g=trade.give.map(id=>'- '+pLine(byId[id],rep)).join('\n'), r=trade.get.map(id=>'- '+pLine(byId[id],rep)).join('\n');
  if(tradeKind==='any'){
    const N=sideNames(), oa=sideOwner(trade.give), ob=sideOwner(trade.get);
    const rosterTxt=(t,label)=>{ if(!t) return ''; return `\n${label} FULL ROSTER (${t.name}, ${rec(t)}): `+t.players.map(pid=>{ const s=SLP[pid]; if(!s) return pid; const p=s.sid&&byId[s.sid]; return `${s.n} (${s.pos}${p?`, ${f1(p.ppr)} PPR/G, ${f1(p.xfp)} xFP/G`:''})`; }).join('; ')+'\n'; };
    const prompt2=`${RULES}\n\nTASK: Evaluate this trade between two other teams (it may not involve me). Say who wins and by how much, explained through usage and expected points. Say whether it is fair, and if not, what the losing side should ask for to balance it. If roster context is given, say how the trade changes each team's starting lineup. If I'm in this league and neither team is mine, add one line on whether it makes either team a bigger threat to me.\n\n${N.a.toUpperCase()} SENDS:\n${g}\n\n${N.b.toUpperCase()} SENDS:\n${r}\n\nVALUE MATH (points per game above replacement, what ${N.a} sends vs what it receives): points-so-far ${T.give.m.toFixed(1)} vs ${T.get.m.toFixed(1)}; usage-based ${T.give.t.toFixed(1)} vs ${T.get.t.toFixed(1)}.\n${rosterTxt(oa,N.a.toUpperCase())}${rosterTxt(ob,N.b.toUpperCase())}\n${context(false)}`;
    ask(`${N.a} vs ${N.b}`,prompt2,'default'); return;
  }
  const prompt=`${RULES}\n\nTASK: Evaluate this proposed trade for me. Give a clear verdict (accept, decline, or counter), explain it through usage and expected points, consider how it changes my starting lineup and depth, and say whether the other manager is likely to accept given how the players have scored so far. If I should counter, propose one specific counteroffer using players from my roster.\n\nI GIVE:\n${g}\n\nI GET:\n${r}\n\nVALUE MATH (points per game above replacement, give vs get): points-so-far ${T.give.m.toFixed(1)} vs ${T.get.m.toFixed(1)}; usage-based ${T.give.t.toFixed(1)} vs ${T.get.t.toFixed(1)}.\n\n${context(false)}`;
  ask('Trade verdict',prompt,'default');
});
$('#deal-go').addEventListener('click',()=>{
  if(curLg){ const D=leagueDeals(); if(!D||['fa','multi'].includes(D.kind)) return; const rep=replacement(); const nm=s=>SLP[s]?SLP[s].n:s;
    const line=s=>{ const q=SLP[s]; const p=q&&q.sid&&byId[q.sid]; return '- '+(p?pLine(p,rep):nm(s))+(mktLabel(s)?' | '+mktLabel(s):''); };
    const sel=D.sids.map(nm).join(' + ');
    const task=D.kind==='sell'?`I might trade ${sel} as a package. Don't suggest selling below trade market value. Tell me whether to sell or hold, which return below is best and why (or a better one from the player list), in terms of my lineup, rest-of-season value and playoff weeks.`
      :D.kind==='buy'?`I want to acquire ${sel} from ${D.owners[0].name}. Say if it's worth it at market price, which offer below is best, and how to pitch it.`
      :`I'm building this trade with ${D.owners[0].name}: I give ${D.mineSel.map(nm).join(' + ')} and get ${D.theirSel.map(nm).join(' + ')}. Is it fair to both sides and good for me? If not, what exactly should be added or swapped? Suggestions below are pre-screened.`;
    const deals=(D.core?[D.core]:[]).concat(D.list);
    const list=`PLAYERS SELECTED:\n${D.sids.map(line).join('\n')}\n\nPRE-SCREENED DEALS (lineup = change in my rest-of-season lineup points, value = our trade value change, market = trade market value change):\n`+(deals.map(d=>`- ${d.t.name}: give ${d.give.map(nm).join(' + ')}, get ${d.get.map(nm).join(' + ')} | lineup ${d.gain.toFixed(0)}, value ${d.dv.toFixed(0)}, market ${d.mk.toFixed(0)}, their lineup ${d.their.toFixed(0)}`).join('\n')||'(none)')+'\n\nOTHER PLAYERS IN THOSE DEALS:\n'+[...new Set(deals.flatMap(d=>[...d.give,...d.get]))].filter(s=>!D.sids.includes(s)).map(line).join('\n');
    ask(D.kind==='sell'?`Deals for ${sel}`:D.kind==='buy'?`How to get ${sel}`:'Stacked deal',`${RULES}\n\nTASK: ${task}\n\n${list}\n\n${context(true)}`,'default'); return; }
  const D=dealCandidates(); if(!D) return; const rep=replacement(); const X=D.X;
  let task, list='';
  if(D.mine){
    task=`I'm willing to trade ${X.name} from my roster. Recommend the best buy-low targets I should go after for him: players whose current value on paper is low but whose usage points to upside. Propose 2-3 specific, realistic offers (1-for-1 or small packages) that the other manager should accept based on how the players have scored so far, and explain why each one helps me. You may also pick from the wider player list below.`;
    list=`MY PLAYER:\n- ${pLine(X,rep)}\n\nPRE-SCREENED TARGETS (scored no more than ${X.name} so far, better usage):\n`+(D.targets.map(p=>'- '+pLine(p,rep)).join('\n')||'(none)')+(D.similar.length?`\n\nSIMILAR USAGE BUT CHEAPER ON PAPER (could get one plus an extra piece):\n`+D.similar.map(p=>'- '+pLine(p,rep)).join('\n'):'');
  } else {
    task=`I want to acquire ${X.name}. Tell me whether he's worth buying at his current price, then propose 2-3 specific offers from my roster that his manager would likely accept based on how the players have scored so far, while costing me the least real value. Also say whether one of the cheaper look-alikes is the smarter buy.`;
    list=`TARGET:\n- ${pLine(X,rep)}\n\nPRE-SCREENED OFFERS FROM MY ROSTER (match his value on paper):\n`+(D.offers.map(o=>'- '+o.ps.map(p=>p.name).join(' + ')+` (points-so-far value ${o.m.toFixed(1)}, usage value ${o.t.toFixed(1)})`).join('\n')||'(none found)')+`\n\nCHEAPER LOOK-ALIKES:\n`+(D.alts.map(p=>'- '+pLine(p,rep)).join('\n')||'(none)');
  }
  const prompt=`${RULES}\n\nTASK: ${task}\n\n${list}\n\n${context(true)}`;
  ask(D.mine?`Deals for ${X.name}`:`How to get ${X.name}`,prompt,'default');
});
$('#ask-go').addEventListener('click',()=>{
  const q=$('#ask-q').value.trim(); if(!q){ $('#ask-q').focus(); return; }
  ask('Answer',`${RULES}\n\nQUESTION: ${q}\n\n${context(true)}`,'default');
});

// ---- views ----
function setView(v){
  document.querySelectorAll('#views button').forEach(b=>b.setAttribute('aria-selected',b.dataset.view===v?'true':'false'));
  $('#view-board').hidden=v!=='board'; $('#view-team').hidden=v!=='team'; $('#view-week').hidden=v!=='week';
  if(v==='week') renderWeek();
  try{localStorage.setItem('ll-view',v);}catch(e){}
  if(v==='board') renderScatter();
}
$('#views').addEventListener('click',e=>{const b=e.target.closest('button[data-view]'); if(b) setView(b.dataset.view);});

booted=true;
(function(){ let id=pendingLg;
  if(id===undefined){ try{ const s=localStorage.getItem('ll-league'); if(s!==null) id=s||null; }catch(e){} }
  if(id===undefined) id=LEAGUES.length?LEAGUES[0].id:null;
  selectLeague(id,true); })();
setPos(pos);
(function(){ let v=LEAGUES.length?'week':'board'; try{ const h=(location.hash||'').slice(1).toLowerCase(); if(['team','week','board'].includes(h)) v=h; else if(['qb','rb','wr','te'].includes(h)) v='board'; else { const s=localStorage.getItem('ll-view'); if(['team','week','board'].includes(s)) v=s; } }catch(e){} setView(v); })();
})();

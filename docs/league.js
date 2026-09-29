/* Fantasy Luck Lab: league engine that runs in the browser.
   Loads a visitor's Sleeper leagues and turns the daily core data (projections, market values)
   into league-specific values, team needs, trade offers, win chances, playoff odds, waivers and alerts.
   This mirrors pipeline/build.py (build_sleeper) and pipeline/extras.py. */
(function(){
const POS=['QB','RB','WR','TE'];
const CV={QB:0.38,RB:0.55,WR:0.6,TE:0.65};
const KDEF={K:[8.0,3.5],DEF:[7.0,5.0]};
const Z80=0.8416, PLAYOFF_WEIGHT=1.5, DISCOUNT=[0.75,0.55,0.4];
const INJ_NEXT={Out:0,IR:0,PUP:0,Sus:0,Doubtful:0.25,Questionable:0.85};
const AGE_CURVE={
  RB:a=>a<=23?[1.05,1.0,0.9]:a<=25?[1.0,0.92,0.8]:a<=27?[0.88,0.72,0.55]:[0.7,0.5,0.3],
  WR:a=>a<=23?[1.1,1.1,1.05]:a<=26?[1.03,1.0,0.95]:a<=29?[0.95,0.88,0.78]:[0.8,0.65,0.5],
  TE:a=>a<=24?[1.1,1.1,1.05]:a<=28?[1.0,0.97,0.9]:[0.88,0.75,0.6],
  QB:a=>a<=25?[1.05,1.05,1.03]:a<=31?[1.0,1.0,0.97]:a<=35?[0.92,0.82,0.7]:[0.75,0.55,0.35]};
const CLIFF={RB:27,WR:30,TE:31,QB:35};
const SLOT_OK={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],FLEX:['RB','WR','TE'],SUPER_FLEX:['QB','RB','WR','TE']};
const r1=(v,n=1)=>v==null||!isFinite(v)?null:Math.round(v*10**n)/10**n;

// ---- Sleeper API with a small concurrency limit
function limiter(n){ let a=0; const q=[]; const next=()=>{ if(a>=n||!q.length) return; a++; const [f,res,rej]=q.shift(); f().then(res,rej).finally(()=>{a--; next();}); }; return f=>new Promise((res,rej)=>{ q.push([f,res,rej]); next(); }); }
const lim=limiter(12);
const get=path=>lim(async()=>{ const r=await fetch('https://api.sleeper.app/v1'+path); if(!r.ok) throw new Error(path+' '+r.status); return r.json(); });
const tryget=(path,dflt)=>get(path).catch(()=>dflt);

// ---- scoring and projections
function score(c,sc){ return c.pass_yd*sc.pass_yd+c.pass_td*sc.pass_td+c.pass_int*sc.pass_int+c.rush_yd*sc.rush_yd+c.rush_td*sc.rush_td+c.rec*sc.rec+c.rec_yd*sc.rec_yd+c.rec_td*sc.rec_td+c.fum*sc.fum_lost; }
function projPts(p,w,sc){ const c=p.comp, rm=w[3], cm=w[4];
  const x={pass_yd:c.pass_yd*cm,pass_td:c.pass_td*cm,pass_int:c.pass_int*(2-cm),rush_yd:c.rush_yd*rm,rush_td:c.rush_td*rm,rec:c.rec*cm,rec_yd:c.rec_yd*cm,rec_td:c.rec_td*cm,fum:c.fum||0};
  let pts=score(x,sc); if(p.pos==='TE') pts+=x.rec*(sc.bonus_rec_te||0); return pts; }
function availFactors(inj,n){ const f=Array(n).fill(1); if(!n) return f;
  if(inj==='IR'||inj==='PUP'){ for(let i=0;i<n;i++) f[i]=i<4?0:0.6; }
  else if(inj==='Out'){ f[0]=0; if(n>1) f[1]=0.6; }
  else if(inj in INJ_NEXT) f[0]=INJ_NEXT[inj];
  return f; }
function lineupValue(ids,vals,slots){
  const pool=ids.filter(i=>vals[i]).map(i=>[vals[i][1],vals[i][0],i]).sort((a,b)=>b[0]-a[0]);
  const used=new Set(), start=[]; let total=0;
  const take=(ok,n)=>{ for(let k=0;k<n;k++){ for(const [v,pos,i] of pool){ if(!used.has(i)&&ok(pos)){ used.add(i); total+=v; start.push(i); break; } } } };
  POS.forEach(p=>take(q=>q===p,slots[p]||0)); take(q=>q!=='QB',slots.FLEX||0); take(()=>true,slots.SUPER_FLEX||0);
  const bench=pool.filter(x=>!used.has(x[2])).slice(0,4).reduce((s,x)=>s+x[0],0);
  return [total+0.12*bench,start]; }
const psd=(pos,pts)=>Math.max(2,(CV[pos]||0.6)*Math.max(pts,0));
const phi=x=>0.5*(1+erf(x/Math.SQRT2));
function erf(x){ const s=Math.sign(x); x=Math.abs(x); const t=1/(1+0.3275911*x); const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x); return s*y; }
function weekPoints(val,wk){ const out={}; for(const sid in val){ const v=val[sid]; const i=v.wk.indexOf(wk); if(i>=0) out[sid]=[v.pos,v.strip[i]]; } return out; }
function bestLineup(ids,pts,slots){
  const pool=ids.filter(i=>pts[i]).map(i=>[pts[i][1],pts[i][0],i]).sort((a,b)=>b[0]-a[0]);
  const used=new Set(); let mean=0, vr=0;
  const take=(ok,n)=>{ for(let k=0;k<n;k++){ for(const [v,pos,i] of pool){ if(!used.has(i)&&ok(pos)){ used.add(i); mean+=v; vr+=psd(pos,v)**2; break; } } } };
  POS.forEach(p=>take(q=>q===p,slots[p]||0)); take(q=>q!=='QB',slots.FLEX||0); take(()=>true,slots.SUPER_FLEX||0);
  for(const k in KDEF){ mean+=(slots[k]||0)*KDEF[k][0]; vr+=(slots[k]||0)*KDEF[k][1]**2; }
  return [mean,vr]; }
function teamWeeks(teams,cache,slots,override){
  const tw={};
  for(const t of teams){ let ids;
    if(override&&override[t.rid]) ids=override[t.rid]; else if(override) continue; else ids=t.players.filter(i=>!t.ir.includes(i)&&!t.taxi.includes(i));
    tw[t.rid]={}; for(const w in cache) tw[t.rid][w]=bestLineup(ids,cache[w],slots); }
  return tw; }
function rng(seed){ let s=seed>>>0; return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return (s+0.5)/4294967296; }; }
function simulate(teams,schedule,tw,nPO,curWeek,live,N=2500,seed=7){
  const R=rng(seed), gauss=()=>Math.sqrt(-2*Math.log(R()))*Math.cos(2*Math.PI*R());
  const rids=teams.map(t=>t.rid), made={}, winsSum={}, rankSum={}; rids.forEach(r=>{made[r]=0;winsSum[r]=0;rankSum[r]=0;});
  const weeks=Object.keys(schedule).map(Number).sort((a,b)=>a-b);
  for(let k=0;k<N;k++){ const W={},PF={}; teams.forEach(t=>{ W[t.rid]=t.w+0.5*(t.t||0); PF[t.rid]=t.pf; });
    for(const w of weeks){ const sc={};
      for(const r of rids){ let m,v; if(live&&w===curWeek&&live[r]) [m,v]=live[r]; else [m,v]=(tw[r]&&tw[r][w])||[0,1]; sc[r]=m+Math.sqrt(v)*gauss(); PF[r]+=sc[r]; }
      for(const [a,b] of schedule[w]){ if(sc[a]>sc[b]) W[a]++; else W[b]++; } }
    const order=rids.slice().sort((a,b)=>(W[b]*1e4+PF[b])-(W[a]*1e4+PF[a]));
    order.forEach((r,i)=>{ rankSum[r]+=i+1; if(i<nPO) made[r]++; winsSum[r]+=W[r]; }); }
  const o={}; rids.forEach(r=>o[r]={odds:made[r]/N,wins:winsSum[r]/N,rank:rankSum[r]/N}); return o; }
function thisWeek(teams,val,lineup,week,matchups,played,PL){
  if(!matchups||!matchups.length) return [null,{}];
  const pts=weekPoints(val,week); const byR={}; matchups.forEach(m=>byR[m.roster_id]=m);
  const res={}, live={};
  for(const t of teams){ const m=byR[t.rid]; if(!m) continue; let mean=0,vr=0; const rows=[];
    (m.starters||[]).forEach((sid,i)=>{ const slot=lineup[i]; if(!slot) return;
      if(!sid||sid==='0'){ rows.push([slot,null,0,0,0,'empty']); return; }
      const P=PL[sid]||[]; const team=P[2], pos=P[1]||(/^[A-Z]+$/.test(sid)?'DEF':null);
      const actual=(m.players_points||{})[sid];
      if(team&&played.has(team)){ mean+=actual||0; rows.push([slot,sid,r1(actual||0),r1(actual||0),r1(actual||0),'final']); return; }
      if(KDEF[pos]){ const [mu,sd]=KDEF[pos]; mean+=mu; vr+=sd*sd; rows.push([slot,sid,mu,Math.max(0,mu-Z80*sd),mu+Z80*sd,'avg']); return; }
      const p=pts[sid]?pts[sid][1]:0, sd=psd(pos,p); mean+=p; vr+=sd*sd;
      rows.push([slot,sid,r1(p),r1(Math.max(0,p-Z80*sd)),r1(p+Z80*sd),pts[sid]?'proj':'none']); });
    res[t.rid]={mid:m.matchup_id,mean:r1(mean),sd:r1(Math.sqrt(vr)),rows}; live[t.rid]=[mean,vr]; }
  for(const r in res){ const x=res[r]; const opp=Object.keys(res).find(o=>o!==r&&x.mid!=null&&res[o].mid===x.mid);
    x.opp=opp!=null?+opp:null; if(opp!=null){ const d=x.mean-res[opp].mean, s=Math.sqrt(x.sd**2+res[opp].sd**2)||1; x.win=r1(phi(d/s),3); } }
  return [res,live]; }
function rankMap(scores,scale){ const order=Object.keys(scores).sort((a,b)=>scores[b]-scores[a]); const ref=scale.slice().sort((a,b)=>b-a); const o={}; order.forEach((k,i)=>o[k]=ref[Math.min(i,ref.length-1)]); return ref.length?o:{}; }
function adjPv(v,mode){ const p=v.pv, age=v.age||26; if(p<=0||!mode) return p;
  if(mode==='Rebuilding') return p*(age>=28?0.75:age<=24?1.15:1); if(mode==='Contender') return p*(age>=27?1.1:age<=23?0.9:1); return p; }
function nearest(x,arr){ return arr.reduce((b,v)=>Math.abs(v-x)<Math.abs(b-x)?v:b,arr[0]); }

// ---- trade offers from my team (same rules as the Python builder)
function findOffers(teams,val,picks,slots,dyn,labels){
  const me=teams.find(t=>t.me); if(!me) return [];
  const ros={}; for(const s in val) ros[s]=[val[s].pos,val[s].ros];
  const tv=s=>val[s].tv, tvA=ids=>ids.reduce((a,s)=>a+tv(s),0);
  const teamValue=ids=>lineupValue(ids,ros,slots)[0];
  const mkt=ids=>{ const a=ids.map(x=>val[x].mkt!=null?val[x].mkt:val[x].tv).sort((x,y)=>y-x); return a.length?a[0]+a.slice(1).reduce((s,x)=>s+Math.max(0,x),0):0; };
  const myIds=me.players.filter(p=>val[p]), myBase=teamValue(myIds);
  const myTrad=myIds.slice().sort((a,b)=>tv(b)-tv(a)).slice(0,18);
  const myPicks=Object.keys(picks).filter(k=>picks[k].holder===me.rid);
  const out=[];
  for(const t of teams){ if(t.me) continue;
    const th=t.players.filter(p=>val[p]); const tBase=teamValue(th);
    const mode=((labels||{})[t.rid]||{}).mode; const tpv={}; th.concat(myIds).forEach(s=>tpv[s]=adjPv(val[s],mode));
    const their=th.slice().sort((a,b)=>tv(b)-tv(a)).slice(0,16);
    const gives=myTrad.map(a=>[a]); const t14=myTrad.slice(0,14); for(let i=0;i<t14.length;i++) for(let j=i+1;j<t14.length;j++) gives.push([t14[i],t14[j]]);
    let cands=[];
    for(const gl of gives){ for(const rcv of their){
      if(gl.length===1&&val[gl[0]].pos===val[rcv].pos&&Math.abs(tv(gl[0])-tv(rcv))<1) continue;
      const myGain=teamValue(myIds.filter(x=>!gl.includes(x)).concat([rcv]))-myBase;
      const theirGain=teamValue(th.filter(x=>x!==rcv).concat(gl))-tBase;
      let myTv=tv(rcv)-tvA(gl), pvThem=gl.reduce((a,s)=>a+tpv[s],0)-tpv[rcv], pick=null;
      if(dyn&&pvThem<0&&myPicks.length){ const need=-pvThem; const ok=myPicks.filter(k=>picks[k].pv>=need).sort((a,b)=>picks[a].tv-picks[b].tv); if(ok.length){ pick=ok[0]; pvThem+=picks[pick].pv; myTv-=picks[pick].tv; } }
      if(gl.length===2&&(Math.min(...gl.map(x=>tpv[x]))<=0||pick)) continue;
      if(mkt([rcv])<0.85*mkt(gl)) continue;
      const good=dyn?(myTv>5&&myGain>-3):(myGain>4&&myTv>-10), acc=pvThem>=-3&&theirGain>-6;
      if(good&&acc){ const s=myGain+(dyn?0.5:0.2)*myTv+0.3*Math.max(0,theirGain)-0.5*Math.max(0,-pvThem);
        cands.push({to:t.rid,give:gl.concat(pick?[pick]:[]),get:[rcv],myGain:r1(myGain),theirGain:r1(theirGain),myValue:r1(myTv),theirSeen:r1(pvThem),score:r1(s,2)}); } } }
    const singles=new Set(cands.filter(c=>c.give.filter(x=>!x.startsWith('pick')).length===1).map(c=>c.get[0]));
    cands=cands.filter(c=>c.give.filter(x=>!x.startsWith('pick')).length===1||!singles.has(c.get[0])).sort((a,b)=>b.score-a.score);
    const seen=new Set(); let n=0; for(const c of cands){ if(seen.has(c.get[0])) continue; seen.add(c.get[0]); out.push(c); if(++n>=3) break; } }
  return out.sort((a,b)=>b.score-a.score).slice(0,24); }

function waiverAdvice(teams,val,slots,rostered,me,dyn,budget,wtype,needs){
  const myIds=me.players.filter(p=>val[p]&&!me.ir.includes(p)&&!me.taxi.includes(p));
  const ros={}; for(const s in val) ros[s]=[val[s].pos,val[s].ros];
  const [base,start]=lineupValue(myIds,ros,slots);
  const bench=myIds.filter(p=>!start.includes(p)); const drop=bench.length?bench.reduce((a,b)=>val[a].tv<=val[b].tv?a:b):null;
  const fa=Object.keys(val).filter(s=>!(s in rostered)&&val[s].ros>0).sort((a,b)=>val[b].tv-val[a].tv).slice(0,40);
  const games=me.w+me.l+(me.t||0), wpct=games?me.w/games:0.5, mood=wpct<0.4?1.35:wpct>0.6?0.75:1.0;
  const remaining=Math.max(0,(budget||0)-(me.faab_used||0)); const out=[];
  for(const sid of fa){ const gain=lineupValue(myIds.filter(x=>x!==drop).concat([sid]),ros,slots)[0]-base;
    const dv=val[sid].tv-Math.max(0,drop?val[drop].tv:0);
    if(gain<3&&!(dyn&&dv>=40)) continue;
    const item={add:sid,drop,gain:r1(gain),value:r1(dv)};
    if(wtype===2&&budget){ let pct=Math.min(45,Math.max(1,(gain+(dyn?0.15*dv:0))/4))*mood; const pos=val[sid].pos;
      const rivals=teams.filter(t=>!t.me&&(needs[t.rid]||{})[pos]<=-0.5&&(budget-(t.faab_used||0))>=budget*pct/100);
      pct*=1+Math.min(0.4,0.1*rivals.length); item.bid=Math.round(Math.min(remaining,Math.max(1,budget*pct/100))); item.rivals=rivals.length; }
    out.push(item); }
  out.sort((a,b)=>(b.gain+(dyn?0.3*b.value:0))-(a.gain+(dyn?0.3*a.value:0)));
  return {remaining:wtype===2?remaining:null,mood:mood>1?'aggressive':mood<1?'conservative':'balanced',type:wtype,position:me.waiver_position,adds:out.slice(0,8),drop}; }

async function profiles(leagueId,teams,PL,curWeek,seasonsBack=1){
  const prof={}; teams.forEach(t=>{ if(t.owner_id) prof[t.owner_id]={trades:0,trades_now:0,adds:0,bought:{}}; });
  let lid=leagueId, depth=0;
  while(lid&&depth<=seasonsBack){
    let lg,R; try{ [lg,R]=await Promise.all([get('/league/'+lid),get('/league/'+lid+'/rosters')]); }catch(e){ break; }
    const owner={}; R.forEach(r=>owner[r.roster_id]=r.owner_id);
    const last=depth===0?curWeek:18; const wks=[]; for(let w=1;w<=last;w++) wks.push(w);
    const txs=await Promise.all(wks.map(w=>tryget(`/league/${lid}/transactions/${w}`,[])));
    for(const tx of txs) for(const x of tx){ if(x.status!=='complete') continue;
      if(x.type==='trade'){ for(const r of x.roster_ids||[]){ const u=owner[r]; if(!prof[u]) continue; prof[u].trades++; if(depth===0) prof[u].trades_now++; }
        for(const [sid,r] of Object.entries(x.adds||{})){ const u=owner[r], pos=(PL[sid]||[])[1]; if(prof[u]&&pos) prof[u].bought[pos]=(prof[u].bought[pos]||0)+1; } }
      else if((x.type==='waiver'||x.type==='free_agent')&&depth===0){ for(const r of Object.values(x.adds||{})){ const u=owner[r]; if(prof[u]) prof[u].adds++; } } }
    lid=lg.previous_league_id; depth++; }
  for(const u in prof){ const p=prof[u], tags=[];
    if(p.trades>=4) tags.push('Active trader'); else if(p.trades===0) tags.push('Rarely trades');
    const bk=Object.keys(p.bought); if(bk.length){ const top=bk.reduce((a,b)=>p.bought[a]>=p.bought[b]?a:b); if(p.bought[top]>=2) tags.push(`Buys ${top}s`); }
    if(p.adds>=6) tags.push('Waiver hawk'); else if(p.adds===0&&curWeek>=3) tags.push('Inactive on waivers');
    p.tags=tags; }
  return prof; }

function leagueAlerts(me,wk,val,PL,siteTeams,wv,brk,rostered){
  const out=[]; if(!me) return out; const nm=s=>(PL[s]||[])[0]||s;
  const rows=((wk||{})[me.rid]||{}).rows||[];
  const bench=me.players.filter(s=>!me.starters.includes(s)&&!me.ir.includes(s)&&!me.taxi.includes(s)&&val[s]&&val[s].next!=null);
  const used=new Set();
  for(const [slot,sid,p,f,c,kind] of rows){
    if(kind==='empty'){ out.push({lvl:'high',text:`Empty ${slot} slot in your lineup.`}); continue; }
    if(kind==='final'||!sid) continue;
    const P=PL[sid]||[], inj=P[4], team=P[2];
    if(['Out','IR','Doubtful','Sus','PUP'].includes(inj)) out.push({lvl:'high',text:`${nm(sid)} is ${inj} but starting at ${slot}.`});
    else if(team&&(siteTeams[team]||{}).bye) out.push({lvl:'high',text:`${nm(sid)} is on bye but starting at ${slot}.`});
    if(SLOT_OK[slot]&&kind==='proj'){ const c2=bench.filter(b=>!used.has(b)&&SLOT_OK[slot].includes(val[b].pos)&&(val[b].next||0)>=(p||0)+3);
      if(c2.length){ const b=c2.reduce((x,y)=>val[x].next>=val[y].next?x:y); used.add(b); out.push({lvl:'med',text:`Start ${nm(b)} (${val[b].next.toFixed(1)}) over ${nm(sid)} (${(p||0).toFixed(1)}) at ${slot}.`}); } } }
  if(wv&&wv.adds&&wv.adds.length){ const a=wv.adds[0]; if(a.gain>=25||(a.value>=80&&a.gain>=5)) out.push({lvl:'med',text:`Waiver target: ${nm(a.add)}, worth about ${Math.round(a.gain)} rest-of-season points to your lineup${a.drop?' over '+nm(a.drop):''}.${a.bid!=null?` Suggested bid $${a.bid}.`:''}`}); }
  let shown=0; for(const b of brk){ if(shown>=2) break; const s=(b.sids||[])[0]; if(s&&!(s in rostered)&&val[s]&&val[s].ros>80){ shown++; out.push({lvl:'low',text:`Available breakout: ${nm(s)}. ${b.text[0].toUpperCase()+b.text.slice(1)}.`}); } }
  return out.slice(0,8); }

// ---- one league
async function buildLeague(l,ctx){
  const {me,PL,proj,nw,played,siteBy,siteTeams,core}=ctx;
  const lid=l.league_id, st=l.settings||{}, sc=l.scoring_settings||{}, rp=l.roster_positions||[];
  const dyn=st.type===2, n=l.total_rosters, po=st.playoff_week_start||15;
  const slots={}; ['QB','RB','WR','TE','FLEX','SUPER_FLEX','K','DEF','BN'].forEach(k=>slots[k]=rp.filter(x=>x===k).length);
  const scoring={}; ['rec','pass_td','pass_int','pass_yd','rush_yd','rush_td','rec_yd','rec_td','fum_lost','bonus_rec_te'].forEach(k=>scoring[k]=sc[k]||0);
  const regEnd=po-1, weeks=[]; if(nw&&nw<=regEnd) for(let w=nw;w<=regEnd;w++) weeks.push(w);
  const [R,Us,traded,drafts,...mus]=await Promise.all([get(`/league/${lid}/rosters`),get(`/league/${lid}/users`),tryget(`/league/${lid}/traded_picks`,[]),dyn?Promise.resolve([]):tryget(`/league/${lid}/drafts`,[]),...weeks.map(w=>tryget(`/league/${lid}/matchups/${w}`,[]))]);
  const U={}; Us.forEach(u=>U[u.user_id]=u);
  const rostered={}, teams=[];
  R.slice().sort((a,b)=>a.roster_id-b.roster_id).forEach(r=>{ const u=U[r.owner_id]||{}, s=r.settings||{};
    const t={rid:r.roster_id,name:(u.metadata||{}).team_name||u.display_name||`Team ${r.roster_id}`,owner:u.display_name||'',me:r.owner_id===me||(r.co_owners||[]).includes(me),
      w:s.wins||0,l:s.losses||0,t:s.ties||0,pf:r1((s.fpts||0)+(s.fpts_decimal||0)/100,2),starters:r.starters||[],players:r.players||[],ir:r.reserve||[],taxi:r.taxi||[],
      owner_id:r.owner_id,faab_used:s.waiver_budget_used||0,waiver_position:s.waiver_position};
    teams.push(t); t.players.forEach(p=>rostered[p]=t.rid); });
  // per-player values
  const val={};
  for(const sid in PL){ const P=PL[sid], pos=P[1]; if(!POS.includes(pos)) continue; const g=P[3]; if(!g||!proj[g]||!P[2]) continue;
    const p=proj[g], wk=p.weeks, af=availFactors(P[4],wk.length); let nxt=null, ros=0, rw=0; const strip=[];
    wk.forEach((w,i)=>{ const pts=projPts(p,w,scoring)*af[i]; let wt=(w[0]>=po&&w[0]<=po+2)?PLAYOFF_WEIGHT:1; if(w[0]>=po+3) wt=0; ros+=pts*wt; rw+=wt; if(w[0]===nw) nxt=pts; strip.push(r1(pts)); });
    const sp=siteBy[g], repu=p.rep||p.base;
    const seen=sp&&sp.g>=1?(sp.g/(sp.g+3))*sp.ppr+(1-sp.g/(sp.g+3))*repu:repu;
    val[sid]={g,pos,age:P[5],inj:P[4],next:nxt,ros,rw,strip,wk:wk.map(w=>w[0]),seen}; }
  const share={QB:slots.QB+0.9*slots.SUPER_FLEX,RB:slots.RB+0.45*slots.FLEX,WR:slots.WR+0.45*slots.FLEX,TE:slots.TE+0.1*slots.FLEX};
  const repl={}, seenR={};
  POS.forEach(pos=>{ const k=Math.round(n*share[pos]);
    const a=Object.values(val).filter(v=>v.pos===pos).map(v=>v.ros/Math.max(v.rw,1)).sort((x,y)=>y-x); repl[pos]=a.length?a[Math.min(k,a.length-1)]:0;
    const b=Object.values(val).filter(v=>v.pos===pos).map(v=>v.seen).sort((x,y)=>y-x); seenR[pos]=b.length?b[Math.min(k,b.length-1)]:0; });
  for(const sid in val){ const v=val[sid], per=v.ros/Math.max(v.rw,1);
    v.vorp=(per-repl[v.pos])*v.rw; v.seenv=(v.seen-seenR[v.pos])*v.rw;
    if(dyn){ const curve=AGE_CURVE[v.pos](v.age||26);
      v.dyn=v.vorp+curve.reduce((s,c,i)=>s+Math.max(0,per-repl[v.pos])*17*c*DISCOUNT[i],0);
      v.seendyn=v.seenv+curve.reduce((s,c,i)=>s+Math.max(0,v.seen-seenR[v.pos])*17*c*DISCOUNT[i],0); }
    v.tv=dyn?v.dyn:v.vorp; v.pv=dyn?v.seendyn:v.seenv; }
  // market anchor
  const fcKey=`${dyn?1:0}-${slots.SUPER_FLEX?2:1}-${nearest(n,[10,12,14])}-${nearest(sc.rec||0,[0,0.5,1])}`; const fc=core.fc[fcKey]||{};
  let dc={}; const dd=(drafts||[]).filter(d=>d.status==='complete');
  if(dd.length){ const picks=await tryget(`/draft/${dd[0].draft_id}/picks`,[]); picks.forEach(p=>{ if(p.player_id) dc[p.player_id]=p.pick_no; }); }
  const scale=Object.values(val).map(v=>v.tv);
  const fcS={}, dcS={}; for(const sid in val){ if(fc[sid]) fcS[sid]=fc[sid][0]; if(dc[sid]) dcS[sid]=-dc[sid]; }
  const mFc=rankMap(fcS,scale), mDc=rankMap(dcS,scale), weeksDone=Math.max(0,(nw||1)-1);
  for(const sid in val){ const v=val[sid], a=mFc[sid], b=mDc[sid]; const wd=b!=null?Math.max(0,0.35-0.03*weeksDone):0;
    const mk=a!=null&&b!=null?a*(1-wd)+b*wd:a!=null?a:null; v.mkt=mk; v.fcr=fc[sid]?fc[sid][1]:null; v.pick=dc[sid]||null;
    if(mk!=null){ v.tv=0.7*v.tv+0.3*mk; v.pv=0.65*mk+0.35*v.pv; } }
  // dynasty picks
  const picks={};
  if(dyn){ const seasons=[String(core.season+1),String(core.season+2)], rounds=st.draft_rounds||4, own={};
    seasons.forEach(s=>{ for(let rd=1;rd<=rounds;rd++) teams.forEach(t=>own[`${s}|${rd}|${t.rid}`]=t.rid); });
    (traded||[]).forEach(tp=>{ const k=`${tp.season}|${tp.round}|${tp.roster_id}`; if(k in own) own[k]=tp.owner_id; });
    const ranked=Object.values(val).map(v=>v.tv).sort((a,b)=>b-a), anchor={1:36,2:72,3:110,4:150,5:190};
    for(const k in own){ const [s,rd,orig]=k.split('|'); const bv=ranked.length?ranked[Math.min(Math.floor((anchor[rd]||200)*n/12),ranked.length-1)]:0;
      const v=Math.max(bv,1)*(s===seasons[1]?0.85:1); picks[`pick:${s}:${rd}:${orig}`]={season:s,round:+rd,orig:+orig,holder:own[k],tv:r1(v),pv:r1(v*1.1)}; } }
  // needs
  const lv={}; for(const s in val) lv[s]=[val[s].pos,val[s].ros];
  const ps={}; teams.forEach(t=>{ const ids=t.players.filter(p=>val[p]); const start=lineupValue(ids,lv,slots)[1]; ps[t.rid]={};
    POS.forEach(pos=>{ const pg=s=>val[s].ros/Math.max(val[s].rw,1);
      const st_=start.filter(s=>val[s].pos===pos).map(pg), dp=ids.filter(s=>val[s].pos===pos&&!start.includes(s)).map(pg).sort((a,b)=>b-a).slice(0,2);
      ps[t.rid][pos]={start:st_.reduce((a,b)=>a+b,0),depth:dp.reduce((a,b)=>a+b,0)}; }); });
  const needs={}; teams.forEach(t=>needs[t.rid]={});
  POS.forEach(pos=>{ const arr=teams.map(t=>ps[t.rid][pos].start+0.35*ps[t.rid][pos].depth); const mu=arr.reduce((a,b)=>a+b,0)/arr.length; const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-mu)**2,0)/arr.length)||1;
    teams.forEach((t,i)=>needs[t.rid][pos]=r1((arr[i]-mu)/sd,2)); });
  teams.forEach(t=>{ t.needs=needs[t.rid]; t.strength={}; POS.forEach(pos=>t.strength[pos]=r1(ps[t.rid][pos].start)); });
  // this week, season sim, playoff odds
  const schedule={}; let curM=[];
  weeks.forEach((w,i)=>{ const mu=mus[i]||[]; if(w===nw) curM=mu; const pr={}; mu.forEach(m=>{ if(m.matchup_id!=null) (pr[m.matchup_id]=pr[m.matchup_id]||[]).push(m.roster_id); });
    const pairs=Object.values(pr).filter(v=>v.length===2); if(pairs.length) schedule[w]=pairs; });
  const cache={}; for(const w in schedule) cache[w]=weekPoints(val,+w);
  const tw=teamWeeks(teams,cache,slots);
  const lineupSlots=rp.filter(x=>x!=='BN'&&x!=='IR');
  const [wkRes,live]=thisWeek(teams,val,lineupSlots,nw,curM,played,PL);
  const nPO=st.playoff_teams||6;
  const odds=Object.keys(schedule).length?simulate(teams,schedule,tw,nPO,nw,live):{};
  teams.forEach(t=>{ if(odds[t.rid]){ t.odds=r1(odds[t.rid].odds,3); t.projW=r1(odds[t.rid].wins); t.projRank=r1(odds[t.rid].rank); } if(wkRes&&wkRes[t.rid]) t.week=wkRes[t.rid]; });
  const labels={};
  if(dyn){ teams.forEach(t=>{ const o=(odds[t.rid]||{odds:0.5}).odds; const ages=t.players.filter(s=>val[s]&&val[s].age).map(s=>[val[s].tv,val[s].age]).sort((a,b)=>b[0]-a[0]).slice(0,8);
      labels[t.rid]={mode:o>=0.5?'Contender':o<=0.2?'Rebuilding':'Middle',age:r1(ages.length?ages.reduce((a,b)=>a+b[1],0)/ages.length:26)}; t.mode=labels[t.rid]; });
    if(Object.keys(odds).length){ const order=teams.slice().sort((a,b)=>odds[b.rid].rank-odds[a.rid].rank); const slotOf={}; order.forEach((t,i)=>slotOf[t.rid]=i);
      for(const k in picks){ const pk=picks[k]; if(pk.season===String(core.season+1)&&pk.orig in slotOf){ const f=1.3-0.6*slotOf[pk.orig]/Math.max(1,n-1); pk.tv=r1(pk.tv*f); pk.pv=r1(pk.pv*f); pk.slot=slotOf[pk.orig]+1; } } } }
  let prof={}; try{ prof=await profiles(lid,teams,PL,nw||1); }catch(e){}
  teams.forEach(t=>{ const p=prof[t.owner_id]; if(p) t.prof={trades:p.trades,tradesNow:p.trades_now,adds:p.adds,tags:p.tags,bought:p.bought}; });
  // offers
  const offers=findOffers(teams,val,picks,slots,dyn,labels);
  offers.forEach(o=>{ const tags=((teams.find(t=>t.rid===o.to)||{}).prof||{}).tags||[]; if(tags.includes('Active trader')) o.score*=1.15; if(tags.includes('Rarely trades')) o.score*=0.8; });
  offers.sort((a,b)=>b.score-a.score);
  const meT=teams.find(t=>t.me);
  if(Object.keys(schedule).length&&meT){ for(const o of offers.slice(0,12)){ const tt=teams.find(t=>t.rid===o.to); const g_=o.give.filter(x=>!x.startsWith('pick:'));
      const mine=meT.players.filter(x=>!g_.includes(x)&&!meT.ir.includes(x)&&!meT.taxi.includes(x)).concat(o.get);
      const theirs=tt.players.filter(x=>!o.get.includes(x)&&!tt.ir.includes(x)&&!tt.taxi.includes(x)).concat(g_);
      const tw2=Object.assign({},tw,teamWeeks(teams,cache,slots,{[meT.rid]:mine,[tt.rid]:theirs}));
      const o2=simulate(teams,schedule,tw2,nPO,nw,live,1500);
      o.po=[r1(odds[meT.rid].odds,3),r1(o2[meT.rid].odds,3),r1(odds[tt.rid].odds,3),r1(o2[tt.rid].odds,3)]; } }
  const wv=meT?waiverAdvice(teams,val,slots,rostered,meT,dyn,st.waiver_budget,st.waiver_type,needs):null;
  const cliffs=dyn&&meT?meT.players.filter(s=>val[s]&&val[s].age&&val[s].age>=CLIFF[val[s].pos]&&val[s].tv>20).map(s=>({sid:s,age:val[s].age,pos:val[s].pos})):[];
  const alerts=leagueAlerts(meT,wkRes,val,PL,siteTeams,wv,core.brk,rostered);
  const vout={}; for(const s in val){ const v=val[s]; if(s in rostered||v.tv>-40) vout[s]=[r1(v.next),r1(v.ros),r1(v.tv),r1(v.pv),r1(v.mkt),v.fcr,v.pick]; }
  return {league:{id:lid,name:l.name,type:dyn?'dynasty':'redraft',size:n,lineup:lineupSlots,slots,ir:st.reserve_slots||0,taxi:st.taxi_slots||0,
    scoring:{rec:sc.rec||0,pass_td:sc.pass_td??4,pass_int:sc.pass_int??-1,te_bonus:sc.bonus_rec_te||0,pass_yd:sc.pass_yd??0.04,fum_lost:sc.fum_lost??-2},
    faab:st.waiver_budget,playoffStart:po,playoffTeams:st.playoff_teams,teams,vals:vout,picks,offers,waivers:wv,cliffs,alerts,waiverType:st.waiver_type,
    sim:{weeks:Object.keys(schedule).map(Number).sort((a,b)=>a-b),schedule,tw:Object.fromEntries(Object.entries(tw).map(([r,x])=>[r,Object.fromEntries(Object.entries(x).map(([w,[a,b]])=>[w,[r1(a),r1(b)]]))])),live:Object.fromEntries(Object.entries(live||{}).map(([r,[a,b]])=>[r,[r1(a),r1(b)]])),playoffTeams:nPO}},
    ids:Object.keys(rostered).concat(Object.keys(val))}; }

// ---- public entry point
window.buildSleeper=async function(username,core,progress){
  const user=await get('/user/'+encodeURIComponent(username.trim())).catch(()=>null);
  if(!user||!user.user_id) throw new Error(`Couldn't find a Sleeper user named "${username}". Check the spelling of your Sleeper username (not your display name).`);
  const leagues=(await get(`/user/${user.user_id}/leagues/nfl/${core.season}`))||[];
  if(!leagues.length) throw new Error(`${username} isn't in any ${core.season} NFL leagues on Sleeper.`);
  const PL=core.pl, proj=core.mx.proj, nw=core.cov.nextWeek, siteTeams=core.site.teams;
  const played=new Set(Object.entries(siteTeams).filter(([t,x])=>!x.bye&&x.next&&nw&&x.next.w>nw).map(([t])=>t));
  const siteBy={}; core.site.players.forEach(p=>siteBy[p.id]=p);
  const siteIds=new Set(Object.keys(siteBy));
  const ctx={me:user.user_id,PL,proj,nw,played,siteBy,siteTeams,core};
  let done=0; progress&&progress(`Loading ${leagues.length} league${leagues.length>1?'s':''}…`);
  const built=await Promise.all(leagues.map(l=>buildLeague(l,ctx).then(r=>{ done++; progress&&progress(`Loaded ${done} of ${leagues.length} leagues…`); return r; }).catch(e=>{ console.error(l.name,e); return null; })));
  const ok=built.filter(Boolean);
  const players={}; const ids=new Set(ok.flatMap(b=>b.ids)); (core.brk||[]).forEach(b=>(b.sids||[]).forEach(s=>ids.add(s)));
  ids.forEach(sid=>{ const P=PL[sid]; if(P) players[sid]={n:P[0],pos:P[1],tm:P[2]||'FA',sid:P[3]&&siteIds.has(P[3])?P[3]:null,mid:P[3]&&proj[P[3]]?P[3]:null,inj:P[4],age:P[5],yrs:P[6]};
    else if(/^[A-Z]+$/.test(sid)) players[sid]={n:`${sid} defense`,pos:'DEF',tm:sid,sid:null,mid:null};
    else players[sid]={n:'Player '+sid,pos:null,tm:'FA',sid:null,mid:null}; });
  return {user:username.trim(),pulled:new Date().toISOString().slice(0,10),week:nw,breakouts:core.brk,valueKey:['next','ros','tv','pv','mkt','marketRank','draftPick'],leagues:ok.map(b=>b.league),players};
};
})();

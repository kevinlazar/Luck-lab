"""League extras for Fantasy Luck Lab: weekly win chance, season simulation and playoff odds,
waiver/FAAB advice, manager profiles, breakouts, dynasty labels, live accuracy log and alerts.
Imported by build.py (kept in the same folder)."""
import math, datetime
import numpy as np

POS = ['QB', 'RB', 'WR', 'TE']
CV = {'QB': 0.38, 'RB': 0.55, 'WR': 0.6, 'TE': 0.65}   # week-to-week spread relative to projection
KDEF = {'K': (8.0, 3.5), 'DEF': (7.0, 5.0)}          # average kicker / defense week (mean, sd)
Z80 = 0.8416
N_SIMS = 4000

def psd(pos, pts):
    return max(2.0, CV.get(pos, 0.6) * max(pts, 0.0))

def floor_ceiling(pos, pts):
    sd = psd(pos, pts)
    return max(0.0, pts - Z80 * sd), pts + Z80 * sd

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def week_points(val, wk):
    """sid -> (pos, points in week wk)"""
    out = {}
    for sid, v in val.items():
        if wk in v['wk']:
            out[sid] = (v['pos'], v['strip'][v['wk'].index(wk)])
    return out

def best_lineup(ids, pts, slots):
    """Optimal starters for one week. Returns (mean, var, starters)."""
    pool = sorted([(pts[i][1], pts[i][0], i) for i in ids if i in pts], reverse=True)
    used = set(); start = []
    def take(ok, n):
        for _ in range(n):
            for v, pos, i in pool:
                if i not in used and ok(pos):
                    used.add(i); start.append((i, pos, v)); break
    for pos in POS: take(lambda p, pos=pos: p == pos, slots.get(pos, 0))
    take(lambda p: p in ('RB', 'WR', 'TE'), slots.get('FLEX', 0))
    take(lambda p: p in POS, slots.get('SUPER_FLEX', 0))
    mean = sum(v for _, _, v in start); var = sum(psd(p, v) ** 2 for _, p, v in start)
    for k, (m, sd) in KDEF.items():
        mean += slots.get(k, 0) * m; var += slots.get(k, 0) * sd * sd
    return mean, var, [i for i, _, _ in start]

def team_weeks(teams, cache, slots, override=None):
    """Weekly (mean, var) per team. cache: {week: week_points}. override: rid -> player ids to use instead."""
    tw = {}
    for t in teams:
        if override and t['rid'] in override: ids = override[t['rid']]
        elif override: continue
        else: ids = [i for i in t['players'] if i not in t.get('ir', []) and i not in t.get('taxi', [])]
        tw[t['rid']] = {w: best_lineup(ids, pts, slots)[:2] for w, pts in cache.items()}
    return tw

def simulate(teams, schedule, tw, playoff_teams, cur_week, live=None, n=N_SIMS, seed=7):
    """Monte Carlo of the rest of the regular season. schedule: {week: [(rid_a, rid_b), ...]}
    live: {rid: (mean, var)} override for the current week. Returns rid -> dict(odds, wins, seed_avg)."""
    rng = np.random.default_rng(seed)
    rids = [t['rid'] for t in teams]; idx = {r: i for i, r in enumerate(rids)}
    wins = np.tile(np.array([t['w'] + 0.5 * t.get('t', 0) for t in teams], float), (n, 1))
    pf = np.tile(np.array([t['pf'] for t in teams], float), (n, 1))
    for w in sorted(schedule):
        mu = np.array([tw[r][w][0] if w in tw[r] else 0 for r in rids]); var = np.array([tw[r][w][1] if w in tw[r] else 1 for r in rids])
        if live and w == cur_week:
            for r, (m, v) in live.items(): mu[idx[r]] = m; var[idx[r]] = v
        sc = rng.normal(mu, np.sqrt(var), size=(n, len(rids)))
        pf += sc
        for a, b in schedule[w]:
            ia, ib = idx[a], idx[b]
            aw = sc[:, ia] > sc[:, ib]
            wins[:, ia] += aw; wins[:, ib] += ~aw
    key = wins * 10000 + pf
    rank = (-key).argsort(axis=1).argsort(axis=1)  # 0 = best
    made = rank < playoff_teams
    out = {}
    for r in rids:
        i = idx[r]
        out[r] = {'odds': float(made[:, i].mean()), 'wins': float(wins[:, i].mean()), 'rank': float(rank[:, i].mean() + 1)}
    return out

def this_week(teams, val, slots, lineup, week, matchups, played_teams, SP):
    """Win chance for every matchup this week, using each team's Sleeper lineup and live points for games played."""
    if not matchups: return None, {}
    pts = week_points(val, week)
    by_rid = {m['roster_id']: m for m in matchups}
    res = {}; live = {}
    for t in teams:
        m = by_rid.get(t['rid'])
        if not m: continue
        mean = var = 0.0; rows = []
        for slot, sid in zip(lineup, m.get('starters') or []):
            sp = SP.get(sid, {}) if sid and sid != '0' else {}
            team = sp.get('team'); pos = sp.get('position') or ('DEF' if sid and sid.isalpha() else None)
            actual = (m.get('players_points') or {}).get(sid)
            if sid in (None, '0'):
                rows.append([slot, None, 0, 0, 0, 'empty']); continue
            if team in played_teams:
                mean += actual or 0; rows.append([slot, sid, round(actual or 0, 1), round(actual or 0, 1), round(actual or 0, 1), 'final']); continue
            if pos in KDEF:
                mu, sd = KDEF[pos]; mean += mu; var += sd * sd; rows.append([slot, sid, mu, max(0, mu - Z80 * sd), mu + Z80 * sd, 'avg']); continue
            p = pts.get(sid, (pos, 0.0))[1] if sid in pts else 0.0
            f, c = floor_ceiling(pos, p)
            mean += p; var += psd(pos, p) ** 2
            rows.append([slot, sid, round(p, 1), round(f, 1), round(c, 1), 'proj' if sid in pts else 'none'])
        res[t['rid']] = {'mid': m.get('matchup_id'), 'mean': round(mean, 1), 'sd': round(math.sqrt(var), 1), 'rows': rows}
        live[t['rid']] = (mean, var)
    for r, x in res.items():
        opp = next((o for o, y in res.items() if o != r and y['mid'] == x['mid'] and x['mid'] is not None), None)
        x['opp'] = opp
        if opp is not None:
            d = x['mean'] - res[opp]['mean']; s = math.sqrt(x['sd'] ** 2 + res[opp]['sd'] ** 2) or 1
            x['win'] = round(phi(d / s), 3)
    return res, live

# ---------------------------------------------------------------- waivers
def waiver_advice(league, teams, val, slots, rostered, me, remaining_weeks, dyn, budget, waiver_type, lineup_value, needs):
    my_ids = [p for p in me['players'] if p in val and p not in me.get('ir', []) and p not in me.get('taxi', [])]
    ros = {sid: (v['pos'], v['ros']) for sid, v in val.items()}
    base, start = lineup_value(my_ids, ros, slots)
    bench = [p for p in my_ids if p not in start]
    drop = min(bench, key=lambda s: val[s]['tv']) if bench else None
    fa = [sid for sid, v in val.items() if sid not in rostered and v['ros'] > 0]
    fa.sort(key=lambda s: -val[s]['tv'])
    games = me['w'] + me['l'] + me.get('t', 0)
    wpct = me['w'] / games if games else 0.5
    mood = 1.35 if wpct < 0.4 else 0.75 if wpct > 0.6 else 1.0
    used = me.get('faab_used', 0) or 0
    remaining = max(0, (budget or 0) - used)
    out = []
    for sid in fa[:40]:
        after = [x for x in my_ids if x != drop] + [sid]
        gain = lineup_value(after, ros, slots)[0] - base
        dv = val[sid]['tv'] - max(0.0, val[drop]['tv'] if drop else 0.0)
        if gain < 3 and not (dyn and dv >= 40): continue
        item = {'add': sid, 'drop': drop, 'gain': round(gain, 1), 'value': round(dv, 1)}
        if waiver_type == 2 and budget:
            pct = min(45.0, max(1.0, (gain + (0.15 * dv if dyn else 0)) / 4.0)) * mood
            pos = val[sid]['pos']
            rivals = [t for t in teams if not t['me'] and (needs.get(t['rid'], {}).get(pos, 0) <= -0.5) and (budget - (t.get('faab_used') or 0)) >= budget * pct / 100]
            pct *= 1 + min(0.4, 0.1 * len(rivals))
            bid = int(round(min(remaining, max(1, budget * pct / 100))))
            item.update(bid=bid, rivals=len(rivals))
        out.append(item)
    out.sort(key=lambda x: -(x['gain'] + (0.3 * x['value'] if dyn else 0)))
    return {'remaining': remaining if waiver_type == 2 else None, 'mood': 'aggressive' if mood > 1 else 'conservative' if mood < 1 else 'balanced',
            'type': waiver_type, 'position': me.get('waiver_position'), 'adds': out[:8], 'drop': drop}

# ---------------------------------------------------------------- manager profiles
def profiles(league_id, teams, sget, SP, cur_week, seasons_back=2):
    """Trade and waiver habits per manager (owner user id), from this season and up to two past seasons."""
    prof = {t['owner_id']: {'trades': 0, 'trades_now': 0, 'adds': 0, 'bought': {}, 'sold': {}, 'partners': {}} for t in teams if t.get('owner_id')}
    lid = league_id; depth = 0
    while lid and depth <= seasons_back:
        try:
            lg = sget(f'/league/{lid}'); R = sget(f'/league/{lid}/rosters')
        except Exception:
            break
        owner = {r['roster_id']: r.get('owner_id') for r in R}
        last = cur_week if depth == 0 else 18
        for wk in range(1, last + 1):
            try: tx = sget(f'/league/{lid}/transactions/{wk}')
            except Exception: continue
            for x in tx:
                if x.get('status') != 'complete': continue
                if x['type'] == 'trade':
                    rids = x.get('roster_ids') or []
                    for r in rids:
                        u = owner.get(r)
                        if u not in prof: continue
                        prof[u]['trades'] += 1
                        if depth == 0: prof[u]['trades_now'] += 1
                        for o in rids:
                            if o != r and owner.get(o): prof[u]['partners'][owner[o]] = prof[u]['partners'].get(owner[o], 0) + 1
                    for sid, r in (x.get('adds') or {}).items():
                        u = owner.get(r); pos = (SP.get(sid) or {}).get('position')
                        if u in prof and pos: prof[u]['bought'][pos] = prof[u]['bought'].get(pos, 0) + 1
                    for sid, r in (x.get('drops') or {}).items():
                        u = owner.get(r); pos = (SP.get(sid) or {}).get('position')
                        if u in prof and pos: prof[u]['sold'][pos] = prof[u]['sold'].get(pos, 0) + 1
                elif x['type'] in ('waiver', 'free_agent') and depth == 0:
                    for sid, r in (x.get('adds') or {}).items():
                        u = owner.get(r)
                        if u in prof: prof[u]['adds'] += 1
        lid = lg.get('previous_league_id'); depth += 1
    for u, p in prof.items():
        tags = []
        if p['trades'] >= 4: tags.append('Active trader')
        elif p['trades'] == 0: tags.append('Rarely trades')
        if p['bought']:
            top = max(p['bought'], key=p['bought'].get)
            if p['bought'][top] >= 2: tags.append(f'Buys {top}s')
        if p['adds'] >= 6: tags.append('Waiver hawk')
        elif p['adds'] == 0 and cur_week >= 3: tags.append('Inactive on waivers')
        p['tags'] = tags
        p['partners'] = dict(sorted(p['partners'].items(), key=lambda kv: -kv[1])[:3])
    return prof

# ---------------------------------------------------------------- breakouts
def breakouts(site, SP_by_gsis, injured_out):
    """Usage jumps in the latest game vs earlier games, and backups whose starter is out."""
    out = []
    by_team_pos = {}
    for p in site['players']:
        by_team_pos.setdefault((p['team'], p['pos']), []).append(p)
        wk = p['wk']
        if len(wk) < 2: continue
        last, prev = wk[-1], wk[:-1]
        avg = lambda k: sum((w.get(k) or 0) for w in prev) / len(prev)
        bits = []; strength = 0
        if last.get('snap') is not None and last['snap'] >= 0.6 and last['snap'] - avg('snap') >= 0.2:
            bits.append(f"snap share up to {last['snap']*100:.0f}% from {avg('snap')*100:.0f}%"); strength += 1
        if p['pos'] in ('WR', 'TE', 'RB') and last['tgt'] >= 7 and last['tgt'] - avg('tgt') >= 4:
            bits.append(f"{last['tgt']} targets, up from {avg('tgt'):.1f}"); strength += 1 + (last['tgt'] >= 9)
        if p['pos'] == 'RB' and last['car'] >= 14 and last['car'] - avg('car') >= 8:
            bits.append(f"{last['car']} carries, up from {avg('car'):.1f}"); strength += 2
        if bits and strength >= 2 and (last.get('xfp') or 0) >= 10:
            out.append({'id': p['id'], 'type': 'usage', 'text': '; '.join(bits), 'w': last['w'], 'score': strength + (last.get('xfp') or 0) / 10})
    for (team, pos), arr in by_team_pos.items():
        arr = sorted(arr, key=lambda x: -x['xfp'])
        if len(arr) >= 2 and arr[0]['id'] in injured_out and arr[0]['xfp'] >= 10 and pos in ('RB', 'WR', 'TE'):
            nxt = arr[1]
            out.append({'id': nxt['id'], 'type': 'opening', 'text': f"{arr[0]['name']} is {injured_out[arr[0]['id']]}; {nxt['name']} is next in line ({nxt['xfp']:.1f} expected pts per game so far)", 'w': None, 'score': 3 + nxt['xfp'] / 10})
    out.sort(key=lambda b: -b['score'])
    return out

# ---------------------------------------------------------------- dynasty
CLIFF = {'RB': 27, 'WR': 30, 'TE': 31, 'QB': 35}
def dynasty_labels(teams, odds, val):
    lab = {}
    for t in teams:
        o = odds.get(t['rid'], {}).get('odds', 0.5)
        ages = sorted([(val[s]['tv'], val[s]['age']) for s in t['players'] if s in val and val[s].get('age')], reverse=True)[:8]
        avg_age = sum(a for _, a in ages) / len(ages) if ages else 26
        lab[t['rid']] = {'mode': 'Contender' if o >= 0.5 else 'Rebuilding' if o <= 0.2 else 'Middle', 'age': round(avg_age, 1)}
    return lab

def cliff_warnings(me, val):
    out = []
    for s in me['players']:
        v = val.get(s)
        if v and v.get('age') and v['age'] >= CLIFF[v['pos']] and v['tv'] > 20:
            out.append({'sid': s, 'age': v['age'], 'pos': v['pos']})
    return out

# ---------------------------------------------------------------- live accuracy log
def update_history(hist, proj, cur_week, played_teams, std, actual):
    """Keep the projection made for each player before his game, then score it once the game is in.
    actual: {(gsis_id, week): points in standard scoring}"""
    hist = hist or {}
    snaps = hist.setdefault('snap', {})
    wk = str(cur_week)
    cur = snaps.setdefault(wk, {})
    for gid, p in proj.items():
        if not p['weeks']: continue
        w = p['weeks'][0]
        if w['w'] != cur_week or p['team'] in played_teams: continue
        m = 0.6 * w['rm'] + 0.4 * w['cm'] if p['pos'] == 'RB' else 0.25 * w['rm'] + 0.75 * w['cm'] if p['pos'] == 'QB' else w['cm']
        cur[gid] = [round(std(p, w), 2), round(p['base'], 2), round(m, 3), p['pos']]
    # score finished weeks
    res = {}
    for w, rows in snaps.items():
        pairs_ok = pairs_n = 0; err_m = []; err_b = []; by_pos = {}
        for gid, (pj, base, m, pos) in rows.items():
            a = actual.get((gid, int(w)))
            if a is None: continue
            err_m.append(abs(pj - a)); err_b.append(abs(base - a))
            by_pos.setdefault(pos, []).append((pj, a))
        for pos, arr in by_pos.items():
            for i in range(len(arr)):
                for j in range(i + 1, len(arr)):
                    dp = arr[i][0] - arr[j][0]; da = arr[i][1] - arr[j][1]
                    if abs(dp) >= 1 and da != 0:
                        pairs_n += 1; pairs_ok += (dp > 0) == (da > 0)
        if err_m:
            res[w] = {'n': len(err_m), 'mae': round(float(np.mean(err_m)), 2), 'mae_base': round(float(np.mean(err_b)), 2),
                      'pairs': round(pairs_ok / pairs_n, 3) if pairs_n else None}
    hist['results'] = res
    # keep only the last 20 weeks of snapshots
    for w in sorted(snaps, key=int)[:-20]: del snaps[w]
    return hist

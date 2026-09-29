#!/usr/bin/env python3
"""Fantasy Luck Lab data builder.

Pulls nflverse (current + prior season) and Sleeper, then builds:
  site-data     : player usage/luck table, team schedule + defense vs position (same shape the page already uses)
  matchup-data  : team offense/defense profiles, player style, next-game and rest-of-season projections
  sleeper-data  : leagues, rosters, draft picks, per-league values, team needs and trade offers

Usage:
  python3 build.py                    -> writes site.json, matchup.json, sleeper.json in the current folder
  python3 build.py --patch page.html  -> also swaps those three JSON blocks into page.html (in place)

Free data only. Run scheme is approximated from run direction/gap (inside = middle or guard gaps,
outside = tackle or end). Coverage tendencies (man/zone) come from the prior season's participation data.
Designed so a paid scheme source can be added later in team_profiles()/player_styles().
"""
import sys, json, math, re, datetime, itertools, warnings
warnings.filterwarnings('ignore')
import numpy as np, pandas as pd, requests
import nflreadpy as nfl
import extras as X

SEASON = 2026
PRIOR = SEASON - 1
SLEEPER_USER = 'ragbir'
POS = ['QB', 'RB', 'WR', 'TE']
Q_MIN_XFP = {'QB': 12, 'RB': 7, 'WR': 7, 'TE': 5}
PLAYOFF_WEIGHT = 1.5
ALLOW_ALL_STATUS = False  # backtests use end-of-season rosters
MATCH_K = 0.5  # strength of matchup adjustments (1 = as designed); tuned by backtest.py
LAST_REG_WEEK = 18

def pdf(x):
    return x.to_pandas() if hasattr(x, 'to_pandas') else x

def r1(v, n=1):
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)): return None
        return round(float(v), n)
    except Exception:
        return None

# ---------------------------------------------------------------- load
def load():
    D = {}
    D['pbp'] = pdf(nfl.load_pbp([SEASON]))
    D['pbp0'] = pdf(nfl.load_pbp([PRIOR]))
    D['ffo'] = pdf(nfl.load_ff_opportunity([SEASON], stat_type='weekly'))
    D['ffo0'] = pdf(nfl.load_ff_opportunity([PRIOR], stat_type='weekly'))
    D['snaps'] = pdf(nfl.load_snap_counts([SEASON]))
    D['stats'] = pdf(nfl.load_player_stats([SEASON]))
    D['sched'] = pdf(nfl.load_schedules([SEASON]))
    try: D['inj'] = pdf(nfl.load_injuries([SEASON]))
    except Exception: D['inj'] = pd.DataFrame()
    D['rost'] = pdf(nfl.load_rosters([SEASON]))
    try: D['part0'] = pdf(nfl.load_participation([PRIOR]))
    except Exception: D['part0'] = pd.DataFrame()
    for k in ('pbp', 'pbp0'):
        p = D[k]
        D[k] = p[(p['season_type'] == 'REG') & p['posteam'].notna() & p['defteam'].notna()]
    for k in ('ffo', 'ffo0'):
        f = D[k]
        f = f[f['position'].isin(POS)].copy()
        f['week'] = f['week'].astype(int)
        D[k] = f
    s = D['stats']
    D['stats'] = s[s['season_type'] == 'REG']
    return D

# ---------------------------------------------------------------- schedule helpers
def schedule_info(sched):
    s = sched[sched['game_type'] == 'REG'].copy()
    s['done'] = s['home_score'].notna()
    played = s[s['done']]
    last_week = int(played['week'].max()) if len(played) else 0
    upcoming = s[~s['done']]
    next_week = int(upcoming['week'].min()) if len(upcoming) else None
    cov = {'season': SEASON, 'lastWeek': last_week,
           'gamesInLastWeek': int(((s['week'] == last_week) & s['done']).sum()) if last_week else 0,
           'totalInLastWeek': int((s['week'] == last_week).sum()) if last_week else 0,
           'gamesPlayed': int(len(played)),
           'throughDate': str(played['gameday'].max()) if len(played) else None,
           'nextWeek': next_week}
    games = []  # one row per team per game
    for _, g in s.iterrows():
        tot, spr = g['total_line'], g['spread_line']
        hi = ai = None
        if pd.notna(tot) and pd.notna(spr):
            hi, ai = tot / 2 + spr / 2, tot / 2 - spr / 2
        games.append(dict(team=g['home_team'], opp=g['away_team'], home=True, week=int(g['week']), date=g['gameday'],
                          implied=hi, spread=(-spr if pd.notna(spr) else None), done=bool(g['done'])))
        games.append(dict(team=g['away_team'], opp=g['home_team'], home=False, week=int(g['week']), date=g['gameday'],
                          implied=ai, spread=(spr if pd.notna(spr) else None), done=bool(g['done'])))
    return cov, pd.DataFrame(games)

# ---------------------------------------------------------------- site-data players (same shape as before)
def pbp_rz(pbp):
    rz = {}
    ru = pbp[(pbp['rush_attempt'] == 1) & pbp['rusher_player_id'].notna()]
    rc = pbp[(pbp['complete_pass'] == 1) & pbp['receiver_player_id'].notna()]
    for _, r in ru[ru['yardline_100'] <= 20].groupby(['rusher_player_id', 'week']).size().items():
        pass
    out = {}
    def add(df, col, key):
        g = df.groupby([col, 'week']).size()
        for (pid, wk), n in g.items():
            out.setdefault((pid, int(wk)), {'rz': 0, 'gl': 0})[key] += int(n)
    add(ru[ru['yardline_100'] <= 20], 'rusher_player_id', 'rz')
    add(rc[rc['yardline_100'] <= 20], 'receiver_player_id', 'rz')
    add(ru[ru['yardline_100'] <= 5], 'rusher_player_id', 'gl')
    return out

def build_site(D, cov, games):
    ffo, stats, snaps, rost, pbp = D['ffo'], D['stats'], D['snaps'], D['rost'], D['pbp']
    rl = rost.sort_values('week').drop_duplicates('gsis_id', keep='last')
    pfr2g = dict(zip(rl['pfr_id'], rl['gsis_id']))
    snaps = snaps.copy(); snaps['gsis'] = snaps['pfr_player_id'].map(pfr2g)
    snapmap = {(r.gsis, int(r.week)): r.offense_pct for r in snaps.itertuples() if isinstance(r.gsis, str)}
    st = stats.copy()
    team_tgt = st.groupby(['team', 'week'])['targets'].sum().to_dict()
    stmap = {(r.player_id, int(r.week)): r for r in st.itertuples()}
    rz = pbp_rz(pbp)
    inj = injuries(D['inj'])
    players = []
    for pid, g in ffo.groupby('player_id'):
        g = g.sort_values('week')
        wk = []
        for r in g.itertuples():
            w = int(r.week); s = stmap.get((pid, w))
            att = int(getattr(s, 'attempts', 0) or 0) if s is not None else int(r.pass_attempt or 0)
            car = int(getattr(s, 'carries', 0) or 0) if s is not None else int(r.rush_attempt or 0)
            tgt = int(getattr(s, 'targets', 0) or 0) if s is not None else int(r.rec_attempt or 0)
            rec = int(getattr(s, 'receptions', 0) or 0) if s is not None else int(r.receptions or 0)
            yds = int((getattr(s, 'passing_yards', 0) or 0) + (getattr(s, 'rushing_yards', 0) or 0) + (getattr(s, 'receiving_yards', 0) or 0)) if s is not None else 0
            td = int((getattr(s, 'passing_tds', 0) or 0) + (getattr(s, 'rushing_tds', 0) or 0) + (getattr(s, 'receiving_tds', 0) or 0)) if s is not None else 0
            opp = getattr(s, 'opponent_team', None) if s is not None else None
            z = rz.get((pid, w), {'rz': 0, 'gl': 0})
            wk.append(dict(w=w, opp=opp, ppr=r1(r.total_fantasy_points), xfp=r1(r.total_fantasy_points_exp),
                           snap=r1(snapmap.get((pid, w)), 3), att=att, car=car, tgt=tgt, rec=rec, rz=z['rz'], gl=z['gl'],
                           yds=yds, td=td, _team=r.posteam, _tt=team_tgt.get((r.posteam, w), 0)))
        n = len(wk)
        if not n: continue
        ppr = sum(w['ppr'] or 0 for w in wk) / n; xfp = sum(w['xfp'] or 0 for w in wk) / n
        snapv = [w['snap'] for w in wk if w['snap'] is not None]
        tt = sum(w['_tt'] for w in wk); tg = sum(w['tgt'] for w in wk)
        pos = g['position'].iloc[-1]
        p = dict(id=pid, name=g['full_name'].iloc[-1], pos=pos, team=wk[-1]['_team'], g=n, ppr=round(ppr, 2), xfp=round(xfp, 2),
                 diff=round(ppr - xfp, 2), pprT=round(ppr * n, 1), xfpT=round(xfp * n, 1),
                 snap=round(sum(snapv) / len(snapv), 3) if snapv else None,
                 att=sum(w['att'] for w in wk), car=sum(w['car'] for w in wk), tgt=tg, rec=sum(w['rec'] for w in wk),
                 ts=round(tg / tt, 3) if tt else 0.0, rz=sum(w['rz'] for w in wk), gl=sum(w['gl'] for w in wk),
                 q=bool(n >= 2 and xfp >= Q_MIN_XFP.get(pos, 7)),
                 wk=[{k: v for k, v in w.items() if not k.startswith('_')} for w in wk])
        if pid in inj: p['inj'] = inj[pid]
        players.append(p)
    players.sort(key=lambda p: p['diff'])
    # teams: next game + defense vs position (PPR allowed per game)
    allowed = {}
    for p in players:
        for w in p['wk']:
            if w['opp']: allowed.setdefault((w['opp'], p['pos']), {}).setdefault(w['w'], 0)
            if w['opp']: allowed[(w['opp'], p['pos'])][w['w']] += (w['ppr'] or 0)
    teams = {}
    nw = cov['nextWeek']
    tlist = sorted(set(games['team']))
    dvp_pts = {pos: {t: (np.mean(list(allowed.get((t, pos), {}).values())) if allowed.get((t, pos)) else 0) for t in tlist} for pos in POS}
    for t in tlist:
        tg = games[(games['team'] == t) & (~games['done'])].sort_values('week')
        nxt = tg.iloc[0] if len(tg) else None
        d = {}
        for pos in POS:
            ranked = sorted(tlist, key=lambda x: -dvp_pts[pos][x])
            d[pos] = {'rank': ranked.index(t) + 1, 'pts': round(dvp_pts[pos][t], 1)}
        teams[t] = {'next': None if nxt is None else {'w': int(nxt['week']), 'opp': nxt['opp'], 'home': bool(nxt['home']), 'date': nxt['date'],
                                                        'implied': r1(nxt['implied']), 'spread': r1(nxt['spread'])},
                    'bye': bool(nw and not ((games['team'] == t) & (games['week'] == nw)).any()), 'dvp': d}
    return {'coverage': cov, 'teams': teams, 'players': players,
            'updated': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ')}

def injuries(inj):
    out = {}
    if inj is None or not len(inj): return out
    i = inj[inj['season_type'] == 'REG'] if 'season_type' in inj else inj
    if not len(i): return out
    lw = int(i['week'].max()); i = i[i['week'] == lw]
    for r in i.itertuples():
        st = r.report_status if isinstance(r.report_status, str) else None
        out[r.gsis_id] = {'w': lw, 'status': st, 'practice': r.practice_status if isinstance(r.practice_status, str) else None,
                          'injury': r.report_primary_injury if isinstance(r.report_primary_injury, str) else None}
    return out

# ---------------------------------------------------------------- matchup model
def inside(df):
    return df['run_location'].eq('middle') | df['run_gap'].eq('guard')

def team_profiles(pbp, pbp0, part0, games_played_26):
    """Per-team offense and defense profiles, 2026 blended with the prior season.
    Blend weight on the current season = games / (games + 4)."""
    def prof(p):
        runs = p[(p['rush_attempt'] == 1) & (p['qb_scramble'] != 1) & p['run_location'].notna()].copy()
        runs['inside'] = inside(runs)
        drop = p[p['qb_dropback'] == 1]
        tg = p[(p['pass_attempt'] == 1) & p['receiver_player_id'].notna()]
        neutral = p[(p['down'].isin([1, 2])) & (p['wp'].between(0.2, 0.8)) & (p['play_type'].isin(['run', 'pass']))]
        off, de = {}, {}
        ng = p.groupby('posteam')['game_id'].nunique()
        plays = p[p['play_type'].isin(['run', 'pass'])].groupby('posteam').size()
        for t in ng.index:
            r = runs[runs['posteam'] == t]; d = drop[drop['posteam'] == t]; n = neutral[neutral['posteam'] == t]
            off[t] = dict(g=int(ng[t]), plays=plays.get(t, 0) / ng[t],
                          pass_rate=float((n['play_type'] == 'pass').mean()) if len(n) else 0.58,
                          rush_epa=r['epa'].mean(), rush_sr=r['success'].mean(), in_share=r['inside'].mean(),
                          in_epa=r[r['inside']]['epa'].mean(), out_epa=r[~r['inside']]['epa'].mean(),
                          pass_epa=d['epa'].mean())
        ngd = p.groupby('defteam')['game_id'].nunique()
        for t in ngd.index:
            r = runs[runs['defteam'] == t]; d = drop[drop['defteam'] == t]; x = tg[tg['defteam'] == t]
            de[t] = dict(g=int(ngd[t]), rush_epa=r['epa'].mean(), rush_sr=r['success'].mean(),
                         in_epa=r[r['inside']]['epa'].mean(), out_epa=r[~r['inside']]['epa'].mean(),
                         pass_epa=d['epa'].mean(), sack=d['sack'].mean(),
                         deep_epa=x[x['air_yards'] >= 15]['epa'].mean(), short_epa=x[x['air_yards'] < 15]['epa'].mean(),
                         pts=None)
        return off, de
    o1, d1 = prof(pbp); o0, d0 = prof(pbp0)
    # coverage tendency (prior season): share of dropbacks in zone
    zone = {}
    if part0 is not None and len(part0):
        pp = part0[part0['defense_man_zone_type'].isin(['MAN_COVERAGE', 'ZONE_COVERAGE'])].copy()
        gid = pbp0[['game_id', 'play_id', 'defteam']].drop_duplicates()
        pp = pp.merge(gid, left_on=['nflverse_game_id', 'play_id'], right_on=['game_id', 'play_id'], how='inner')
        zone = pp.groupby('defteam')['defense_man_zone_type'].apply(lambda s: float((s == 'ZONE_COVERAGE').mean())).to_dict()
    def blend(cur, pri, keys):
        out = {}
        for t in set(cur) | set(pri):
            c, p = cur.get(t, {}), pri.get(t, {})
            gc = c.get('g', 0); w = gc / (gc + 4.0)
            o = {}
            for k in keys:
                cv, pv = c.get(k), p.get(k)
                cv = None if cv is None or (isinstance(cv, float) and math.isnan(cv)) else cv
                pv = None if pv is None or (isinstance(pv, float) and math.isnan(pv)) else pv
                o[k] = (w * cv + (1 - w) * pv) if cv is not None and pv is not None else (cv if cv is not None else pv)
            o['g'] = gc; out[t] = o
        return out
    off = blend(o1, o0, ['plays', 'pass_rate', 'rush_epa', 'rush_sr', 'in_share', 'in_epa', 'out_epa', 'pass_epa'])
    de = blend(d1, d0, ['rush_epa', 'rush_sr', 'in_epa', 'out_epa', 'pass_epa', 'sack', 'deep_epa', 'short_epa'])
    for t in de: de[t]['zone'] = zone.get(t)
    return off, de

def zscores(d, key):
    vals = [v[key] for v in d.values() if v.get(key) is not None]
    mu, sd = float(np.mean(vals)), float(np.std(vals)) or 1.0
    return {t: ((v[key] - mu) / sd if v.get(key) is not None else 0.0) for t, v in d.items()}, mu, sd

def player_styles(D, site_players):
    """Per-player style: RB inside-run share and efficiency, receiver depth and man/zone splits (prior season)."""
    pbp, pbp0, part0 = D['pbp'], D['pbp0'], D['part0']
    both = pd.concat([pbp.assign(cur=1), pbp0.assign(cur=0)])
    runs = both[(both['rush_attempt'] == 1) & (both['qb_scramble'] != 1) & both['run_location'].notna() & both['rusher_player_id'].notna()].copy()
    runs['inside'] = inside(runs)
    tg = both[(both['pass_attempt'] == 1) & both['receiver_player_id'].notna()]
    st = {}
    for pid, r in runs.groupby('rusher_player_id'):
        cur = r[r['cur'] == 1]
        use = cur if len(cur) >= 15 else r
        st.setdefault(pid, {}).update(car_n=int(len(use)), in_share=float(use['inside'].mean()),
                                      in_epa=float(use[use['inside']]['epa'].mean()) if use['inside'].any() else None,
                                      out_epa=float(use[~use['inside']]['epa'].mean()) if (~use['inside']).any() else None,
                                      rush_epa=float(use['epa'].mean()))
    for pid, x in tg.groupby('receiver_player_id'):
        cur = x[x['cur'] == 1]; use = cur if len(cur) >= 12 else x
        st.setdefault(pid, {}).update(tgt_n=int(len(use)), adot=float(use['air_yards'].mean()) if use['air_yards'].notna().any() else None,
                                      deep_share=float((use['air_yards'] >= 15).mean()), tgt_epa=float(use['epa'].mean()))
    if part0 is not None and len(part0):
        pp = part0[part0['defense_man_zone_type'].isin(['MAN_COVERAGE', 'ZONE_COVERAGE'])][['nflverse_game_id', 'play_id', 'defense_man_zone_type']]
        t0 = pbp0[(pbp0['pass_attempt'] == 1) & pbp0['receiver_player_id'].notna()][['game_id', 'play_id', 'receiver_player_id', 'epa']]
        m = t0.merge(pp, left_on=['game_id', 'play_id'], right_on=['nflverse_game_id', 'play_id'])
        for pid, x in m.groupby('receiver_player_id'):
            mz = x[x['defense_man_zone_type'] == 'MAN_COVERAGE']; zz = x[x['defense_man_zone_type'] == 'ZONE_COVERAGE']
            if len(mz) >= 12 and len(zz) >= 20:
                st.setdefault(pid, {}).update(man_epa=float(mz['epa'].mean()), zone_epa=float(zz['epa'].mean()), cov_n=int(len(x)))
    return st

# ---------------------------------------------------------------- per-game components (usage-based, with prior)
COMP = ['pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td', 'fum']
def comp_rows(f):
    """Per player-week component vectors: expected (usage) and actual."""
    g = lambda c: f[c].fillna(0) if c in f else 0
    e = pd.DataFrame({'player_id': f['player_id'], 'week': f['week'], 'team': f['posteam'], 'pos': f['position'], 'name': f['full_name'],
                      'pass_yd': g('pass_yards_gained_exp'), 'pass_td': g('pass_touchdown_exp'), 'pass_int': g('pass_interception_exp'),
                      'rush_yd': g('rush_yards_gained_exp'), 'rush_td': g('rush_touchdown_exp'),
                      'rec': g('receptions_exp'), 'rec_yd': g('rec_yards_gained_exp'), 'rec_td': g('rec_touchdown_exp'), 'fum': 0.0})
    a = pd.DataFrame({'player_id': f['player_id'], 'week': f['week'],
                      'pass_yd': g('pass_yards_gained'), 'pass_td': g('pass_touchdown'), 'pass_int': g('pass_interception'),
                      'rush_yd': g('rush_yards_gained'), 'rush_td': g('rush_touchdown'),
                      'rec': g('receptions'), 'rec_yd': g('rec_yards_gained'), 'rec_td': g('rec_touchdown'),
                      'fum': g('rec_fumble_lost') + g('rush_fumble_lost')})
    return e, a

def baselines(D):
    """Per-game component baseline: 70% expected + 30% actual, current season with the prior season as a
    2-game prior (1 game if the player changed teams)."""
    e1, a1 = comp_rows(D['ffo']); e0, a0 = comp_rows(D['ffo0'])
    def agg(e, a):
        m = e.groupby('player_id')[COMP].mean() * 0.7 + a.groupby('player_id')[COMP].mean().reindex(e['player_id'].unique()).fillna(0) * 0.3
        info = e.sort_values('week').groupby('player_id').agg(team=('team', 'last'), pos=('pos', 'last'), name=('name', 'last'), g=('week', 'nunique'))
        return m, info
    m1, i1 = agg(e1, a1); m0, i0 = agg(e0, a0)
    out = {}
    for pid in set(m1.index) | set(m0.index):
        c = m1.loc[pid] if pid in m1.index else None; p = m0.loc[pid] if pid in m0.index else None
        g1 = int(i1.loc[pid, 'g']) if pid in i1.index else 0
        same = pid in i1.index and pid in i0.index and i1.loc[pid, 'team'] == i0.loc[pid, 'team']
        pw = (2.0 if same else 1.0) if p is not None and int(i0.loc[pid, 'g']) >= 4 else 0.0
        if c is None and p is None: continue
        if c is None: v = p; w = 0
        elif pw == 0: v = c; w = 1
        else: w = g1 / (g1 + pw); v = c * w + p * (1 - w)
        info = i1.loc[pid] if pid in i1.index else i0.loc[pid]
        out[pid] = dict(comp={k: float(v[k]) for k in COMP}, team=info['team'], pos=info['pos'], name=info['name'], g=g1,
                        prior_only=c is None)
    return out

def score(comp, sc):
    return (comp['pass_yd'] * sc.get('pass_yd', 0.04) + comp['pass_td'] * sc.get('pass_td', 4) + comp['pass_int'] * sc.get('pass_int', -1)
            + comp['rush_yd'] * sc.get('rush_yd', 0.1) + comp['rush_td'] * sc.get('rush_td', 6)
            + comp['rec'] * sc.get('rec', 1) + comp['rec_yd'] * sc.get('rec_yd', 0.1) + comp['rec_td'] * sc.get('rec_td', 6)
            + comp['fum'] * sc.get('fum_lost', -2))

STD_SCORING = {'pass_yd': 0.04, 'pass_td': 4, 'pass_int': -2, 'rush_yd': 0.1, 'rush_td': 6, 'rec': 1, 'rec_yd': 0.1, 'rec_td': 6, 'fum_lost': -2}

def combM(pos, rm, cm):
    return 0.6 * rm + 0.4 * cm if pos == 'RB' else 0.25 * rm + 0.75 * cm if pos == 'QB' else cm

def clip(x, lo=0.78, hi=1.25):
    return max(lo, min(hi, x))

def game_mults(pos, style, team, opp, implied, off, de, Z, avg_implied):
    """Multipliers for rushing and receiving/passing parts of a projection in one game, with reasons."""
    why = []
    env = 1.0
    if implied:
        env = (implied / avg_implied) ** 0.5
        if abs(implied - avg_implied) >= 2.5:
            why.append(f"team total {implied:.1f} ({'high' if implied > avg_implied else 'low'})")
    d = de.get(opp, {})
    # --- rushing: opponent's run defense, weighted to the runner's inside/outside mix
    ins = (style or {}).get('in_share')
    if ins is None: ins = off.get(team, {}).get('in_share', 0.5) or 0.5
    zi, zo, zr = Z['d_in'].get(opp, 0), Z['d_out'].get(opp, 0), Z['d_rush'].get(opp, 0)
    zrun = ins * zi + (1 - ins) * zo
    run_m = math.exp(0.07 * zrun + 0.04 * zr)
    if pos in ('RB', 'QB') and abs(zrun) >= 0.8:
        lab = 'inside' if ins >= 0.55 else 'outside' if ins <= 0.45 else 'mixed'
        why.append(f"{opp} is {'soft' if zrun > 0 else 'stout'} vs {lab} runs ({ins*100:.0f}% of his carries go inside)")
    # --- passing / receiving
    zp = Z['d_pass'].get(opp, 0)
    rec_m = math.exp(0.06 * zp)
    fp_z = Z['dvp'].get(pos, {}).get(opp, 0)
    rec_m *= math.exp(0.04 * fp_z); run_m *= math.exp(0.03 * fp_z if pos == 'RB' else 0)
    if abs(zp) >= 0.9 and pos in ('QB', 'WR', 'TE'):
        why.append(f"{opp} pass defense ranks {'poorly' if zp > 0 else 'well'}")
    if pos in ('WR', 'TE') and style:
        ds = style.get('deep_share')
        if ds is not None and ds >= 0.25:
            zd = Z['d_deep'].get(opp, 0); rec_m *= math.exp(0.04 * zd * min(1, ds / 0.35))
            if abs(zd) >= 1: why.append(f"deep threat vs a defense that is {'leaky' if zd > 0 else 'tight'} deep")
        me, ze, zr_ = style.get('man_epa'), style.get('zone_epa'), d.get('zone')
        if me is not None and ze is not None and zr_ is not None:
            fit = (ze - me) * (zr_ - Z['zone_avg'])  # likes zone and they play more zone -> positive
            rec_m *= math.exp(clip(fit * 3.0, -0.08, 0.08))
            if abs(fit * 3) >= 0.03:
                why.append(f"{opp} plays {'more' if zr_ > Z['zone_avg'] else 'less'} zone than average; he has been {'better' if ze > me else 'worse'} vs zone")
    if pos == 'QB' and Z['d_sack'].get(opp, 0) >= 1.0:
        rec_m *= 0.97; why.append(f"{opp} gets home: high sack rate")
    return clip(env * run_m), clip(env * rec_m), why

def reputation(D):
    """How managers see a player coming into the season: prior-season actual PPR per game (4+ games)."""
    f = D['ffo0']; g = f.groupby('player_id')
    ppg = g['total_fantasy_points'].mean(); n = g['week'].nunique()
    return {pid: float(ppg[pid]) for pid in ppg.index if n[pid] >= 4}

def build_matchups(D, site, games, cov):
    off, de = team_profiles(D['pbp'], D['pbp0'], D['part0'], None)
    Z = {}
    Z['d_in'], _, _ = zscores(de, 'in_epa'); Z['d_out'], _, _ = zscores(de, 'out_epa'); Z['d_rush'], _, _ = zscores(de, 'rush_epa')
    Z['d_pass'], _, _ = zscores(de, 'pass_epa'); Z['d_deep'], _, _ = zscores(de, 'deep_epa'); Z['d_sack'], _, _ = zscores(de, 'sack')
    zs = [v['zone'] for v in de.values() if v.get('zone') is not None]; Z['zone_avg'] = float(np.mean(zs)) if zs else 0.7
    dv = {}
    for pos in POS:
        d = {t: {'x': site['teams'][t]['dvp'][pos]['pts']} for t in site['teams']}
        z, _, _ = zscores(d, 'x'); dv[pos] = {t: z[t] * min(1, cov['lastWeek'] / 6) for t in z}  # trust grows with weeks
    Z['dvp'] = dv
    styles = player_styles(D, site['players'])
    base = baselines(D)
    imp = [g for g in games['implied'] if g is not None and not (isinstance(g, float) and math.isnan(g))]
    avg_implied = float(np.mean(imp)) if imp else 22.5
    # remaining schedule per team
    rem = games[~games['done']].sort_values('week')
    sched = {t: g for t, g in rem.groupby('team')}
    nw = cov['nextWeek']
    rl = D['rost'].sort_values('week').drop_duplicates('gsis_id', keep='last')
    cur_team = {g: t for g, t, s in zip(rl['gsis_id'], rl['team'], rl['status']) if isinstance(t, str) and (ALLOW_ALL_STATUS or s in ('ACT', 'RES', 'INA', 'DEV', 'EXE', 'SUS', 'PUP'))}
    rep = reputation(D)
    proj = {}
    for pid, b in base.items():
        pos = b['pos']; team = cur_team.get(pid)
        if team is None: continue
        if team != b['team']: b['team'] = team
        if pos not in POS or team not in sched: continue
        st = styles.get(pid, {})
        weeks = []
        for r in sched[team].itertuples():
            rm, cm, why = game_mults(pos, st, team, r.opp, r.implied if r.implied == r.implied else None, off, de, Z, avg_implied)
            rm, cm = rm ** MATCH_K, cm ** MATCH_K  # backtest on 2025: half-strength matchup effects predicted best
            weeks.append(dict(w=int(r.week), opp=r.opp, home=bool(r.home), rm=round(rm, 3), cm=round(cm, 3), why=why))
        c = b['comp']
        pts_std = score(c, STD_SCORING)
        proj[pid] = dict(pos=pos, team=team, name=b['name'], comp={k: round(v, 3) for k, v in c.items()}, base=round(pts_std, 2),
                         g=b['g'], prior_only=b['prior_only'], weeks=weeks, rep=r1(rep.get(pid), 2),
                         style={k: (round(v, 3) if isinstance(v, float) else v) for k, v in st.items()})
    teams = {}
    for t in sorted(set(off) | set(de)):
        o, d = off.get(t, {}), de.get(t, {})
        rk = lambda Zd: sorted(Zd, key=lambda x: Zd[x]).index(t) + 1 if t in Zd else None  # 1 = best defense (lowest EPA)
        teams[t] = {'off': {k: r1(v, 3) for k, v in o.items()}, 'def': {k: r1(v, 3) for k, v in d.items()},
                    'drank': {'run': rk(Z['d_rush']), 'inside': rk(Z['d_in']), 'outside': rk(Z['d_out']), 'pass': rk(Z['d_pass']), 'deep': rk(Z['d_deep'])}}
    return {'nextWeek': nw, 'avgImplied': round(avg_implied, 2), 'zoneAvg': round(Z['zone_avg'], 3), 'teams': teams, 'proj': proj}

def proj_components(p, w, sc):
    """Projected league points for one week entry w using rushing/receiving multipliers."""
    c = p['comp']
    rush = {'rush_yd': c['rush_yd'] * w['rm'], 'rush_td': c['rush_td'] * w['rm']}
    recv = {k: c[k] * w['cm'] for k in ('pass_yd', 'pass_td', 'rec', 'rec_yd', 'rec_td')}
    comp = dict(c); comp.update(rush); comp.update(recv)
    comp['pass_int'] = c['pass_int'] * (2 - w['cm'])
    pts = score(comp, sc)
    if p['pos'] == 'TE': pts += comp['rec'] * sc.get('bonus_rec_te', 0)
    return pts

# ---------------------------------------------------------------- Sleeper
def sget(path):
    r = requests.get('https://api.sleeper.app/v1' + path, timeout=30); r.raise_for_status(); return r.json()

INJ_NEXT = {'Out': 0.0, 'IR': 0.0, 'PUP': 0.0, 'Sus': 0.0, 'Doubtful': 0.25, 'Questionable': 0.85}
def avail_factors(inj_status, n_weeks):
    """Share of each remaining week we expect him to play."""
    f = [1.0] * n_weeks
    if not n_weeks: return f
    if inj_status in ('IR', 'PUP'):
        f = [0.0] * min(4, n_weeks) + [0.6] * max(0, n_weeks - 4)
    elif inj_status == 'Out':
        f[0] = 0.0
        if n_weeks > 1: f[1] = 0.6
    elif inj_status in INJ_NEXT:
        f[0] = INJ_NEXT[inj_status]
    return f

AGE_CURVE = {  # multiplier on current value for seasons +1, +2, +3 by current age band
    'RB': lambda a: [1.05, 1.0, 0.9] if a <= 23 else [1.0, 0.92, 0.8] if a <= 25 else [0.88, 0.72, 0.55] if a <= 27 else [0.7, 0.5, 0.3],
    'WR': lambda a: [1.1, 1.1, 1.05] if a <= 23 else [1.03, 1.0, 0.95] if a <= 26 else [0.95, 0.88, 0.78] if a <= 29 else [0.8, 0.65, 0.5],
    'TE': lambda a: [1.1, 1.1, 1.05] if a <= 24 else [1.0, 0.97, 0.9] if a <= 28 else [0.88, 0.75, 0.6],
    'QB': lambda a: [1.05, 1.05, 1.03] if a <= 25 else [1.0, 1.0, 0.97] if a <= 31 else [0.92, 0.82, 0.7] if a <= 35 else [0.75, 0.55, 0.35],
}
DISCOUNT = [0.75, 0.55, 0.4]

def lineup_value(ids, vals, slots):
    """Sum of starters' values with dedicated slots first, then FLEX (RB/WR/TE), then SUPER_FLEX. vals: id->(pos, value)."""
    pool = sorted([(vals[i][1], vals[i][0], i) for i in ids if i in vals], reverse=True)
    used = set(); total = 0.0; start = []
    def take(ok, n):
        nonlocal total
        for _ in range(n):
            for v, pos, i in pool:
                if i not in used and ok(pos):
                    used.add(i); total += v; start.append(i); break
    for pos in POS: take(lambda p, pos=pos: p == pos, slots.get(pos, 0))
    take(lambda p: p in ('RB', 'WR', 'TE'), slots.get('FLEX', 0))
    take(lambda p: p in POS, slots.get('SUPER_FLEX', 0))
    bench = sorted([v for v, _, i in pool if i not in used], reverse=True)[:4]
    return total + 0.12 * sum(bench), start

_FC = {}
def market_values(dyn, qbs, teams, ppr):
    """Crowd-sourced trade values from FantasyCalc (built from real fantasy trades), keyed by Sleeper id."""
    key = (dyn, qbs, teams, ppr)
    if key not in _FC:
        try:
            r = requests.get('https://api.fantasycalc.com/values/current', params={'isDynasty': str(dyn).lower(), 'numQbs': qbs, 'numTeams': teams, 'ppr': ppr}, timeout=30)
            r.raise_for_status()
            _FC[key] = {str(x['player'].get('sleeperId')): (x['value'], x['overallRank']) for x in r.json() if x['player'].get('sleeperId')}
        except Exception:
            _FC[key] = {}
    return _FC[key]

def draft_capital(lid):
    """Where each player went in this league's own draft (overall pick number)."""
    try:
        d = [x for x in sget(f'/league/{lid}/drafts') if x.get('status') == 'complete']
        if not d: return {}
        picks = sget(f"/draft/{d[0]['draft_id']}/picks")
        return {p['player_id']: p['pick_no'] for p in picks if p.get('player_id')}
    except Exception:
        return {}

def rank_map(scores, scale):
    """Express a ranking (higher score = better) in the units of `scale` (our values) by matching ranks."""
    order = sorted(scores, key=lambda k: -scores[k]); ref = sorted(scale, reverse=True)
    return {k: ref[min(i, len(ref) - 1)] for i, k in enumerate(order)} if ref else {}

def build_sleeper(M, site, D, cov):
    user = sget(f'/user/{SLEEPER_USER}')
    me = user['user_id']
    leagues = sget(f'/user/{me}/leagues/nfl/{SEASON}')
    SP = sget('/players/nfl')
    rost = D['rost'].sort_values('week').drop_duplicates('gsis_id', keep='last')
    s2g = {str(int(x)) if isinstance(x, float) and not math.isnan(x) else str(x): g for x, g in zip(rost['sleeper_id'], rost['gsis_id']) if x is not None and str(x) not in ('nan', 'None')}
    for sid, p in SP.items():
        g = (p.get('gsis_id') or '').strip()
        if g and sid not in s2g: s2g[sid] = g
    site_ids = {p['id'] for p in site['players']}
    proj = M['proj']; nw = cov['nextWeek']
    played = {t for t, x in site['teams'].items() if not x['bye'] and x['next'] and nw and x['next']['w'] > nw}
    injured_out = {}
    for sid, p in SP.items():
        g = s2g.get(sid)
        if g and p.get('injury_status') in ('Out', 'IR', 'PUP', 'Sus'): injured_out[g] = p['injury_status']
    brk = X.breakouts(site, None, injured_out)
    players = {}
    out_leagues = []
    for l in leagues:
        lid = l['league_id']; st = l['settings']; sc = l['scoring_settings']; rp = l['roster_positions']
        R = sget(f'/league/{lid}/rosters'); U = {u['user_id']: u for u in sget(f'/league/{lid}/users')}
        try: traded = sget(f'/league/{lid}/traded_picks')
        except Exception: traded = []
        dyn = st.get('type') == 2
        slots = {k: rp.count(k) for k in ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN']}
        po = st.get('playoff_week_start') or 15
        scoring = {k: sc.get(k, 0) for k in ['rec', 'pass_td', 'pass_int', 'pass_yd', 'rush_yd', 'rush_td', 'rec_yd', 'rec_td', 'fum_lost', 'bonus_rec_te']}
        # ---- per-player values in this league
        rostered = {}
        teams = []
        for r in sorted(R, key=lambda r: r['roster_id']):
            u = U.get(r['owner_id'], {}); s = r['settings']
            t = {'rid': r['roster_id'], 'name': (u.get('metadata') or {}).get('team_name') or u.get('display_name') or f"Team {r['roster_id']}",
                 'owner': u.get('display_name') or '', 'me': r['owner_id'] == me or me in (r.get('co_owners') or []),
                 'w': s['wins'], 'l': s['losses'], 't': s.get('ties', 0), 'pf': round(s.get('fpts', 0) + s.get('fpts_decimal', 0) / 100, 2),
                 'starters': r.get('starters') or [], 'players': r.get('players') or [], 'ir': r.get('reserve') or [], 'taxi': r.get('taxi') or [],
                 'owner_id': r.get('owner_id'), 'faab_used': s.get('waiver_budget_used', 0), 'waiver_position': s.get('waiver_position')}
            teams.append(t)
            for pid in t['players']: rostered[pid] = t['rid']
        val = {}   # sleeper id -> dict
        for sid, sp in SP.items():
            pos = sp.get('position')
            if pos not in POS: continue
            g = s2g.get(sid)
            if not g or g not in proj: continue
            if not sp.get('team'): continue  # not on an NFL team right now
            p = proj[g]; inj = sp.get('injury_status')
            wk = p['weeks']; af = avail_factors(inj, len(wk))
            nxt = None; ros = 0.0; ros_w = 0.0; strip = []
            for i, w in enumerate(wk):
                pts = proj_components(p, w, scoring) * af[i]
                wt = PLAYOFF_WEIGHT if po <= w['w'] <= po + 2 else 1.0
                if w['w'] >= po + 3: wt = 0.0
                ros += pts * wt; ros_w += wt
                if w['w'] == nw: nxt = pts
                strip.append(round(pts, 1))
            ppg_actual = None
            val[sid] = dict(g=g, pos=pos, age=sp.get('age'), inj=inj, next=nxt, ros=ros, rw=ros_w, strip=strip, wk=[w['w'] for w in wk],
                            ppg=p['base'])
        # actual points per game in this league's scoring (from site data) for "how others see him"
        site_by = {p['id']: p for p in site['players']}
        for sid, v in val.items():
            sp_ = site_by.get(v['g'])
            repu = proj[v['g']].get('rep') or v['ppg']
            if sp_ and sp_['g'] >= 1:
                w_ = sp_['g'] / (sp_['g'] + 3.0); v['seen'] = w_ * sp_['ppr'] + (1 - w_) * repu
            else:
                v['seen'] = repu
        # replacement level by position (per week), league specific
        n = l['total_rosters']
        share = {'QB': slots['QB'] + 0.9 * slots['SUPER_FLEX'], 'RB': slots['RB'] + 0.45 * slots['FLEX'],
                 'WR': slots['WR'] + 0.45 * slots['FLEX'], 'TE': slots['TE'] + 0.1 * slots['FLEX']}
        repl = {}
        for pos in POS:
            arr = sorted([v['ros'] / max(v['rw'], 1) for v in val.values() if v['pos'] == pos], reverse=True)
            k = int(round(n * share[pos])); repl[pos] = arr[min(k, len(arr) - 1)] if arr else 0
        seenrepl = {}
        for pos in POS:
            arr = sorted([v['seen'] for v in val.values() if v['pos'] == pos], reverse=True)
            k = int(round(n * share[pos])); seenrepl[pos] = arr[min(k, len(arr) - 1)] if arr else 0
        for sid, v in val.items():
            per = v['ros'] / max(v['rw'], 1)
            v['vorp'] = (per - repl[v['pos']]) * v['rw']          # rest-of-season value above replacement (weighted weeks)
            v['seenv'] = (v['seen'] - seenrepl[v['pos']]) * v['rw']
            if dyn:
                age = v['age'] or 26
                curve = AGE_CURVE[v['pos']](age)
                fut = sum(max(0, per - repl[v['pos']]) * 17 * c * d for c, d in zip(curve, DISCOUNT))
                v['dyn'] = v['vorp'] + fut
                v['seendyn'] = v['seenv'] + sum(max(0, v['seen'] - seenrepl[v['pos']]) * 17 * c * d for c, d in zip(curve, DISCOUNT))
            v['tv'] = v['dyn'] if dyn else v['vorp']       # trade value (what it's really worth to you)
            v['pv'] = v['seendyn'] if dyn else v['seenv']  # perceived value (how the other manager sees it)
        # ---- market anchor: real-trade values plus this league's own draft capital
        fc = market_values(dyn, 2 if slots['SUPER_FLEX'] else 1, n, sc.get('rec', 1) or 0)
        dc = {} if dyn else draft_capital(lid)
        model_scale = [v['tv'] for v in val.values()]
        m_fc = rank_map({sid: fc[sid][0] for sid in val if sid in fc}, model_scale)
        m_dc = rank_map({sid: -dc[sid] for sid in val if sid in dc}, model_scale)
        weeks_done = max(0, (nw or 1) - 1)
        for sid, v in val.items():
            a, b = m_fc.get(sid), m_dc.get(sid)
            # draft capital fades as the season goes on; the trade market keeps moving
            wd = max(0.0, 0.35 - 0.03 * weeks_done) if b is not None else 0.0
            mk = (a * (1 - wd) + b * wd) if a is not None and b is not None else a if a is not None else None
            v['mkt'] = mk; v['fcr'] = fc.get(sid, (None, None))[1]; v['pick'] = dc.get(sid)
            if mk is not None:
                v['model'] = v['tv']
                v['tv'] = 0.7 * v['tv'] + 0.3 * mk     # our model, pulled 30% toward the market as a guard against blind spots
                v['pv'] = 0.65 * mk + 0.35 * v['pv']   # what managers really trade on: market value plus recent production
        # ---- dynasty picks
        picks = {}
        if dyn:
            seasons = [str(SEASON + 1), str(SEASON + 2)]
            rounds = st.get('draft_rounds') or 4
            own = {(s_, rd, t['rid']): t['rid'] for s_ in seasons for rd in range(1, rounds + 1) for t in teams}
            for tp in traded:
                key = (str(tp['season']), tp['round'], tp['roster_id'])
                if key in own: own[key] = tp['owner_id']
            ranked = sorted([v['tv'] for v in val.values()], reverse=True)
            anchor = {1: 36, 2: 72, 3: 110, 4: 150, 5: 190}
            for (s_, rd, orig), holder in own.items():
                base_v = ranked[min(int(anchor.get(rd, 200) * n / 12), len(ranked) - 1)] if ranked else 0
                v_ = max(base_v, 1.0) * (0.85 if s_ == seasons[1] else 1.0)
                pid = f'pick:{s_}:{rd}:{orig}'
                picks[pid] = {'season': s_, 'round': rd, 'orig': orig, 'holder': holder, 'tv': round(v_, 1), 'pv': round(v_ * 1.1, 1)}
        # ---- team needs (starter strength by position vs league average)
        lv = {sid: (v['pos'], v['ros']) for sid, v in val.items()}
        pos_strength = {}
        for t in teams:
            ids = [p for p in t['players'] if p in val]
            _, start = lineup_value(ids, lv, slots)
            ps = {}
            for pos in POS:
                starters = [val[s]['ros'] / max(val[s]['rw'], 1) for s in start if val[s]['pos'] == pos]
                depth = sorted([val[s]['ros'] / max(val[s]['rw'], 1) for s in ids if val[s]['pos'] == pos and s not in start], reverse=True)[:2]
                ps[pos] = {'start': sum(starters), 'n': len(starters), 'depth': sum(depth)}
            pos_strength[t['rid']] = ps
        needs = {}
        for pos in POS:
            arr = [pos_strength[t['rid']][pos]['start'] + 0.35 * pos_strength[t['rid']][pos]['depth'] for t in teams]
            mu, sd = float(np.mean(arr)), float(np.std(arr)) or 1.0
            for t in teams:
                x = pos_strength[t['rid']][pos]['start'] + 0.35 * pos_strength[t['rid']][pos]['depth']
                needs.setdefault(t['rid'], {})[pos] = round((x - mu) / sd, 2)
        for t in teams:
            t['needs'] = needs[t['rid']]
            t['strength'] = {pos: round(pos_strength[t['rid']][pos]['start'], 1) for pos in POS}
        # ---- weekly outlook, season simulation, playoff odds
        reg_end = po - 1
        weeks = list(range(nw, reg_end + 1)) if nw and nw <= reg_end else []
        schedule = {}; cur_matchups = []
        for w in weeks:
            try: mu = sget(f'/league/{lid}/matchups/{w}')
            except Exception: mu = []
            if w == nw: cur_matchups = mu
            pr_ = {}
            for m in mu or []:
                if m.get('matchup_id') is not None: pr_.setdefault(m['matchup_id'], []).append(m['roster_id'])
            if pr_: schedule[w] = [tuple(v) for v in pr_.values() if len(v) == 2]
        cache = {w: X.week_points(val, w) for w in schedule}
        tw = X.team_weeks(teams, cache, slots)
        lineup_slots = [x for x in rp if x not in ('BN', 'IR')]
        wk_res, live = X.this_week(teams, val, slots, lineup_slots, nw, cur_matchups, played, SP)
        n_po = st.get('playoff_teams') or 6
        odds = X.simulate(teams, schedule, tw, n_po, nw, live) if schedule else {}
        for t in teams:
            if t['rid'] in odds: t['odds'] = round(odds[t['rid']]['odds'], 3); t['projW'] = round(odds[t['rid']]['wins'], 1); t['projRank'] = round(odds[t['rid']]['rank'], 1)
            if wk_res and t['rid'] in wk_res: t['week'] = wk_res[t['rid']]
        labels = X.dynasty_labels(teams, odds, val) if dyn else {}
        for t in teams:
            if t['rid'] in labels: t['mode'] = labels[t['rid']]
        if dyn and odds:
            order = sorted(teams, key=lambda t: -odds[t['rid']]['rank'])  # worst projected finish picks first
            slot_of = {t['rid']: i for i, t in enumerate(order)}
            for k, pk in picks.items():
                if pk['season'] == str(SEASON + 1) and pk['orig'] in slot_of:
                    f = 1.3 - 0.6 * slot_of[pk['orig']] / max(1, n - 1)
                    pk['tv'] = round(pk['tv'] * f, 1); pk['pv'] = round(pk['pv'] * f, 1); pk['slot'] = slot_of[pk['orig']] + 1
        # ---- manager profiles
        try: prof = X.profiles(lid, teams, sget, SP, nw or 1)
        except Exception: prof = {}
        for t in teams:
            pr_ = prof.get(t['owner_id'])
            if pr_: t['prof'] = {'trades': pr_['trades'], 'tradesNow': pr_['trades_now'], 'adds': pr_['adds'], 'tags': pr_['tags'], 'bought': pr_['bought']}
        # ---- trade offers for my team
        offers = find_offers(teams, val, picks, slots, dyn, labels)
        for o in offers:
            tags = (next(t for t in teams if t['rid'] == o['to']).get('prof') or {}).get('tags', [])
            if 'Active trader' in tags: o['score'] = round(o['score'] * 1.15, 2)
            if 'Rarely trades' in tags: o['score'] = round(o['score'] * 0.8, 2)
        offers.sort(key=lambda o: -o['score'])
        meT = next((t for t in teams if t['me']), None)
        if schedule and meT:
            for o in offers[:12]:
                tt = next(t for t in teams if t['rid'] == o['to'])
                g_ = [x for x in o['give'] if not x.startswith('pick:')]
                mine = [x for x in meT['players'] if x not in g_ and x not in meT['ir'] and x not in meT['taxi']] + o['get']
                theirs = [x for x in tt['players'] if x not in o['get'] and x not in tt['ir'] and x not in tt['taxi']] + g_
                tw2 = dict(tw); tw2.update(X.team_weeks(teams, cache, slots, {meT['rid']: mine, tt['rid']: theirs}))
                o2 = X.simulate(teams, schedule, tw2, n_po, nw, live)
                o['po'] = [round(odds[meT['rid']]['odds'], 3), round(o2[meT['rid']]['odds'], 3), round(odds[tt['rid']]['odds'], 3), round(o2[tt['rid']]['odds'], 3)]
        # ---- waivers, age cliffs, alerts
        wv = X.waiver_advice(l, teams, val, slots, rostered, meT, len(weeks), dyn, st.get('waiver_budget'), st.get('waiver_type'), lineup_value, needs) if meT else None
        cliffs = X.cliff_warnings(meT, val) if (dyn and meT) else []
        alerts = league_alerts(l['name'], meT, wk_res, val, SP, site, wv, brk, rostered, s2g, nw, lineup_slots)
        for sid in set(rostered) | set(val) | {k for k, g in s2g.items() if g in {b['id'] for b in brk}}:
            if sid in SP and sid not in players:
                sp = SP[sid]
                players[sid] = {'n': sp.get('full_name') or (f"{sid} defense" if sid.isalpha() else sid), 'pos': sp.get('position') or ('DEF' if sid.isalpha() else None),
                                'tm': sp.get('team') or 'FA', 'sid': s2g.get(sid) if s2g.get(sid) in site_ids else None, 'mid': s2g.get(sid) if s2g.get(sid) in proj else None,
                                'inj': sp.get('injury_status'), 'age': sp.get('age'), 'yrs': sp.get('years_exp')}
            elif sid.isalpha() and sid not in players:
                players[sid] = {'n': f'{sid} defense', 'pos': 'DEF', 'tm': sid, 'sid': None, 'mid': None}
        vout = {sid: [r1(v['next']), r1(v['ros'], 1), r1(v['tv'], 1), r1(v['pv'], 1), r1(v.get('mkt'), 1), v.get('fcr'), v.get('pick')] for sid, v in val.items() if sid in rostered or (v['tv'] or 0) > -40}
        out_leagues.append({'id': lid, 'name': l['name'], 'type': 'dynasty' if dyn else 'redraft', 'size': n,
                            'lineup': [x for x in rp if x not in ('BN', 'IR')], 'slots': slots, 'ir': st.get('reserve_slots', 0), 'taxi': st.get('taxi_slots', 0),
                            'scoring': {'rec': sc.get('rec', 0), 'pass_td': sc.get('pass_td', 4), 'pass_int': sc.get('pass_int', -1), 'te_bonus': sc.get('bonus_rec_te', 0),
                                        'pass_yd': sc.get('pass_yd', 0.04), 'fum_lost': sc.get('fum_lost', -2)},
                            'faab': st.get('waiver_budget'), 'playoffStart': po, 'playoffTeams': st.get('playoff_teams'),
                            'teams': teams, 'vals': vout, 'picks': picks, 'offers': offers, 'waivers': wv, 'cliffs': cliffs, 'alerts': alerts,
                            'waiverType': st.get('waiver_type'), 'sim': {'weeks': sorted(schedule), 'schedule': {str(w): v for w, v in schedule.items()}, 'tw': {str(r): {str(w): [round(a, 1), round(b, 1)] for w, (a, b) in x.items()} for r, x in tw.items()}, 'live': {str(r): [round(a, 1), round(b, 1)] for r, (a, b) in (live or {}).items()}, 'playoffTeams': n_po}})
    for b in brk:
        b['sids'] = [k for k, g in s2g.items() if g == b['id']][:1]
    return {'user': SLEEPER_USER, 'pulled': datetime.date.today().isoformat(), 'week': nw, 'breakouts': brk, 'valueKey': ['next', 'ros', 'tv', 'pv', 'mkt', 'marketRank', 'draftPick'],
            'leagues': out_leagues, 'players': players}

def adj_pv(v, mode):
    """How a contender or rebuilding manager values a player differently by age (dynasty only)."""
    p, age = v['pv'], v.get('age') or 26
    if p <= 0 or not mode: return p
    if mode == 'Rebuilding': return p * (0.75 if age >= 28 else 1.15 if age <= 24 else 1.0)
    if mode == 'Contender': return p * (1.1 if age >= 27 else 0.9 if age <= 23 else 1.0)
    return p

SLOT_OK = {'QB': ('QB',), 'RB': ('RB',), 'WR': ('WR',), 'TE': ('TE',), 'FLEX': ('RB', 'WR', 'TE'), 'SUPER_FLEX': ('QB', 'RB', 'WR', 'TE')}
def league_alerts(lname, me, wk_res, val, SP, site, wv, brk, rostered, s2g, nw, lineup_slots):
    out = []
    if not me: return out
    nm = lambda sid: (SP.get(sid) or {}).get('full_name') or sid
    rows = (wk_res or {}).get(me['rid'], {}).get('rows', [])
    bench = [s for s in me['players'] if s not in me['starters'] and s not in me['ir'] and s not in me['taxi'] and s in val and val[s]['next'] is not None]
    used = set()
    for slot, sid, p, f, c, kind in rows:
        if kind == 'empty':
            out.append({'lvl': 'high', 'text': f'Empty {slot} slot in your lineup.'}); continue
        if kind == 'final' or not sid: continue
        sp = SP.get(sid) or {}; inj = sp.get('injury_status'); team = sp.get('team')
        if inj in ('Out', 'IR', 'Doubtful', 'Sus', 'PUP'):
            out.append({'lvl': 'high', 'text': f'{nm(sid)} is {inj} but starting at {slot}.'})
        elif team and site['teams'].get(team, {}).get('bye'):
            out.append({'lvl': 'high', 'text': f'{nm(sid)} is on bye but starting at {slot}.'})
        if slot in SLOT_OK and kind == 'proj':
            cands = [b for b in bench if b not in used and val[b]['pos'] in SLOT_OK[slot] and (val[b]['next'] or 0) >= (p or 0) + 3]
            if cands:
                b = max(cands, key=lambda x: val[x]['next']); used.add(b)
                out.append({'lvl': 'med', 'text': f'Start {nm(b)} ({val[b]["next"]:.1f}) over {nm(sid)} ({p:.1f}) at {slot}.'})
    if wv and wv.get('adds'):
        a = wv['adds'][0]
        if a['gain'] >= 25 or (a['value'] >= 80 and a['gain'] >= 5):
            bid = f" Suggested bid ${a['bid']}." if a.get('bid') is not None else ''
            out.append({'lvl': 'med', 'text': f"Waiver target: {nm(a['add'])}, worth about {a['gain']:.0f} rest-of-season points to your lineup{(' over ' + nm(a['drop'])) if a.get('drop') else ''}.{bid}"})
    shown = 0
    for b in brk:
        if shown >= 2: break
        sids = [k for k, g in s2g.items() if g == b['id']]
        if sids and sids[0] not in rostered and sids[0] in val and val[sids[0]]['ros'] > 80:
            shown += 1
            out.append({'lvl': 'low', 'text': f"Available breakout: {nm(sids[0])}. {b['text'][0].upper() + b['text'][1:]}."})
    return out[:8]

def find_offers(teams, val, picks, slots, dyn, labels=None, max_per_team=3, max_total=12):
    """Offers from my team to each other team: I should gain lineup value (rest of season, or dynasty value),
    they should gain lineup value too or at least see more perceived value than they give up."""
    me = next((t for t in teams if t['me']), None)
    if not me: return []
    ros = {sid: (v['pos'], v['ros']) for sid, v in val.items()}
    tv = {sid: v['tv'] for sid, v in val.items()}; pv = {sid: v['pv'] for sid, v in val.items()}
    def team_value(ids):
        lv, _ = lineup_value(ids, ros, slots)
        return lv
    my_ids = [p for p in me['players'] if p in val]
    my_base = team_value(my_ids)
    my_tradable = sorted(my_ids, key=lambda s: -tv[s])[:18]
    my_picks = [k for k, p in picks.items() if p['holder'] == me['rid']]
    out = []
    for t in teams:
        if t['me']: continue
        th = [p for p in t['players'] if p in val]
        t_base = team_value(th)
        mode = ((labels or {}).get(t['rid']) or {}).get('mode')
        tpv = {sid: adj_pv(val[sid], mode) for sid in set(th) | set(my_ids)}
        their = sorted(th, key=lambda s: -tv[s])[:16]
        cands = []
        gives = [(a,) for a in my_tradable] + [c for c in itertools.combinations(my_tradable[:14], 2)]
        for g in gives:
            for rcv in their:
                gl = list(g)
                if any(val[x]['pos'] == val[rcv]['pos'] for x in gl) and len(gl) == 1 and abs(tv[gl[0]] - tv[rcv]) < 1:
                    continue
                mine_after = [x for x in my_ids if x not in gl] + [rcv]
                their_after = [x for x in th if x != rcv] + gl
                my_gain = team_value(mine_after) - my_base
                their_gain = team_value(their_after) - t_base
                my_tv_gain = tv[rcv] - sum(tv[x] for x in gl)
                pv_them = sum(tpv[x] for x in gl) - tpv[rcv]
                pick_add = None
                if dyn and pv_them < 0 and my_picks:
                    need = -pv_them
                    ok = sorted([k for k in my_picks if picks[k]['pv'] >= need], key=lambda k: picks[k]['tv'])
                    if ok:
                        pick_add = ok[0]; pv_them += picks[pick_add]['pv']; my_tv_gain -= picks[pick_add]['tv']
                if len(gl) == 2 and (min(tpv[x] for x in gl) <= 0 or pick_add):
                    continue
                mk = lambda ids: (lambda a: a[0] + sum(max(0, x) for x in a[1:]) if a else 0)(sorted([val[x].get('mkt') if val[x].get('mkt') is not None else val[x]['tv'] for x in ids], reverse=True))
                if mk([rcv]) < 0.85 * mk([x for x in gl]):
                    continue  # would sell below market
                good_for_me = (my_gain > 4 and my_tv_gain > -10) if not dyn else (my_tv_gain > 5 and my_gain > -3)
                acceptable = pv_them >= -3 and their_gain > -6
                if good_for_me and acceptable:
                    s = my_gain + (0.5 * my_tv_gain if dyn else 0.2 * my_tv_gain) + 0.3 * max(0, their_gain) - 0.5 * max(0, -pv_them)
                    cands.append(dict(to=t['rid'], give=gl + ([pick_add] if pick_add else []), get=[rcv], myGain=round(my_gain, 1), theirGain=round(their_gain, 1),
                                      myValue=round(my_tv_gain, 1), theirSeen=round(pv_them, 1), score=round(s, 2)))
        singles = {c['get'][0] for c in cands if len([x for x in c['give'] if not x.startswith('pick')]) == 1}
        cands = [c for c in cands if len([x for x in c['give'] if not x.startswith('pick')]) == 1 or c['get'][0] not in singles]
        cands.sort(key=lambda c: -c['score'])
        seen = set(); picked = []
        for c in cands:
            key = c['get'][0]
            if key in seen: continue
            seen.add(key); picked.append(c)
            if len(picked) >= max_per_team: break
        out += picked
    out.sort(key=lambda c: -c['score'])
    return out[:max_total * 2]

# ---------------------------------------------------------------- page patch
def read_block(html_path, tag):
    try:
        s = open(html_path, encoding='utf-8').read()
        m = re.search(r'<script id="' + tag + r'" type="application/json">(.*?)</script>', s, re.S)
        return json.loads(m.group(1).replace('<\\/', '</')) if m else None
    except Exception:
        return None

def patch(html_path, site, match, sleeper, hist=None):
    s = open(html_path, encoding='utf-8').read()
    # a page read back from the artifact service carries the publish skeleton; strip it so it isn't wrapped twice
    if s.lstrip().lower().startswith('<!doctype') and '<body>' in s[:3000]:
        s = s[s.index('<body>') + len('<body>'):].lstrip('\n')
        for tail in ('</body></html>', '</body>\n</html>', '</html>', '</body>'):
            if s.rstrip().endswith(tail): s = s.rstrip()[:-len(tail)]
    def put(s, tag, data):
        js = json.dumps(data, separators=(',', ':'), allow_nan=False).replace('</', '<\\/')
        pat = re.compile(r'(<script id="' + tag + r'" type="application/json">)(.*?)(</script>)', re.S)
        if pat.search(s):
            return pat.sub(lambda m: m.group(1) + js + m.group(3), s, count=1)
        marker = '<script>\n(function(){'
        assert marker in s, 'script marker not found'
        return s.replace(marker, f'<script id="{tag}" type="application/json">{js}</script>\n' + marker, 1)
    s = put(s, 'site-data', site); s = put(s, 'matchup-data', match); s = put(s, 'sleeper-data', sleeper)
    if hist is not None: s = put(s, 'history-data', hist)
    open(html_path, 'w', encoding='utf-8').write(s)

def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    if isinstance(o, float): return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, (np.floating,)): return clean(float(o))
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    return o

def main():
    D = load()
    cov, games = schedule_info(D['sched'])
    site = clean(build_site(D, cov, games))
    M = clean(build_matchups(D, site, games, cov))
    M_full = {k: dict(v, weeks=[dict(w) for w in v['weeks']]) for k, v in M['proj'].items()}
    SL = clean(build_sleeper(M, site, D, cov))
    # drop heavy detail not needed in the page
    keep = set()
    for L in SL['leagues']:
        for t in L['teams']:
            for sid in t['players']:
                m = SL['players'].get(sid, {}).get('mid')
                if m: keep.add(m)
        for sid in L['vals']:
            m = SL['players'].get(sid, {}).get('mid')
            if m: keep.add(m)
    keep |= {p['id'] for p in site['players'] if p['q']}
    M['proj'] = {k: v for k, v in M['proj'].items() if k in keep}
    for p in M['proj'].values():
        p['why'] = p['weeks'][0]['why'] if p['weeks'] else []
        p['weeks'] = [[w['w'], w['opp'], 1 if w['home'] else 0, w['rm'], w['cm']] for w in p['weeks']]
    # live accuracy log, carried forward inside the page
    hist = {}
    if '--patch' in sys.argv:
        hist = read_block(sys.argv[sys.argv.index('--patch') + 1], 'history-data') or {}
    _, a_all = comp_rows(D['ffo'])
    actual = {(r.player_id, int(r.week)): score({k: getattr(r, k) for k in COMP}, STD_SCORING) for r in a_all.itertuples()}
    played = {t for t, x in site['teams'].items() if not x['bye'] and x['next'] and cov['nextWeek'] and x['next']['w'] > cov['nextWeek']}
    hist = X.update_history(hist, M_full, cov['nextWeek'], played, lambda p, w: proj_components(p, w, STD_SCORING), actual)
    try: hist['backtest'] = json.load(open(f'backtest_{PRIOR}.json'))
    except Exception: pass
    hist = clean(hist)
    alerts = [dict(a, league=L['name']) for L in SL['leagues'] for a in L.get('alerts', [])]
    json.dump(alerts, open('alerts.json', 'w'), indent=1)
    for n, obj in (('site.json', site), ('matchup.json', M), ('sleeper.json', SL), ('history.json', hist)):
        json.dump(obj, open(n, 'w'), separators=(',', ':'), allow_nan=False)
    if '--patch' in sys.argv:
        patch(sys.argv[sys.argv.index('--patch') + 1], site, M, SL, hist)
    print('ok', cov, len(site['players']), 'players;', len(M['proj']), 'projections;', len(SL['leagues']), 'leagues;', len(alerts), 'alerts')
    for a in alerts: print('ALERT', a['lvl'], '|', a['league'], '|', a['text'])

if __name__ == '__main__':
    main()

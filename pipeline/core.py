#!/usr/bin/env python3
"""Daily data build for the Fantasy Luck Lab website.

Builds everything that is the same for every visitor and writes docs/data/core.json:
  site   : luck board (usage vs actual) and team schedule / defense vs position
  mx     : matchup model and per-game projections for every player (league scoring is applied in the browser)
  pl     : Sleeper player list (name, position, team, nflverse id, injury, age)
  fc     : trade market values (FantasyCalc) for common league formats
  brk    : breakouts
  hist   : live accuracy log + 2025 backtest summary

League-specific work (rosters, values, trades, playoff odds) happens in the browser in league.js,
using the visitor's Sleeper username. Run from the repo root:  python3 pipeline/core.py
"""
import os, sys, json, math, datetime, requests
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build, extras as X

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'docs', 'data')
os.makedirs(OUT, exist_ok=True)

def main():
    D = build.load()
    cov, games = build.schedule_info(D['sched'])
    site = build.clean(build.build_site(D, cov, games))
    M = build.clean(build.build_matchups(D, site, games, cov))
    nw = cov['nextWeek']

    # ---- Sleeper players and id mapping
    SP = build.sget('/players/nfl')
    rost = D['rost'].sort_values('week').drop_duplicates('gsis_id', keep='last')
    s2g = {}
    for x, g in zip(rost['sleeper_id'], rost['gsis_id']):
        if x is None or str(x) in ('nan', 'None'): continue
        s2g[str(int(x)) if isinstance(x, float) else str(x)] = g
    for sid, p in SP.items():
        g = (p.get('gsis_id') or '').strip()
        if g and sid not in s2g: s2g[sid] = g
    pl = {}
    for sid, p in SP.items():
        pos = p.get('position')
        if pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'): continue
        g = s2g.get(sid)
        g = g if g in M['proj'] else None
        if not p.get('team') and not g and not p.get('active'): continue
        name = p.get('full_name') or (f"{sid} defense" if pos == 'DEF' else ' '.join(filter(None, [p.get('first_name'), p.get('last_name')])) or sid)
        pl[sid] = [name, pos, p.get('team'), g, p.get('injury_status'), p.get('age'), p.get('years_exp')]

    # ---- breakouts
    injured_out = {}
    for sid, p in SP.items():
        g = s2g.get(sid)
        if g and p.get('injury_status') in ('Out', 'IR', 'PUP', 'Sus'): injured_out[g] = p['injury_status']
    brk = X.breakouts(site, None, injured_out)
    g2s = {}
    for k, g in s2g.items(): g2s.setdefault(g, k)
    for b in brk: b['sids'] = [g2s[b['id']]] if b['id'] in g2s else []

    # ---- trade market values for common formats
    fc = {}
    for dyn in (False, True):
        for qbs in (1, 2):
            for teams in (10, 12, 14):
                for ppr in (0, 0.5, 1):
                    v = build.market_values(dyn, qbs, teams, ppr)
                    fc[f"{int(dyn)}-{qbs}-{teams}-{ppr}"] = {k: [round(a), r] for k, (a, r) in v.items()}

    # ---- live accuracy log (kept in docs/data/history.json between runs)
    hpath = os.path.join(OUT, 'history.json')
    hist = json.load(open(hpath)) if os.path.exists(hpath) else {}
    _, a_all = build.comp_rows(D['ffo'])
    actual = {(r.player_id, int(r.week)): build.score({k: getattr(r, k) for k in build.COMP}, build.STD_SCORING) for r in a_all.itertuples()}
    played = {t for t, x in site['teams'].items() if not x['bye'] and x['next'] and nw and x['next']['w'] > nw}
    M_full = {k: dict(v, weeks=[dict(w) for w in v['weeks']]) for k, v in M['proj'].items()}
    hist = X.update_history(hist, M_full, nw, played, lambda p, w: build.proj_components(p, w, build.STD_SCORING), actual)
    try: hist['backtest'] = json.load(open(os.path.join(HERE, 'backtest_2025.json')))
    except Exception: pass
    hist = build.clean(hist)
    json.dump(hist, open(hpath, 'w'), separators=(',', ':'))

    # ---- compact projections for the browser
    for p in M['proj'].values():
        p['why'] = p['weeks'][0]['why'] if p['weeks'] else []
        p['weeks'] = [[w['w'], w['opp'], 1 if w['home'] else 0, w['rm'], w['cm']] for w in p['weeks']]
    M['proj'] = {k: v for k, v in M['proj'].items() if v['base'] >= 2 or k in {q['id'] for q in site['players']}}

    core = {'generated': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ'), 'season': build.SEASON, 'cov': cov,
            'site': site, 'mx': M, 'pl': pl, 'fc': fc, 'brk': brk,
            'hist': {'results': hist.get('results', {}), 'backtest': hist.get('backtest')}}
    json.dump(build.clean(core), open(os.path.join(OUT, 'core.json'), 'w'), separators=(',', ':'), allow_nan=False)
    print('ok', cov, len(site['players']), 'players;', len(M['proj']), 'projections;', len(pl), 'sleeper players;', os.path.getsize(os.path.join(OUT, 'core.json')) // 1024, 'KB')

if __name__ == '__main__':
    main()

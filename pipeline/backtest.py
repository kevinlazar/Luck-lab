#!/usr/bin/env python3
"""Backtest the Luck Lab projection model on a finished season.

For each week W, rebuild projections using only data from before week W (plus the prior season),
then compare with what actually happened in week W. Also tests how strong the matchup adjustment
should be (K = 0 means ignore matchups, K = 1 is the current model, K = 2 doubles it).

Usage: python3 backtest.py 2025   -> writes backtest_2025.json
"""
import sys, json, math, copy
import numpy as np, pandas as pd
import build

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
build.SEASON, build.PRIOR = SEASON, SEASON - 1
build.ALLOW_ALL_STATUS = True
build.MATCH_K = 1.0  # test raw strengths; K is applied below
KS = [0.0, 0.5, 1.0, 1.5, 2.0]

def cut(D, W):
    Dw = dict(D)
    for k in ('pbp', 'ffo', 'stats'):
        Dw[k] = D[k][D[k]['week'] < W]
    Dw['snaps'] = D['snaps'][D['snaps']['week'] < W]
    Dw['rost'] = D['rost']
    Dw['inj'] = pd.DataFrame()
    s = D['sched'].copy()
    s.loc[s['week'] >= W, ['home_score', 'away_score']] = np.nan
    Dw['sched'] = s
    return Dw

def main():
    D = build.load()
    e_all, a_all = build.comp_rows(D['ffo'])
    actual = {(r.player_id, int(r.week)): build.score({k: getattr(r, k) for k in build.COMP}, build.STD_SCORING) for r in a_all.itertuples()}
    rows = []
    last = int(D['ffo']['week'].max())
    for W in range(3, last + 1):
        Dw = cut(D, W)
        cov, games = build.schedule_info(Dw['sched'])
        site = build.clean(build.build_site(Dw, cov, games))
        M = build.build_matchups(Dw, site, games, cov)
        prior_ppg = Dw['ffo'].groupby('player_id')['total_fantasy_points'].mean().to_dict()
        for pid, p in M['proj'].items():
            wk = [w for w in p['weeks'] if w['w'] == W]
            if not wk or (pid, W) not in actual: continue
            w = wk[0]
            if p['base'] < 5: continue
            row = dict(pid=pid, pos=p['pos'], week=W, base=p['base'], act=actual[(pid, W)], ppg=prior_ppg.get(pid),
                       m=build.combM(p['pos'], w['rm'], w['cm']) if hasattr(build, 'combM') else None)
            for K in KS:
                ww = dict(w); ww['rm'] = w['rm'] ** K; ww['cm'] = w['cm'] ** K
                row[f'k{K}'] = build.proj_components(p, ww, build.STD_SCORING)
            rows.append(row)
        print('week', W, 'rows', len(rows), flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(f'backtest_{SEASON}_rows.csv', index=False)
    out = {'season': SEASON, 'weeks': [3, last], 'n': int(len(df)), 'byK': {}, 'baseline': {}}
    def pairs(col, d):
        # start/sit accuracy: for every pair at the same position in the same week, did the higher projection score more?
        ok = tot = 0
        for (wk, pos), g in d.groupby(['week', 'pos']):
            v = g[[col, 'act']].to_numpy()
            if len(v) < 2: continue
            i, j = np.triu_indices(len(v), 1)
            dp = v[i, 0] - v[j, 0]; da = v[i, 1] - v[j, 1]
            m = (np.abs(dp) >= 1.0) & (da != 0)
            ok += int(((dp[m] > 0) == (da[m] > 0)).sum()); tot += int(m.sum())
        return ok / tot if tot else None
    for K in KS:
        c = f'k{K}'
        out['byK'][str(K)] = {'mae': float((df[c] - df['act']).abs().mean()), 'corr': float(df[[c, 'act']].corr().iloc[0, 1]), 'pairs': pairs(c, df)}
    b = df[df['ppg'].notna()].copy()
    out['baseline'] = {'label': 'Season-to-date points per game', 'n': int(len(b)),
                       'mae': float((b['ppg'] - b['act']).abs().mean()), 'corr': float(b[['ppg', 'act']].corr().iloc[0, 1]), 'pairs': pairs('ppg', b),
                       'model_mae_same_rows': float((b['k1.0'] - b['act']).abs().mean()), 'model_pairs_same_rows': pairs('k1.0', b)}
    best = min(KS, key=lambda K: out['byK'][str(K)]['mae'])
    out['bestK'] = best
    # grade calibration: actual / usage baseline, by matchup grade
    g = df.dropna(subset=['m']).copy()
    g['grade'] = pd.cut(g['m'], [0, 0.9, 0.965, 1.035, 1.1, 9], labels=['F', 'D', 'C', 'B', 'A'])
    cal = g.groupby('grade', observed=True).apply(lambda x: pd.Series({'n': len(x), 'ratio': float(x['act'].sum() / x['base'].sum()), 'avg_act': float(x['act'].mean()), 'avg_base': float(x['base'].mean())}))
    out['grades'] = {str(k): {kk: (float(vv) if kk != 'n' else int(vv)) for kk, vv in v.items()} for k, v in cal.to_dict('index').items()}
    by_pos = {}
    for pos, x in df.groupby('pos'):
        by_pos[pos] = {'n': int(len(x)), 'mae_model': float((x['k1.0'] - x['act']).abs().mean()), 'mae_nomatch': float((x['k0.0'] - x['act']).abs().mean())}
    out['byPos'] = by_pos
    json.dump(out, open(f'backtest_{SEASON}.json', 'w'), indent=1)
    print(json.dumps(out, indent=1))

if __name__ == '__main__':
    main()

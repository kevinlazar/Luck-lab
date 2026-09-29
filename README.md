# Fantasy Luck Lab

Fantasy football analytics for Sleeper leagues: luck (actual vs expected points), matchup-based
projections, win chances, playoff odds, waiver and FAAB advice, trade partners and trade finder.

## How it works
- `pipeline/core.py` pulls free NFL data (nflverse), Sleeper's player list and FantasyCalc trade values,
  and writes `docs/data/core.json`. GitHub Actions runs it automatically (see `.github/workflows/daily.yml`).
- `docs/` is the website (GitHub Pages). When someone types their Sleeper username, `docs/league.js`
  loads their leagues live from Sleeper and computes everything for their leagues in the browser.
- Nothing is stored about visitors. The username is remembered only in their own browser.

## Share it
Send friends the site link. They type their Sleeper username (not their display name).
You can also send a link that loads a user directly: `https://YOURNAME.github.io/luck-lab/?u=theirusername`

## Manual refresh
GitHub → Actions → "Update data" → "Run workflow".

## Run the data build yourself
    pip install -r pipeline/requirements.txt
    python pipeline/core.py

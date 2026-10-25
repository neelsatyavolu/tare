# Political-lean data for news outlets: open datasets, thresholds, RSS lists

Researched 2026-10-25 for Tare. Every URL below was opened during the research, and every license was read from the hosting repository's own metadata (Harvard Dataverse API, Zenodo API, GitHub API, OSF API) or from the provider's own page. Numbers such as row counts, column names, correlations and quantiles were computed from the downloaded files, not copied from the papers.

## Summary

- **Use two CC0 datasets together.**
  1. **Eady, Bonneau, Tucker & Nagler (2025), *Political Analysis*.** 184 national US news domains, CC0 1.0, scored from Twitter sharing by members of the 116th Congress and ordinary users (about 2017 to 2020). Each score comes with a 90% credible interval. These are the cleanest numbers for the outlets that matter most.
  2. **Robertson et al. (2018), CSCW.** 19,022 domains, CC0 1.0 on Harvard Dataverse, scored from the sharing of about 500k Twitter users matched to voter records (2017). This covers the long tail: regional papers, small partisan sites and international outlets. One caveat: the description text says "for research purposes only", which conflicts with the CC0 license field. Get a one-line confirmation from the author (see 1.1).
- **Put Robertson on Eady's scale.** On the 175 domains the two share, Pearson r = 0.93 and Spearman ρ = 0.92. A linear fit gives `robertson = -0.081 + 0.401 * zeta`.
- **Five buckets on Eady's scale (zeta).** The cut-points come from the gap between the median Democratic and median Republican member of Congress on the same scale (0.98 − (−0.26) = 1.24):
  - left: zeta < −1.24
  - lean left: −1.24 to −0.62
  - center: −0.62 to +0.62
  - lean right: +0.62 to +1.24
  - right: > +1.24

  In Robertson units these become −0.58, −0.33, +0.17 and +0.42.
- **Proprietary ratings cannot be used for a public product that may make money.** AllSides is CC BY-NC 4.0, and commercial use needs a license agreement. MBFC states its numeric scores are proprietary. Pew's survey-dataset license allows only excerpts. DomainDemo (2025, 129k domains) has no license, so it is "all rights reserved" by default and good only for internal validation until the authors grant one.
- **Caveat on every score here.** These measure *who shares an outlet* (audience partisanship), not the outlet's content slant. The authors of both main datasets say so explicitly. Label it that way in the UI, for example "audience lean", or "lean (audience-based)".

---

## 1. Datasets, verified one by one

### 1.1 Robertson et al. 2018: "Partisan Bias Scores for Web Domains" (recommended for coverage)

| Field | Value |
|---|---|
| Paper | Robertson, Jiang, Joseph, Friedland, Lazer & Wilson, "Auditing Partisan Audience Bias within Google Search", *Proc. ACM HCI* 2(CSCW) 148, 2018. https://doi.org/10.1145/3274417 |
| What it measures | Partisan *audience* bias. `score = (r_i/Σr − d_i/Σd) / (r_i/Σr + d_i/Σd)`, where r_i and d_i are shares of domain i by Twitter accounts matched to registered Republicans and Democrats (about 500k accounts). The range is −1 (shared only by Democrats) to +1 (only by Republicans). Domains shared by fewer than 50 unique accounts are excluded. |
| Data year | Tweets from the 2017 panel collection. The scores were published in Nov 2018 and have never been updated. |
| Domains | **19,022** (counted in the file). |
| Canonical download (CC0) | Dataset page: https://doi.org/10.7910/DVN/QAN5VX. Direct file (original CSV): `https://dataverse.harvard.edu/api/access/datafile/3316961?format=original` (`bias_scores.tab`, 602 KB) |
| Columns (Dataverse file) | `domain, score, fb_score, mturk_score, budak_score, allsides_score, allsides_score_community, pew_score` |
| Mirror (GitHub) | https://raw.githubusercontent.com/gitronald/domains/master/data/bias_scores/bias_scores.csv. This copy adds `rounded_n_shares, rounded_n_accts` (share and account counts rounded to 100), which are useful as a reliability weight. |
| Enriched mirror | https://raw.githubusercontent.com/gitronald/domains/master/data/domains.tsv (31,909 rows, 19,014 with `bias_score`). Adds `news_is_news` flags (1,935 scored domains are flagged as news) and Grinberg et al. fake-news colors. |
| License | **Dataverse metadata: "CC0 1.0"** (SPDX `CC0-1.0`). The GitHub repo has *no* LICENSE file (the GitHub license API returns 404). **Conflict:** the README text on both Dataverse and GitHub says "We provide our scores below for research purposes only." |
| License verdict | The formal grant is CC0 on the canonical Dataverse record. The "research purposes only" line is a request inside the description, not a license term. Still, the two contradict each other. **Before shipping, email Ronald Robertson (the Dataverse record lists him at Northeastern University; check his current affiliation) and ask him to confirm that CC0 applies to use in an MIT-licensed news site.** Keep the reply in the repo. Until then, take the file from Dataverse (the CC0 copy), not from the unlicensed GitHub mirror. |

Weaknesses:
- **Old data.** It is from 2017 Twitter, before the platform became X. Outlets founded later (Semafor, The Free Press, Puck, and others) are missing.
- **Zero is not neutral.** The authors say so in Robertson et al. 2023 (*Nature*): "A score of zero does not imply neutrality in the scores we used, so left-of-zero scores do not imply a left-leaning bias" (https://www.nature.com/articles/s41586-023-06078-5, Extended Data Fig. 1). Mainstream outlets sit left of zero: NYT −0.26, Reuters −0.13, AP −0.33, WSJ +0.01, Fox +0.61. Hence the recentering in section 2.
- **It measures sharing, not content.** It mixes in topic effects: outlets covering issues one party cares about more get pushed that way.
- **The validation columns include third-party data you cannot reuse.** Drop `allsides_score`, `allsides_score_community` and `pew_score` when you ingest. The CC0 on the Dataverse record cannot relicense AllSides' CC BY-NC data. Keep only `domain, score` and the rounded counts.

### 1.2 Eady, Bonneau, Tucker & Nagler 2025: news-domain "media scores" (recommended as the anchor)

| Field | Value |
|---|---|
| Paper | "News Sharing on Social Media: Mapping the Ideology of News Media, Politicians, and the Mass Public", *Political Analysis* 33(2):73–90, 2025. https://doi.org/10.1017/pan.2024.19 (https://www.cambridge.org/core/journals/political-analysis/article/news-sharing-on-social-media-mapping-the-ideology-of-news-media-politicians-and-the-mass-public/9D370C1E886F5B114474086D3D44D92C) |
| What it measures | A Bayesian spatial model of who shares links to which national news domain. The domain ideology `zeta` and person ideology `theta` (politicians and politically engaged users) are estimated jointly on one scale. The prior is ζ ~ Normal(0, σ). Quote-tweets are excluded, which removes much of the "sharing to mock" noise. The politician scores validate against DW-NOMINATE at ρ = 0.96. |
| Data year | Members of the 116th Congress (2019–2021) plus a random sample of ordinary users. The archive includes per-year models for 2017–2020. |
| Domains | **184** national US outlets. |
| Download | Dataset page: https://doi.org/10.7910/DVN/1QMLOV (Harvard Dataverse, version 2.0, 2025-01-09). The scores sit inside `Replication_Archive.zip`, which is **6.4 GB** (`https://dataverse.harvard.edu/api/access/datafile/10735146`). The zip is on S3, which honours HTTP range requests, so you can pull just the one file with Python `zipfile` over a range-reading file object (done for this research; script in the appendix). Files: `News_Domain_Media_Scores.csv` (13.6 KB) and `MOC_116_Media_Scores.csv` (49 KB). **Recommendation:** commit the extracted 13.6 KB CSV to the Tare repo with attribution. CC0 allows that. |
| Columns | `News_Domain_Media_Scores.csv`: `domain, zeta, zeta_lower90, zeta_upper90` (domains are upper-case, e.g. `NYTIMES.COM`; some have paths, e.g. `YAHOO.COM/NEWS`, `TELEMUNDO.COM/NOTICIAS`, `CBN.COM/CBNNEWS`). `MOC_116_Media_Scores.csv`: `name, nominate_name, role, party, affiliation, geography, district, nominate, theta` (527 rows) |
| License | **Dataverse metadata: "CC0 1.0"**, with no extra terms of use or access. The README.txt has no research-only clause. |

Selected values (zeta): AP 0.02, Reuters 0.09, USA Today 0.05, Bloomberg 0.08, The Hill 0.10, Axios −0.05, CBS −0.14, ABC −0.19, Politico −0.22, CNN −0.37, WaPo −0.44, NBC −0.49, NPR −0.68, NYT −0.70, Guardian −0.70, MSNBC −0.76, HuffPost −1.06, Daily Kos −1.22, Vox −1.32, Mother Jones −1.71, The Nation −1.95; CNBC 0.40, WSJ 0.63, NY Post 0.64, Dispatch 0.85, RealClearPolitics 0.87, Reason 0.94, Washington Times 1.27, Washington Examiner 1.34, Newsmax 1.39, Fox 1.52, National Review 1.59, Daily Caller 1.91, Breitbart 2.03, Daily Wire 2.07, Federalist 2.13, OANN 2.69.

Weaknesses:
- **Small and US-only.** It has 184 domains and no regional papers. Of the non-US outlets, only the Guardian (−0.70) and the Economist (−0.23) are in; BBC, Al Jazeera, FT, Daily Mail and the Independent are not. Several big US outlets are missing too, e.g. `latimes.com`. For these you fall back to Robertson.
- **It reflects the Twitter era of 2017–2020.**
- **Partisanship among politicians is strongly tied to news sharing.** Eady et al. find that the most polarized politicians share the most news, which can stretch the extremes of the scale.

### 1.3 Bakshy, Messing & Adamic 2015 (*Science*): Facebook top-500 alignment

| Field | Value |
|---|---|
| Dataset | "Replication Data for: Exposure to Ideologically Diverse News and Opinion on Facebook", https://doi.org/10.7910/DVN/AAI7VA (Harvard Dataverse, published 2019-05-17) |
| What it measures | For each "hard news" URL, the mean self-reported ideology (−2…+2 mapped from the profile "political views" field) of US adult Facebook users who shared it, averaged per domain and rescaled to −1…+1. The README says: "alignment is not a measure of slant or bias, it only characterizes the audience who shares a URL on Facebook." |
| Data year | July 2014 to January 2015. |
| Domains | 500 (subdomains are separate, e.g. `www.foxnews.com`, `video.foxnews.com`, `nation.foxnews.com`) |
| Direct file | `https://dataverse.harvard.edu/api/access/datafile/3429753` (`top500`, CSV with no extension, 27.9 KB) |
| Columns | `domain, avg_align, l2, l1, n, r1, r2` (the README calls the moderate share `m`, but the file header says `n`) |
| License | Dataverse: "This dataset is made available under a Creative Commons CC0 license with the following additional/modified terms and conditions:" (the text is blank after the colon). Terms of access: "By downloading you agree not share or attempt to re-identify these data." **Ambiguous:** "not share" reads as a ban on redistribution, which conflicts with CC0. Do not redistribute it. At most, use it offline as a validation check. |

Weaknesses: the data is over 11 years old, it covers only domains that were big on Facebook in 2014 (many are now dead: Upworthy-era sites, `online.wsj.com`), and self-reported ideology field.

### 1.4 DomainDemo (Yang et al. 2025, *Scientific Data*): newest and largest, but no license

| Field | Value |
|---|---|
| Paper | Yang, Goel, Quintana-Mathé, Horgan, McCabe, Grinberg, Joseph & Lazer, "DomainDemo: a dataset of domain-sharing activities among different demographic groups on Twitter", *Sci Data* 12, 1251 (2025). https://www.nature.com/articles/s41597-025-05604-6 |
| What it measures | The same ratio formula as Robertson, computed on unique users rather than shares (see `code/generate_derived_metrics/calculate_leaning_score.py`). The panel is 1.5M Twitter users matched to voter files, May 2011 to April 2022. There are two variants: inferred party (`derived_party_leaning`) and registered party (`derived_partyreg_leaning`), which correlate at r = 0.92. |
| Domains | 129,127 (party) and 129,041 (registration). |
| Direct file | https://raw.githubusercontent.com/LazerLab/DomainDemo/main/data/derived_metrics/derived_party_leaning.csv.gz (1.8 MB, columns `domain, leaning_score`) |
| License | **None.** The GitHub API reports `license: null`, and the Zenodo record https://doi.org/10.5281/zenodo.15151613 (record 15579200) has `access_right: restricted` and no license field. The paper text is CC BY-NC-ND 4.0, but that covers the article, not the data. The derived metrics are described as "publicly available", which is not the same as licensed for reuse. **Treat as all-rights-reserved**, and email the authors (Kai-Cheng Yang, David Lazer) if you want it. |
| Agreement | Spearman ρ = 0.93 against Robertson (14,114 shared domains) and 0.93 against Eady (179 shared domains), computed here. |

Weaknesses: the scale is compressed and shifted left. The median domain is −0.175, Fox is only +0.22, NYT −0.22, Reuters −0.22. It averages 11 years and includes quote-retweets, so hate-sharing is mixed in. If you ever get permission, rescale it rather than use the raw numbers.

### 1.5 Buntain, Bonneau, Nagler & Tucker 2023 (ICWSM): Facebook URL-shares

- Paper: https://ojs.aaai.org/index.php/ICWSM/article/view/22127 (doi 10.1609/icwsm.v17i1.22127). Audience ideology from the Social Science One / Meta differentially private Facebook URLs dataset. The paper reports correlation above 0.87 with prior measures.
- File: https://osf.io/download/bcm2h/ (`buntain.et.al.2023.csv`, 2,629 domains, columns `domain, share_ideology, view_ideology, like_ideology`) in OSF project https://osf.io/wtf9y.
- **License: none.** The OSF API returns `node_license: null`, and the data derives from the Meta/SS1 data agreement. Not reusable without permission. The scale is unbounded (e.g. `100fedup.com` 1.55).

### 1.6 Pew Research Center

- 2014: "Political Polarization & Media Habits" (audience ideology of 36 sources). 2025: the **News Media Tracker** for 30 sources (survey of 9,482 adults, March 10–16, 2025). https://www.pewresearch.org/journalism/feature/news-media-tracker/ and https://www.pewresearch.org/journalism/2025/06/10/the-political-gap-in-americans-news-sources/. Pew notes the tracker "only analyzes the audiences" of the sources.
- License (https://www.pewresearch.org/about/terms-and-conditions/): the site content license is "personal, revocable, nonexclusive, nontransferable". The survey datasets license (§13) does allow commercial use, but distribution "is limited to excerpts", it **excludes American Trends Panel datasets** (both media studies are ATP), and it requires a fixed disclaimer.
- **Verdict:** only 30 outlets, and the terms are restrictive. Use it as a *validation check* (does our lean for Fox/NYT/NPR/Newsmax agree with Pew's audience composition?), citing the published report. Do not import it as a data source.

### 1.7 Proprietary ratings: checked, and none can be used

| Source | Terms found | Usable by Tare? |
|---|---|---|
| AllSides | "AllSides Media Bias Ratings™ are licensed under a Creative Commons BY-NC 4.0 License … Commercial use is permissable with a license agreement." (https://www.allsides.com/about/media-bias-rating-methods, https://www.allsides.com/content/normal/guidelines-using-allsidestm-trademarks) | Only if Tare stays strictly non-commercial, and the BY-NC restriction then flows to downstream users. That conflicts with MIT's freedom for anyone, including commercial forks. **No.** |
| Media Bias/Fact Check | "Our internal scoring system is proprietary … We also offer an API for commercial licensing." (https://mediabiasfactcheck.com/frequently-asked-questions/) | No |
| Ad Fontes Media, NewsGuard | Paid licensing products (NewsGuard's labels were deliberately left out of even the Robertson 2023 replication data "because of their proprietary nature") | No |

---

## 2. Recommendation and the five buckets

### 2.1 Pipeline

1. Normalise each outlet's domain: lower-case, strip `www.`, collapse subdomains to the registrable domain unless the subdomain is a separate outlet (e.g. `abcnews.go.com`).
2. If the domain is in **Eady**, use its `zeta` and its 90% interval.
3. Otherwise, if it is in **Robertson**, convert: `zeta_hat = (score + 0.081) / 0.401`. This was fit by OLS on the 175 domains in both datasets (r = 0.93). Use only rows with `rounded_n_accts ≥ 500` (from the GitHub CSV). Below that, mark the outlet "low confidence" or "unrated". In `domains.tsv`, 773 domains flagged `news_is_news = 1` pass the ≥500 bar (512 at ≥1,000, 1,935 at ≥50). That is enough for "several hundred outlets" once added to Eady's 184.
4. Otherwise mark it **unrated**, and do *not* use it for blindspot maths. For the outlets Tare cares about that are uncovered (newer national outlets, most non-US outlets), keep a small hand-curated override file. Each entry should cite a public, reusable justification (e.g. ownership, editorial endorsements, Wikidata "political alignment" P1387, which is CC0) and be reviewed in PRs.

### 2.2 Thresholds (on Eady's zeta scale)

| Bucket | zeta | Robertson-score equivalent |
|---|---|---|
| left | < −1.24 | < −0.578 |
| lean left | −1.24 to −0.62 | −0.578 to −0.330 |
| center | −0.62 to +0.62 | −0.330 to +0.168 |
| lean right | +0.62 to +1.24 | +0.168 to +0.416 |
| right | > +1.24 | > +0.416 |

Why these numbers and not round ones:

- **The neutral point is 0 on zeta.** It is the identification anchor of the model (ζ ~ N(0, σ)), and the wire and reference outlets cluster there empirically: AP 0.02, USA Today 0.05, Bloomberg 0.08, Reuters 0.09, The Hill 0.10. In Robertson units, 0 on zeta is −0.081. That shift is what corrects the "zero is not neutral" problem the Robertson authors flag.
- **The unit is the partisan gap.** In `MOC_116_Media_Scores.csv`, the median Democratic member of Congress (n = 277) sits at theta −0.26 and the median Republican (n = 246) at +0.98, on the same scale as the outlets. The gap is G = 1.24.
  - An outlet is **center** if its audience is within half a party-gap of neutral (|zeta| < G/2 = 0.62).
  - It is **lean** if it is within one full gap.
  - It is **left/right** beyond one full gap. That is, its audience is further from neutral than the distance between the two parties' median legislators.
- **Face validity, checked on the data.**
  - Center: AP, Reuters, Bloomberg, The Hill, CBS, ABC, Politico, CNN, WaPo, NBC, PBS, CNBC.
  - Lean left: NPR, NYT, Guardian, MSNBC, The Intercept, HuffPost, Slate, Salon (−1.20), Daily Kos (−1.22, 0.02 from the cut).
  - Left: Vox (−1.32), Mother Jones, The Nation, Democracy Now.
  - Lean right: WSJ (0.63, just past the cut), NY Post, Dispatch, Reason, RCP, Weekly Standard.
  - Right: Washington Times (1.27), Washington Examiner, Newsmax, Fox, National Review, Breitbart, Daily Wire.
  - Bucket sizes over all 184 Eady domains: left 34, lean left 30, center 65, lean right 13, right 42. The thin "lean right" bucket is real: the right-of-center audience splits sharply between WSJ-type and Fox-type outlets.
- **Robertson-only outlets under the converted cuts.** These are domains Eady lacks. Center: LA Times −0.26, BBC −0.26, FT −0.20, Chicago Tribune, Miami Herald, Dallas News, Star Tribune, Denver Post. Lean left: Boston Globe −0.35, SF Chronicle −0.41, Independent −0.35, Al Jazeera −0.53. Lean right: Daily Mail +0.21. For comparison, Robertson places NYT −0.26 in center, while Eady puts it in lean left (−0.70). That is one reason Eady wins wherever both exist.
- **Cross-check against the AllSides categories embedded in the 2018 file.** This was used only to validate, not shipped. The median Robertson score by AllSides 2018 class: Left −0.63, Lean Left −0.28, Center −0.21, Lean Right +0.57, Right +0.84. The proposed Robertson cuts (−0.58 / −0.33 / +0.17 / +0.42) separate those medians in the right order. Note how close AllSides "Lean Left" and "Center" are in audience terms. Expect disagreement there, and say so in the methodology page.
- **Borderline rule.** Bucket on the point estimate. Do not move outlets toward the center: 90 of the 184 Eady intervals (`zeta_lower90` to `zeta_upper90`) straddle at least one cut-point, so a "pull to center" rule would wipe out most of the lean buckets. Instead, store an `uncertain` flag when the interval straddles a cut, show it in the UI ("between lean left and left"), and leave blindspot maths on the point estimate. For Robertson-only outlets, set the flag within ±0.05 of a cut, or when `rounded_n_accts < 500`.
- **Stale data.** `theepochtimes.com` scores +0.008 (center) in Robertson's 2017 data, from only 800 accounts, before the outlet's well-documented shift. Every Robertson-only rating needs a "data from 2017" note and a manual review queue.
- **Non-US outlets.** Both datasets measure *US* partisan audiences. For BBC, the Telegraph (−0.06), DW or SCMP, the score says how US Democrats and Republicans share them, not where they sit in their own country's politics. Show international outlets as "US audience lean", or leave them unrated for blindspots.

Alternatives considered: equal fifths of [−1, 1] on the Robertson score (−0.6, −0.2, 0.2, 0.6) ignores the authors' warning that zero is not neutral, and puts NYT, CNN and AP all in "lean left". Quantile buckets (each bucket equally full) would force the bucket sizes to be equal even if the media world isn't. Both were rejected.

### 2.3 Blindspot detection notes

- Count only rated outlets. Weight Robertson-derived ratings lower than Eady ones.
- Recompute buckets from the stored numeric zeta, not from stored labels, so a threshold change is a one-line diff.
- Publish the full table (domain, source dataset, zeta, interval, bucket) on a methodology page. Both datasets are CC0, so this is allowed, and it is what makes the labels defensible.

---

## 3. Open lists of news outlets with RSS feeds

No open list gives "several hundred US + international news outlets, each with a working feed, under a permissive license". The practical route: build the outlet list from the rated domains above, fill feeds from the CC0/CC BY lists below, and autodiscover the rest from each homepage's `<link rel="alternate" type="application/rss+xml">` tag.

| List | License (verified) | What's in it | Notes |
|---|---|---|---|
| **plenaryapp/awesome-rss-feeds**: https://github.com/plenaryapp/awesome-rss-feeds | **CC0-1.0** (LICENSE file + GitHub API) | 841 feed URLs in OPML. About 270 are country "news" feeds across 25 countries: India 36, Philippines 20, Australia 16, Mexico 15, Italy 13, Russia 13, Ukraine 12, US 10, UK 5, and so on. Plus topical "recommended" packs. Raw example: `https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/countries/with_category/United%20States.opml` | Active (pushed 2026-10-05, about 2.9k stars). The US list is only 10 feeds (e.g. Fox, WaPo, WSJ, LA Times, CNN, CNBC, Politico, Yahoo, HuffPost). Good for international seeds, thin for the US. |
| **rumca-js/awesome-database-feeds**: https://github.com/rumca-js/awesome-database-feeds | Code **GPL-3.0**. Data **CC BY 4.0** (`LICENSE_DATA`) | SQLite `feeds.db.zip` (7.5 MB) with 56,872 feeds of all kinds, aggregated from curated link collections. Demo: https://rumca-js.github.io/feeds | Feeds are of every topic, so you would filter by domain against the rated list. CC BY means you must give attribution in the repo/README. Don't vendor the GPL scripts. |
| **The Signal 500 (feeds.bar)**: https://github.com/gableend/signal-500-opml | **CC BY 4.0** (LICENSE file; GitHub shows NOASSERTION because it isn't a standard SPDX file). DOI 10.5281/zenodo.22311917 | 497 hand-scored sources as OPML packs, including `world-politics.opml` and `breaking-news.opml` | New (pushed 2026-10-22), zero stars. Mixed news and expert sources. Spot-check the feeds. |
| **Wikidata P1019 "web feed URL"**: https://query.wikidata.org | **CC0** | Only about 450 news items carry a feed URL: newspapers 185, news websites 111, news media 125. Just 17 are US items. | Too sparse to rely on, but CC0 and editable. P1387 "political alignment" exists on only 316 news items, which is not enough for ratings. |
| **yinleon/LocalNewsDataset**: https://github.com/yinleon/LocalNewsDataset | Repo **MIT**. The data was scraped from usnpl.com and stationindex.com, whose own terms are not stated. | 8,721 US local outlets (2018): `name, state, website, domain, twitter, youtube, facebook, owner, medium, source, collection_date`. **No RSS column.** | Useful to tag regional/state outlets with a state and owner (e.g. Sinclair, Nexstar) and join to Robertson scores by `domain`. |
| **ercexpo/us-news-domains**: https://github.com/ercexpo/us-news-domains | **No license** | 5,397 US news domains: `domain, ideology, type` (the `ideology` column is just Robertson's score; `type` is national/local/international for 1,764 rows) | Reference only. The national/local coding is handy but not licensed. |
| wokenlex/infobubble-support `Sources/all.sources.rss.yaml` | **No license** | About 86k feed URLs by country and category (4.4 MB YAML) | Do not import. Use only to find candidates, then autodiscover from the homepage. |
| newman8r/us-newspapers-opml | GPL-3.0 | 22 of the top 25 US newspapers, from 2018 | Stale and copyleft. Skip. |

Recommendation for Tare:
1. Take the outlet universe from Eady (184) plus Robertson news domains with ≥500 accounts (773, overlapping). Add hand-picked international outlets as "unrated/US-audience".
2. Fill feeds from plenaryapp (CC0) first and the rumca DB (CC BY 4.0, with attribution) second.
3. For the rest, run homepage RSS autodiscovery and keep the result in Tare's own `outlets` table, together with the source of each feed URL.
4. Keep a nightly feed-health check. Many public lists (and the 2018-era datasets) contain dead feeds.

---

## Sources opened

- Robertson Dataverse: https://doi.org/10.7910/DVN/QAN5VX (via `https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/QAN5VX`)
- Robertson GitHub: https://github.com/gitronald/domains, `data/bias_scores/README.md`, `data/domains.tsv`
- Robertson et al. 2023 *Nature*: https://www.nature.com/articles/s41586-023-06078-5
- Eady et al. Dataverse: https://doi.org/10.7910/DVN/1QMLOV (README.txt datafile 10505577; archive datafile 10735146)
- Eady et al. paper: https://www.cambridge.org/core/journals/political-analysis/article/news-sharing-on-social-media-mapping-the-ideology-of-news-media-politicians-and-the-mass-public/9D370C1E886F5B114474086D3D44D92C
- Bakshy et al. Dataverse: https://doi.org/10.7910/DVN/AAI7VA (README.md datafile 3429755, top500 datafile 3429753)
- DomainDemo: https://www.nature.com/articles/s41597-025-05604-6, https://github.com/LazerLab/DomainDemo, https://zenodo.org/api/records/15151613
- Buntain et al.: https://ojs.aaai.org/index.php/ICWSM/article/view/22127, https://api.osf.io/v2/nodes/wtf9y/
- Pew: https://www.pewresearch.org/about/terms-and-conditions/, https://www.pewresearch.org/journalism/feature/news-media-tracker/, https://www.pewresearch.org/journalism/2025/06/10/the-political-gap-in-americans-news-sources/
- AllSides: https://www.allsides.com/about/media-bias-rating-methods, https://www.allsides.com/content/normal/guidelines-using-allsidestm-trademarks
- MBFC: https://mediabiasfactcheck.com/frequently-asked-questions/
- RSS lists: the GitHub repos in section 3 (licenses read from the GitHub API and the LICENSE files)

---

## Appendix: extracting one file from the 6.4 GB Eady zip

```python
import io, urllib.request, zipfile
URL = "https://dataverse.harvard.edu/api/access/datafile/10735146"
final = urllib.request.urlopen(urllib.request.Request(URL, headers={"Range": "bytes=0-0"})).geturl()  # S3 URL
SIZE = 6427372157
class RangeFile(io.RawIOBase):
    def __init__(s): s.p = 0
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.p
    def seek(s, o, w=0): s.p = o if w == 0 else (s.p + o if w == 1 else SIZE + o); return s.p
    def readinto(s, b):
        if s.p >= SIZE: return 0
        end = min(s.p + len(b), SIZE) - 1
        d = urllib.request.urlopen(urllib.request.Request(final, headers={"Range": f"bytes={s.p}-{end}"})).read()
        b[:len(d)] = d; s.p += len(d); return len(d)
z = zipfile.ZipFile(io.BufferedReader(RangeFile(), buffer_size=1 << 16))
open("News_Domain_Media_Scores.csv", "wb").write(z.read("News_Domain_Media_Scores.csv"))
```

The signed S3 URL expires, so re-resolve it each run. Skip the `__MACOSX/._*` entries in the zip.

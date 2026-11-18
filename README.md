# Hoopland-Premium-Class-Generator
Create realistic accurate classes for hoopland that you can upload and use right away! Control every aspect of player generation for easy class creation!

Real-player looks are estimates. Up to four distinct photos are compared using
Workers AI; they come from the draft source, ESPN or an exact-name Wikidata
basketball-player match and its Wikimedia Commons category. Commons category
files must also contain the player's name. For each photo, the browser creates
a reference sheet showing the actual editor skin and hair swatches next to the
photo, and the vision model describes the visible hairstyle and selects swatch
labels. It does not sample image pixels. Photo descriptions are combined, and
unknown or conflicting features remain placeholders. A reference photo can be
viewed beside the editable mock-up in Class Preview. Photos may be missing,
lighting can distort colors, and neither the model's estimates nor the mock-up
guarantee an exact in-game appearance. Photo-derived features take precedence
over older unsourced profile defaults; the user-provided Awa Fam, Lauren Betts
and Frieda Bühner color corrections still override estimates for those features.
When no reliable feature is available, a neutral placeholder is used instead
of a randomly generated skin, hairstyle, facial hair, tattoo or accessory.
The placeholder is not a prediction of the player's appearance. Preview edits
are included in the export.
Awa Fam's source name variations are normalized before matching. Getty Images
is not used as a photo source.

Draft classes also check ESPN's draft endpoint for headshots and attach them
only when the returned year, player name, and (where provided) draft pick
match. This includes the separately sourced 2026 women's class. If ESPN returns
another year or a source fails, no photo is substituted from that response.
Draft players with a known college also check that college's ESPN roster for
the draft-year season. The team, season, exact unique player name and athlete
headshot must all match; unavailable or ambiguous rosters are not used.

For men's and women's freshman classes, an ESPN recruiting commitment (or an
explicit college column in the McDonald's roster) can identify a college team.
The generator checks that team's ESPN roster for one exact player-name match,
the correct team, a plausible season, and that player's ESPN headshot. An
unambiguous college name can be matched against ESPN's team list when no team
ID is supplied. The roster may be current rather than historical, and future
recruits may not appear yet; no roster photo is used when these checks fail.
Name-only ESPN search photos are not used for recruits. Other independently
matched photos may still be available, but this does not guarantee three photos
or an accurate appearance.

For real players in men's and women's draft and freshman classes, a sourced
hometown takes precedence over a birthplace; birthplace is a fallback and is
not necessarily where the player grew up. Explicit hometown and birthplace
columns, ESPN basketball profiles, verified college rosters, and unambiguous
exact-name Wikidata basketball profiles are used where available. Freshman ESPN
profiles require a verified college roster match or draft identity. Name
matching alone cannot guarantee identity, and sources may be missing or wrong.
Olivia Miles's Phillipsburg hometown and Azzi Fudd's Arlington location are
curated from [Miles's biography](https://en.wikipedia.org/wiki/Olivia_Miles)
and [Fudd's ESPN bio](https://www.espn.com/wnba/player/bio/_/id/4433790/azzi-fudd).

Open-Meteo coordinates must match the stated city and, when provided, state
and country. The export uses the nearest available Hoop Land catalog location
in the resolved country, not necessarily the exact city. If no reliable
coordinates or exact catalog city are found, a catalog point is assigned as an
approximation rather than `0,0`; it is not a verified hometown location. Where
the country is unavailable in the catalog, the fallback may be elsewhere.

Ratings are estimates, not measured pro-level ability. Each of the 12 core
attributes starts at 1 (export value 2), and added points use the export's
2–20 scale. Potential tiers of 2.5, 3, 3.5, 4, 4.5 and 5 stars cap added
points at 74, 88, 102, 116, 130 and 144 respectively, except for the rare
GOAT archetype described below. Orange overall is
approximated at one half-star per 14 added points; growth is the potential cap
minus current points. Tier names refer to potential, not guaranteed careers.

For past NBA and WNBA draft classes, the generator looks up professional
regular-season player impact estimate (PIE) and ranks each qualifying season
against its own league and year. The comparison group requires 400 NBA or 200
WNBA minutes; smaller samples are shrunk toward a low baseline and flagged in
the preview. It averages the percentile ranks of the best two available
seasons (or one if that is all that qualifies) to estimate potential; the
preview shows the seasons and flags incomplete history. Traded players use a
combined season row, or a minutes-weighted approximation if only team stints
are available. The search covers
completed seasons from the draft through 23 years after it. For NBA seasons
before 1996–97, when NBA advanced stats are unavailable, it instead uses a
Game Score-style box-score impact per 36 minutes, omitting steals, blocks and
offensive rebound splits before 1973–74 and turnovers before 1977–78. That is
less complete than PIE and is labeled separately. The earliest NBA seasons may
also lack minutes or other required data.

The mapping from percentile to potential is 97th: 5 stars, 90th: 4.5, 75th:
4, 55th: 3.5, 30th: 3 and below: 2.5. These are estimates, not a validated
prediction or a direct conversion from PIE to Hoop Land stars. Active players'
future peaks are unknown. Missing or ambiguous identities, insufficient
minutes data, incomplete data, and unavailable services can prevent a peak match;
the preview then identifies the draft-pick/tier fallback. Projected future
drafts use draft-order tiers, with earlier picks never assigned lower potential
than later picks. All classes have a minimum potential of 2.5 stars.

For current ability, where college stats are available, a composite of era-relative shooting, passing,
rebounding, steals and blocks estimates current ability and prioritizes
attributes. It is not PIE, win shares, or a validated prediction. It shrinks
toward average for small samples (up to 600 minutes), excludes dribbling and
dunking from the composite, and excludes shot-zone attributes when those data
are absent. Players without usable stats fall back to the fictional tier
estimate, as indicated in the preview.

Each generated player receives an archetype, also exported in `arc`: Floor
General, Scoring Guard, Sharpshooter, Slasher, 3-and-D Wing, Shot-Creating
Wing, Point Forward, Stretch Big, Post Scorer, Rim Runner, Rim Protector,
Playmaking Big or GOAT. Position-appropriate archetypes prioritize different
attributes within the player's tier budget; reliable college statistics help
choose an archetype for real players, otherwise the choice is an estimate.
For fictional 5-star prospects there is a 0.1% chance of GOAT, provided the
selected attribute limits permit it. GOATs use 192 potential points, with at
least 8/10 in each non-exempt attribute and at least 4/10 current ability;
women's dunk restrictions still apply. Their exported `pot` remains 5 stars.
Compatibility of over-144-point players with Hoop Land has not been verified.

Maximum dribbling potential on the displayed 1–10 scale is PG 10, G 9, SG 8,
GF 7, SF 6, and F/PF/FC/C 5. Point Forwards and Playmaking Bigs can exceed
their position limit by one displayed point, up to 10; GOATs can reach 10.
The generator reserves up to four displayed points
of dribbling growth, subject to the selected limits. Women receive no added
dunk points unless they match a small, sourced list of players reported to
have dunked in a college game; in that case dunk potential is capped at 5
displayed. The list is incomplete, and absence is not proof a player has
never dunked. The exceptions use player name and school, based on reports
from [NCAA.com](https://www.ncaa.com/news/basketball-women/article/2023-02-15/every-womens-college-basketball-player-dunk-game)
and [ESPN](https://www.espn.com/womens-college-basketball/story/_/id/42896118/how-many-women-dunked-college-basketball).
The women's dunk controls default to 1 actual and potential. A listed dunker
can exceed that untouched default automatically; manually adjusted limits
apply to them too.

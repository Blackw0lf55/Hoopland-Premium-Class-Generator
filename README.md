# Hoopland-Premium-Class-Generator
Create realistic accurate classes for hoopland that you can upload and use right away! Control every aspect of player generation for easy class creation!

Real-player looks use supplied roster references, imported appearances and
community-approved edits. Features without a reference use neutral placeholders,
not predictions. Review appearances before downloading; preview edits are
included in the export. Awa Fam's source name variations are normalized before
matching.

Fictional players, including fictional fill-ins in real classes, use hairstyle
pools weighted for the selected class year through the 1990s; modern classes
retain the existing pool. These are broad approximations, not restrictions on
individuals. Real-player looks from saved references or edits take precedence;
otherwise a neutral, period-aware placeholder is used. Hairstyle history is
informed by [this overview of NBA hairstyles](https://andscape.com/features/haaaaaair-ball-nba-hair/)
and [this general historical overview](https://hairstyleatlas.com/historical-hairstyles).

Attribute actual and potential caps adjust in 0.5 increments. The left and right
halves of each bar segment show the corresponding half-point limits.

Draft players can receive one level-1 starter skill (HIG, SPA, CLA or DIM),
with higher current ability making a skill more likely. HIG is limited to men
with at least 4 dunk ability. Freshman players receive no starter skills. The
skill objects follow the save-file format; in-game behavior is not verified.
Fictional players have a 33% chance of tattoo-style body colors and a 45%
chance of accessories, including arm or leg sleeves. Sleeve and head accessory
colors use team primary, secondary or tertiary colors. Real-player placeholder
appearances do not invent tattoos or sleeves. Random shoe, lace and sole colors
use a broader palette when random shoe colors are enabled.

The supplied NBA 2027, WNBA 2026 and NCAAW 2025 roster files provide
position-group reference distributions for draft men, draft women and
freshman women, respectively. Their `yrs: 0` players provide approximate
rookie/freshman baselines; the WNBA sample includes some experienced
international players. Current rating budgets, attribute priorities and
tendencies blend those references with tier, archetype and available college
statistics. Dribbling growth uses the group’s observed average instead of
forcing four full rating points of growth; potential remains a separate career estimate. The
editable height and weight limits for fictional players default to the corresponding
gender and class sample's position-group 5th–95th percentiles. Because no men's
college roster was supplied, fictional men's freshmen use the men's draft
rookie ranges as an approximation. The PG minimum defaults to 67 inches for
both genders. Generated heights and weights
stay within those limits, including outliers; an invalid range identifies the
position. Generated dimensions favor the midpoint of the relevant gender and
class position-group reference ranges, becoming less likely farther from it.
These midpoints approximate averages; they are not measured position-specific
means. When custom limits exclude the midpoint, the nearest limit becomes the
most likely value. Edits are retained when switching between class types or genders.
Real classes skip Spec Limits and use available player-specific heights and
weights from class tables, matched ESPN draft identities and basketball
profiles, NBA/WNBA player-ID profiles, or season-matched college rosters. Women's school-roster heights
are also used when the name and season match unambiguously. Profile
measurements may reflect a later season, and source data can be missing or
incorrect; accuracy for every player cannot be guaranteed. When a measurement
is missing, it is estimated from recommended position ranges, marked `est.`
in the player preview, and reported after generation. Missing measurements use
the same center-weighted estimates; supplied real measurements are not altered.
Height (inches) and
weight (pounds) can be corrected in Edit Attributes before download; changes
are local to the class. Men's freshman ratings retain the previous model because
no men's college roster was supplied. These are estimates, not verified
rookie-season outcomes.

The compact reference file also stores appearance fields from the supplied
active rosters. Real-player matches require an unambiguous name and gender;
where a name appears in multiple rosters, the 2026 pro rookie draft class,
matching college or 2025 college freshman class can disambiguate it.
Roster appearances are defaults,
not guaranteed likenesses; existing user-provided corrections and
community-approved edits override them. The original
roster files are not included. To rebuild with replacement files, run
`node scripts/build-roster-reference.cjs NBA.json WNBA.json NCAAW.json`.

The country selector includes every named country in the location catalog.
Countries without dedicated name lists use a regional or US fallback, so names
are not necessarily representative of that country. Belgium remains available
from the original selector, but has no catalog location and uses a fallback.
For fictional men's and women's players, country weights use the same
[2026–27 NBA opening-night snapshot](https://pr.nba.com/international-players-2026-27-nba-rosters/)
(including two-way players), not WNBA data or live rosters. The
[519-player total](https://cdn-uat.nba.com/news/2026-27-rosters-by-the-numbers)
minus 125 international players gives the US weight of 394; available
international countries use the NBA's listed counts. Countries with no
listed players receive a small fallback weight of 0.1 player. Counts for
countries unavailable in the selector are excluded, then selected weights are
normalized to 100%; deselecting a country redistributes its share
proportionally. Displayed percentages are rounded. The selector has its own
screen after Spec Limits; both screens are skipped for
real classes: real players retain their sourced country, and any fictional fill
players use all available country weights.

From the title screen, **Import Player Data** reads a Hoop Land JSON or TXT
roster or class file (up to 256 MiB and 100,000 listed players). Parsing is
local; supported appearance fields, attributes, tendencies, age, dimensions,
position, years, number, country and hometown are sent for shared storage
alongside the name and selected gender, roster level and year. The full file is
not stored. Appearance baselines remain global by name and gender; duplicates
in a file are skipped and existing built-in or imported baselines are never
replaced. Other player data is scoped by gender, pro/college level, year and
name. Duplicate records use the lower current and potential value separately
for each attribute; the first saved biography and tendency fields are retained.
Imports are shared and unmoderated. Name matching can confuse different people,
including across uploads; review players before downloading.

Before downloading, approve the appearances to share manually changed skin,
hair color, hairstyle and facial-hair (men only) selections. Only changed
fields of real players are shared, not unedited placeholders or whole class
files. Future generations match the same name and gender across class types
and years and combine up to five recent approvals per player: the middle skin
shade and most common other selections, with the most recent selection breaking
ties. Shared fields override the imported or built-in baseline; remaining fields
use that baseline or placeholders. Older class-scoped edits remain readable
for their original class and seed the global history when edited there; old
histories from other class years are not automatically merged.
Anyone can contribute; these edits are not moderated or guaranteed accurate.
Same-name duplicates in a class cannot be shared. Edits to fictional players
and other appearance details remain local to the generated class. Shared
storage uses a SQLite-backed Durable Object configured in `wrangler.jsonc`;
if storage is unavailable, an error is shown instead of silently saving.

Click a player in Class Preview to see current and potential stars and edit
attributes, physical ratings and the position-appropriate archetype. Before
download, separate appearance and attribute questions offer Yes (share eligible
edits), No (return to editing), and Skip (continue without sharing that
category). Approved attribute and archetype edits for real players are shared
separately from appearances and reused across years and class types by name
and gender, combining up to five recent edits. When both an uploaded attribute
and community ratings are available, the upload has 60% weight and the median
community value 40%; values are rounded to the nearest half point. Draft
overall limits and era restrictions still apply. Historical class eligibility
continues to require independently sourced draft or freshman records.

The class preview lists position, name, jersey number, archetype and stars:
white shows potential and gold overlays current ability. Real players use a
matched college jersey number when available; otherwise a generated number is
used and retained in the export. Opening a player shows the appearance editor
first; the bottom button switches between appearances and attributes.

The appearance preview is migrating to aligned sprite layers. The supplied
bald full-body base, all 171 hairstyles (including bald), all 31 facial-hair
styles, and all 25 head accessories are available in `assets/`. Their 256×336
canvases share the base's origin and include uniform transparent top padding.
The source screenshots show different players, colors, and animation poses;
these layers are approximations, not pixel-exact game sprites.

`sprite-preview.js` composes the base, hair, facial hair, then accessories. It
recolors each layer while retaining shading and alpha and caches a bounded
number of compositions by appearance. A single packed sprite atlas avoids
per-style image requests while editing. The three asset manifests list available
styles. When a selected layer is unavailable, the editor reports that the
preview is unavailable instead of displaying the old procedural portrait.
This does not change exported values.

To prepare additional candidates, install Pillow and run
`python3 scripts/extract-hair.py --reference bald.png --sources registered/ --masks masks/ --output candidates/`.
Provide same-size, pre-registered PNGs named `style_001.png` through
`style_170.png` and manually reviewed grayscale masks named `mask_001.png`
etc. The utility compares each image to the bald reference, intersects changes
with its mask, and writes full-canvas PNGs and a candidate manifest. It does
not register screenshots or resolve their differing skin tones, poses, or
JPEG artifacts. Review and correct candidates before moving them into
`assets/`; do not deploy the generated manifest as-is. Future layers must use
the same dimensions and origin as the base.
After changing any reviewed layer or manifest, rebuild the deployed atlas with
`python3 scripts/build-sprite-atlas.py`.

Speed, strength and stamina are generated separately from the core attribute
budget and exported in half-point steps. Speed uses position-specific limits,
with rare outliers; a 10 is reserved for PG/G. A 10 strength is rare and
reserved for centers. Classes through 1965 use grayscale player appearances,
including accessories and shoes; their grayscale appearance edits are not
shared as modern color references.

Men's draft classes are selectable from 1947, women's drafts from 1997, and
freshman classes from 1900. Historical real rosters depend on available
sources and are not guaranteed for every year; where a freshman source reports
no class, the generator warns and fills with fictional players. A supplied
1965–66 roster informs estimated early men's draft attributes and matching
appearances; its rookie flags are not independently verified. Before the
league's three-point era, three-point ratings and tendencies are suppressed;
freshman classes during the 1967–75 college dunk ban also suppress dunking.
These are simplified era rules, not a reconstruction of every historical rule.

If the other draft sources return no players, an ESPN draft can also supply
selections when the year matches and every listed pick has a unique valid
selection; incomplete or ambiguous drafts are not used as a fallback.
Draft players with a known college also check that college's ESPN roster for
the draft-year season. The team, season and exact unique player name must match;
unavailable or ambiguous rosters are not used.

For men's and women's freshman classes, an ESPN recruiting commitment (or an
explicit college column in the McDonald's roster) can identify a college team.
The generator checks that team's ESPN roster for one exact player-name match,
the correct team and a plausible season. An
unambiguous college name can be matched against ESPN's team list when no team
ID is supplied. The roster may be current rather than historical, and future
recruits may not appear yet.

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
If the catalog or location assignment cannot be loaded, the app stops rather
than exporting unlisted coordinates.

Ratings are estimates, not measured pro-level ability. Each of the 12 core
attributes starts at 1 (export value 2), and added points use the export's
2–20 scale. Potential tiers of 2, 2.5, 3, 3.5, 4, 4.5 and 5 stars cap added
points at 60, 74, 88, 102, 116, 130 and 144 respectively, except for the rare
GOAT archetype described below. Potential stars use the lowest tier whose cap
can hold the assigned potential points, including after edits. Gold actual
stars use a continuous scale of one half-star per 14.4 added points. The gold
fill is the current points divided by 144, rounded to the nearest whole percent
and capped at 100%; it is independent of the potential display. The precise
in-game threshold is not verified.
Growth is the assigned potential points minus current points. Tier names refer
to potential, not guaranteed careers.

For men's and women's draft classes, rookie current ratings are estimated
primarily in the 55–82 overall range using the player's potential tier,
available college statistics and roster calibration. The 85 cap is reserved
for fictional GOAT prospects and a reviewed list of historical generational
players (Michael Jordan, Kobe Bryant and LeBron James in their draft years). An 85 is rare, and
the lowest tier starts around 50–51 overall. Draft current ratings range from
72 to 118 distributable points (50% to 81.9%, displayed as 82%); eligible
generational players can reach 122 points (84.7%, displayed as 85%). A 2.5-star
potential caps at 74 points, so those players have only one or two points of
growth available, including for dribbling. Shared edits above the cap are
reduced automatically; manual edits outside the draft range are rejected.
Freshman class ratings are unaffected
by these draft-only limits.

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

For retired draft players with consistent reported season ages and complete
history, regression age uses the last season near the best two-year sustained
peak followed by two consecutive seasons below 90% of that peak. Only seasons
meeting the minutes thresholds are used; PIE and the older box-score proxy are
never mixed in one calculation. Without sufficient evidence, regression age
remains a generated estimate.
Uploaded regression ages are not stored or used.

The mapping from percentile to potential is 97th: 5 stars, 90th: 4.5, 75th:
4, 55th: 3.5, 30th: 3 and below: 2.5. These are estimates, not a validated
prediction or a direct conversion from PIE to Hoop Land stars. Active players'
future peaks are unknown. Missing or ambiguous identities, insufficient
minutes data, incomplete data, and unavailable services can prevent a peak match;
the preview then identifies the draft-pick/tier fallback. Projected future
drafts use draft-order tiers, with earlier picks never assigned lower potential
than later picks. Real players and fictional draft players have a minimum
potential of 2.5 stars; fictional freshmen have a minimum of 2 stars.

Projected drafts exclude names found in the prior four draft years. If a
needed year's results cannot be verified, men's generation stops with an error;
women's generation warns that previously drafted players may remain.
Men's projections also check the current NBA season's player list; if it is
unavailable, generation warns that undrafted NBA players might remain. These
name-based checks can mistake different players with the same name.

For real women's drafts, US prospects must be verified as seniors on their
college roster for the draft season; prospects identified by the source as
foreign can be included without senior status. Unverified US prospects are
excluded, not assumed to be seniors. The bundled
[Sports Roster Data](https://github.com/Sports-Roster-Data/womens-college-basketball)
Division I rosters for 2020–21 through 2026–27 (snapshot from November 19,
2026) provide school-sourced class years and jersey numbers; matching requires
an unambiguous player name.
Roster class labels can reflect either academic year or eligibility and are
not guaranteed current. ESPN's matching season roster is a fallback. When
recruiting lists are incomplete, verified seniors matching the same school's
college-statistics data supplement projections, ordered by playing time, not
by an independently verified draft ranking. Missing seasons or unmatched
players can reduce the real class; fictional fill is reported. This is a
generator rule, not the WNBA's complete eligibility criteria. The projected
2027 class places JuJu Watkins and Hannah Hidalgo first and second; their
schools list both as 2026–27 seniors.

The bundled roster snapshot can be rebuilt with
`python scripts/build-women-rosters.py DIRECTORY`, where DIRECTORY contains
the upstream season CSVs. The upstream MIT license is in
`data/WOMEN-ROSTERS-LICENSE.txt`.

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
selected attribute limits permit it. GOATs can exceed the normal 144-point
limit; their generated potential varies rather than being fixed at 192. They
have at least 8/10 in each non-exempt potential attribute and at least 4/10
current ability; women's dunk restrictions still apply. Their exported `pot`
remains 5 stars.
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

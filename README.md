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
gender and class sample's position-group 5th–95th percentiles, except the PG
minimum defaults to 67 inches for both genders. Generated heights and weights
stay within those limits, including outliers; an invalid range identifies the
position. Edits are retained when switching between class types or genders.
Real classes skip Spec Limits and use available player-specific heights and
weights from class tables, matched ESPN draft identities and basketball
profiles, NBA/WNBA player-ID profiles, or season-matched college rosters. Women's school-roster heights
are also used when the name and season match unambiguously. Profile
measurements may reflect a later season, and source data can be missing or
incorrect; accuracy for every player cannot be guaranteed. When a measurement
is missing, it is estimated from recommended position ranges, marked `est.`
in the player preview, and reported after generation. Height (inches) and
weight (pounds) can be corrected in Edit Attributes before download; changes
are local to the class. Men’s freshmen retain the previous model because
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

From the title screen, **Import File for Appearances** reads a Hoop Land JSON or
TXT roster or class file (up to 256 MiB and 100,000 listed players). Parsing is
local; only names, selected gender, roster level and year, and skin, hair color,
hairstyle and (for men) facial hair are sent for shared storage. Other player
data and the full file are not stored. Invalid entries and duplicate names in
the file are skipped. Existing built-in and previously imported baselines are
never replaced; the first imported baseline is retained. Imports are shared
with everyone and are not moderated. Matching by name and gender can confuse
different people with the same name, including across separate uploads;
review appearances before downloading.

Before downloading, approve the appearances to share manually changed skin,
hair color, hairstyle and facial-hair (men only) selections. Only changed
fields of real players are shared, not unedited placeholders or whole class
files. Future generations match the same name and gender across class types
and years and combine up to five recent approvals per player: the middle skin
shade and most common other selections, with the most recent selection breaking
ties. Shared fields override the imported or built-in baseline; remaining fields
use that baseline or photo matching. Older class-scoped edits remain readable
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
and gender, combining up to five recent edits. Imports remain appearance-only.
These unmoderated name-based matches can confuse namesakes. The vision model
performs inference; it does not train itself from edits. Approved edits can
improve later references for the same matched name, but autonomous learning
would require a separate training and evaluation pipeline.

The class preview lists position, name, jersey number, archetype and stars:
white shows potential and gold overlays current ability. Real players use a
matched college jersey number when available; otherwise a generated number is
used and retained in the export. Opening a player shows the appearance editor
first; the bottom button switches between appearances and attributes.

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

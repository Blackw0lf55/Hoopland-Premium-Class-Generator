#!/usr/bin/env python3
"""Build compact Division I rosters from the Sports Roster Data season CSVs."""

import csv
import json
import pathlib
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/build-women-rosters.py DIRECTORY")

directory = pathlib.Path(sys.argv[1])
seasons = {}
for path in sorted(directory.glob("wbb_rosters_????_??.csv")):
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    for row in rows:
        season = row["season"]
        if row["division"] != "I" or not row["name"] or not row["team"]:
            continue
        year = int(season[:4]) + 1
        seasons.setdefault(str(year), []).append([
            row["name"], row["team"], row["year_clean"], row["jersey"],
            row["position"], row["country_clean"], row["url"],
        ])

if not seasons:
    raise SystemExit("No Division I rosters found.")

output = pathlib.Path(__file__).resolve().parents[1] / "data" / "women-rosters.json"
output.write_text(json.dumps(seasons, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print("Built", output, {year: len(rows) for year, rows in seasons.items()})

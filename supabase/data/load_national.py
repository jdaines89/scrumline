"""Turns the DBE's national EMIS school list (xlsx) into per-province JSON rows
for public.schools, cleaned the same way as the Eastern Cape list.

Usage: python3 supabase/data/load_national.py National.xlsx supabase/data

Writes schools_<province>.json for every province except EC (already loaded
from its own cleaned list). Load each with the SQL in supabase/data/README.md.

Cleaning:
  * contact details (Addressee, Telephone, Email, street and postal
    addresses) are never read;
  * GIS_Lat and GIS_Long are swapped in many rows, so each coordinate is put
    where it fits South Africa (latitude -35..-22, longitude 16..33); 0,0 and
    anything outside the country becomes null;
  * "99", "Unknown" and "N/A" count as blank;
  * ECD centres and hospital schools are skipped: players represent primary
    and high schools only.
"""
import json
import os
import re
import sys

import openpyxl

SMALL = {"of", "and", "the", "for", "de", "van", "der"}
BLANK = {"", "99", "unknown", "n/a", "none", "0", "outside a town"}
# The list stores ê and ë as halfwidth katakana in some rows.
FIX = str.maketrans({"\uff8a": "ê", "\uff8b": "ë", "\u2019": "'"})
PROVINCE = {"GT": "GP"}  # the list says GT; everywhere else Gauteng is GP


def blank(v) -> str:
    s = re.sub(r"\s+", " ", str(v if v is not None else "")).translate(FIX).strip()
    return "" if s.lower() in BLANK else s


def nice(name: str) -> str:
    """BALENI JUNIOR SECONDARY SCHOOL -> Baleni Junior Secondary School."""
    words = []
    for i, w in enumerate(name.lower().split()):
        w = re.sub(r"(^|[-(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
        if i and w.lower() in SMALL:
            w = w.lower()
        words.append(w)
    return " ".join(words)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def coords(a, b):
    """(lat, lon) from two values in either order, or (None, None)."""
    a, b = num(a), num(b)
    for lat, lon in ((a, b), (b, a)):
        if lat is not None and lon is not None and -35.2 <= lat <= -22 and 16 <= lon <= 33.2:
            return round(lat, 6), round(lon, 6)
    return None, None


def no_fee(v, quintile: str) -> bool:
    # Mpumalanga's 2025 list leaves the no-fee column empty; by national policy
    # quintiles 1 to 3 are the no-fee schools, so fall back to that.
    if not blank(v):
        return quintile in ("Q1", "Q2", "Q3")
    return blank(v).lower() in {"no fee", "yes", "y"}


def main(path: str, out_dir: str) -> None:
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    col = {str(h): i for i, h in enumerate(next(rows))}
    get = lambda r, c: r[col[c]]
    by_prov: dict[str, list] = {}
    seen = set()
    for r in rows:
        emis = blank(get(r, "NatEmis"))
        phase = blank(get(r, "Phase_PED")).upper()
        if not emis or emis in seen or phase in ("ECD", "HOSPITAL SCHOOL"):
            continue
        seen.add(emis)
        prov = PROVINCE.get(blank(get(r, "Province")), blank(get(r, "Province")))
        # Special and skills schools can be either; combined schools go to matric.
        primary = phase in ("PRIMARY SCHOOL", "COMBINED SCHOOL", "INTERMEDIATE SCHOOL", "SPECIAL NEEDS EDUCATION SCHOOL")
        matric = phase in ("SECONDARY SCHOOL", "COMBINED SCHOOL", "SPECIAL NEEDS EDUCATION SCHOOL", "SCHOOL OF SKILLS")
        q = blank(get(r, "Quintile"))
        lat, lon = coords(get(r, "GIS_Lat"), get(r, "GIS_Long"))
        # Metro schools list the metro as their town; the suburb says more.
        town = blank(get(r, "Town_City"))
        if not town or town.lower().startswith("city of"):
            town = blank(get(r, "Suburb")) or blank(get(r, "Township_Village")) or town
        learners = num(get(r, "Learners2025"))
        by_prov.setdefault(prov, []).append({
            "emis": emis, "name": nice(blank(get(r, "Official_Institution_Name"))), "town": nice(town) or None,
            "province": prov, "district": nice(blank(get(r, "EIDistrict"))) or None, "no_fee": no_fee(get(r, "NoFeeSchool"), q),
            "quintile": int(q[1]) if re.fullmatch(r"Q[1-5]", q) else None,
            "offers_primary": primary, "offers_matric": matric, "lat": lat, "lon": lon,
            "learners": int(learners) if learners else None,
            "source": f"EMIS {prov} school list 2025 Q3",
        })
    for prov, items in sorted(by_prov.items()):
        if prov == "EC":
            continue
        with open(os.path.join(out_dir, f"schools_{prov.lower()}.json"), "w") as f:
            json.dump(items, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")
        print(prov, len(items), "schools;", sum(i["offers_matric"] for i in items), "to matric;",
              sum(i["lat"] is None for i in items), "without coordinates", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

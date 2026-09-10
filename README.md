# mk40k — 40k quick-reference sheet generator

Turn a hand-written **army JSON** into a printable **PDF quick-reference sheet** for
Warhammer 40,000 (11th edition). Stats, weapons, abilities, keywords, points,
enhancements, and army/detachment rules are pulled automatically from the
community [`BSData/wh40k-11e`](https://github.com/BSData/wh40k-11e) dataset;
stratagems are supplied by hand (the dataset doesn't include them).

![example](docs/example.png)

## Setup

```sh
# 1. Data (git-ignored; ~50 MB). Re-run `git pull` in it to refresh.
git clone --depth 1 https://github.com/BSData/wh40k-11e.git data/wh40k-11e

# 2. Typst (the PDF engine)
brew install typst          # macOS; see typst.app for other platforms

# Node 18+ is required. No npm dependencies.
```

## Usage

```sh
node scripts/build.js armies/imperial-fists.json
# -> build/imperial-fists.typ   (intermediate, editable)
# -> build/imperial-fists.pdf   (print this)

node scripts/build.js armies/imperial-fists.json --typ-only   # skip PDF compile
```

The build prints a per-unit resolution report and warns about any unit name it
couldn't match (with "did you mean" suggestions) or enhancement it couldn't find.

## Defining an army

See [`armies/schema.md`](armies/schema.md) for the full format. Minimal example:

```json
{
  "name": "Imperial Fists Strike Force",
  "faction": "Imperial Fists",
  "detachment": "Gladius Task Force",
  "points": 2000,
  "units": [
    { "sheet": "Intercessor Squad", "models": 10 },
    { "sheet": "Captain", "enhancement": "The Honour Vehement" }
  ],
  "stratagems": [
    { "name": "Fury of the First", "cp": 2, "phase": "Fight phase", "text": "..." }
  ]
}
```

`sheet` is matched case-insensitively against datasheet names in the dataset. If
a name is wrong the build lists close matches. Units live across catalogues
(e.g. Imperial Fists share most units with the base Space Marines catalogue);
linked catalogues are loaded automatically.

## How it works

| File | Role |
|------|------|
| `src/catalogue.js` | Loads the named catalogue(s) + everything they link to; indexes every node by id and unit by name. |
| `src/resolve.js`   | Resolves one unit entry into a datasheet (stats, weapons, abilities, keywords, points). Weapons follow the full wargear tree; abilities/stats stay scoped to the unit's own composition to avoid pulling in unrelated data. |
| `src/army.js`      | Loads the army JSON, matches unit names, attaches enhancements and rules. |
| `src/typst.js`     | Emits a self-contained Typst document. |
| `templates/helpers.typ` | Page/style setup — edit to restyle every sheet. |
| `scripts/build.js` | CLI entry point. |

## Known limitations

- **Stratagems** are not in the dataset — add them manually in the army JSON.
- **Points** come from the catalogue's base unit cost; verify against the current
  Munitorum Field Manual for tournament-accurate totals.
- Weapon lists show **all** options on a datasheet, not a specific loadout.

## License

MIT (tool code). Game data is © Games Workshop and maintained by the BSData
community under their own terms.

# mk40k — 40k quick-reference sheets from New Recruit

Render a printable **PDF quick-reference sheet** for a Warhammer 40,000 army from
a roster you export in [New Recruit](https://newrecruit.eu) (or any app that
produces BattleScribe `rosterSchema` JSON). The export is already fully resolved,
so the sheet shows the exact units, loadouts, abilities, and points you picked —
for any faction, with no extra data to download.

![example](docs/example.png)

## Setup

```sh
brew install typst      # the PDF engine; macOS. See typst.app for other platforms.
# Node 18+ is required. No npm dependencies.
```

## Usage

1. In New Recruit, export your list as **BattleScribe / JSON**.
2. Run:

```sh
node scripts/build.js Fishies.json
# -> build/Fishies.typ   (intermediate, editable Typst source)
# -> build/Fishies.pdf   (opens automatically)
```

Flags:

- `--typ-only` — write the `.typ` but don't compile the PDF.
- `--no-open` — compile the PDF but don't open it.

The build prints a summary: army name, faction, detachment, points, and each
unit with its loadout.

## What's on the sheet

- **Roster table** — every unit in one row: M / T / Sv / Inv / W / Ld / OC / Pts.
- **Datasheets** — per unit: weapon tables (Rng / A / BS-WS / S / AP / D + keywords),
  abilities, keywords, and any enhancement.
- **Army rule** (e.g. Oath of Moment).

Roster exports don't include detachment-rule or stratagem text, so those are not
shown (the detachment name still appears in the header).

## How it works

| File | Role |
|------|------|
| `src/newrecruit.js` | Parses the roster export into a clean per-unit data model (stats, weapons, abilities, points) read straight from the file. |
| `src/typst.js` | Emits a self-contained Typst document. |
| `templates/helpers.typ` | Page/style setup — edit to restyle every sheet (US Letter, fonts, colors). |
| `scripts/build.js` | CLI: parse → render → compile → open. |

## License

MIT (tool code). Game data is © Games Workshop.

# Army JSON format

An army file describes what to put on the reference sheet. Save it under
`armies/` and build with `node scripts/build.js armies/<file>.json`.

## Top-level fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Title shown on the sheet. |
| `faction` | string | yes* | Used to pick the catalogue when `catalogues` is omitted. See the known list in `src/army.js` (`FACTION_CATALOGUES`). |
| `catalogues` | string[] | no | Explicit catalogue file names (without `.json`), e.g. `["Imperium - Space Marines"]`. Overrides `faction`. Linked catalogues load automatically. |
| `detachment` | string | no | Detachment name, e.g. `"Gladius Task Force"`. Used to find the matching enhancement pool. |
| `points` | number | no | Displayed in the header. Not computed. |
| `units` | Unit[] | yes | The units on the sheet (see below). |
| `stratagems` | Stratagem[] | no | Manual — the dataset has no stratagem text. |

\* Either `faction` (in the known list) or `catalogues` must be present.

## Unit

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sheet` | string | yes | Datasheet name, matched case-insensitively (e.g. `"Intercessor Squad"`, `"Ancient in Terminator Armour"`). |
| `models` | number | no | Model count in the unit (default 1); shown next to the name. |
| `enhancement` | string | no | Enhancement name from the detachment's pool; attached to this unit. |
| `attach` | string[] | no | Cosmetic — names of characters/units led by or attached to this one (not yet rendered specially). |
| `note` | string | no | Free text (reserved for future use). |

If a `sheet` name matches nothing, the build prints close matches. If it matches
several entries, the build uses the first `unit`-type entry and warns — rename to
a more specific datasheet if that's wrong.

## Stratagem

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Stratagem name. |
| `cp` | number | Command point cost. |
| `phase` | string | When it's used, e.g. `"Fight phase"`. |
| `text` | string | Full rules text (paste it once). |

## Example

See [`imperial-fists.json`](imperial-fists.json) for a complete 2000-point army.

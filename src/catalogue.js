// Load BSData wh40k-11e catalogue JSON files and build lookup indexes.
//
// A "catalogue" file (e.g. "Imperium - Space Marines.json") holds a tree of
// selectionEntries / sharedSelectionEntries / entryLinks / profiles. Units in
// one catalogue frequently live in another that it references via
// `catalogueLinks`, so we load the named catalogues plus everything they link
// to, transitively, and index every node by id for targetId resolution.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data', 'wh40k-11e');

// Depth-first walk over every plain object in a JSON tree.
export function* walk(node) {
  if (Array.isArray(node)) {
    for (const x of node) yield* walk(x);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const k of Object.keys(node)) yield* walk(node[k]);
  }
}

function catalogueFilePath(name) {
  return join(DATA_DIR, `${name}.json`);
}

// Build (once) a map of catalogue name -> filename by scanning the data dir.
// Filenames equal catalogue names in this dataset, but a stray mismatch would
// otherwise silently drop a linked catalogue, so we keep a fallback index.
let _fileIndex = null;
function fileIndex() {
  if (_fileIndex) return _fileIndex;
  _fileIndex = new Map();
  for (const f of readdirSync(DATA_DIR)) {
    if (f.endsWith('.json')) _fileIndex.set(f.slice(0, -5), f);
  }
  return _fileIndex;
}

function loadOne(name) {
  let path = catalogueFilePath(name);
  if (!existsSync(path)) {
    const alt = fileIndex().get(name);
    if (!alt) return null;
    path = join(DATA_DIR, alt);
  }
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return json.catalogue || json.gameSystem || json;
}

// Load the named catalogues and everything reachable through catalogueLinks.
// Returns { catalogues, byId, unitsByName, warnings }.
export function loadCatalogues(names) {
  const catalogues = [];
  const loaded = new Set();
  const missing = new Set();
  const queue = [...names];

  while (queue.length) {
    const name = queue.shift();
    if (loaded.has(name)) continue;
    loaded.add(name);
    const cat = loadOne(name);
    if (!cat) { missing.add(name); continue; }
    catalogues.push(cat);
    for (const link of cat.catalogueLinks || []) {
      if (link.name && !loaded.has(link.name)) queue.push(link.name);
    }
  }

  // Index every node that carries an id (for targetId resolution) and collect
  // unit/model entries by (lowercased) name for army matching.
  const byId = new Map();
  const unitsByName = new Map();
  for (const cat of catalogues) {
    for (const node of walk(cat)) {
      if (node.id && !byId.has(node.id)) byId.set(node.id, node);
      if ((node.type === 'unit' || node.type === 'model') && node.name) {
        const key = node.name.toLowerCase();
        if (!unitsByName.has(key)) unitsByName.set(key, []);
        unitsByName.get(key).push(node);
      }
    }
  }

  const warnings = [];
  if (missing.size) {
    warnings.push(`Catalogue files not found: ${[...missing].join(', ')}`);
  }
  return { catalogues, byId, unitsByName, warnings };
}

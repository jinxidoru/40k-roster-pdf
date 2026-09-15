// "Cards" renderer — one unit per card (overflowing to more cards as needed).
// The preview shows individual cards (the app renders each unit separately and
// adds a select checkbox); the PDF imposes the selected cards onto the print
// page. render(army, options, 'print') returns the imposed Typst doc.

import { bool } from './shared.js';
import {
  CARD_SIZES, resolveAccent, cardGroups, groupView,
  previewUnitDoc, imposeDoc, unitList, summaryCardDoc,
  rulesCardDoc, rulesCardHasContent,
} from './cards-lib.js';

const sizeChoices = Object.entries(CARD_SIZES).map(([value, s]) => ({ value, label: s.label }));

export default {
  id: 'cards',
  name: 'Cards',
  description: 'One unit per card; the PDF imposes the selected cards onto the page.',
  // Tells the app to use the per-card preview (individual cards + checkboxes).
  perCardPreview: true,
  // Suffix for the downloaded PDF filename: "Army Name (Cards).pdf".
  pdfSuffix: 'Cards',
  options: [
    {
      key: 'cardSize',
      label: 'Card size',
      type: 'select',
      default: 'tarot',
      help: 'Physical card size. Standard is Magic/Poker (63×88mm); Tarot is larger (70×120mm).',
      choices: sizeChoices,
    },
    {
      // Distinct key (not 'paper') so it doesn't share with Standard's page
      // size, whose A5/Half-Letter choices this renderer doesn't offer.
      key: 'cardPaper',
      label: 'Print page size',
      type: 'select',
      default: 'us-letter',
      help: 'Sheet the cards are imposed onto for the PDF. The preview always shows individual cards.',
      choices: [
        { value: 'us-letter', label: 'US Letter' },
        { value: 'a4', label: 'A4' },
      ],
    },
    {
      // Distinct key (not 'showPoints') so it keeps its own default and doesn't
      // link to Standard's roster Points column.
      key: 'summaryPoints',
      label: 'Points on summary card',
      type: 'bool',
      default: false,
      help: 'Show a Pts column on the army-summary card. Turn on to include each unit’s points cost.',
    },
    {
      key: 'opponentCopy',
      label: 'Summary card for opponent',
      type: 'bool',
      default: false,
      help: 'When the army-summary card is included, print a second copy — meant to hand to your opponent so they can see your army at a glance.',
    },
    {
      key: 'enhancementsWithUnit',
      label: 'Enhancements with unit',
      type: 'bool',
      default: false,
      help: 'On: show each enhancement on its unit’s card. Off (default): list them on the army rules card instead, under a clearly labelled “Enhancements” section.',
    },
    {
      key: 'accent',
      label: 'Color',
      type: 'color',
      default: 'faction',
      help: 'Accent color for titles, stat boxes, and the border. Default uses the army’s faction/sub-faction color; or pick another color.',
    },
    {
      key: 'invAtBottom',
      label: 'Inv Sv at bottom',
      type: 'bool',
      default: false,
      help: 'Place the invulnerable-save shield at the bottom of the stat rail. Off = just below the armour save (Sv).',
    },
  ],

  // Units available for selection: [{ index, name }].
  unitList,

  // Non-unit "aux" cards shown at the top of the preview, each a selectable card
  // (checkbox): the army summary (landscape, `wide`) and the army rules card.
  // The app renders each `doc` and passes back the selected `key`s.
  auxCards(army, options = {}) {
    const cards = [{
      key: 'summary',
      name: 'Army summary',
      wide: true, // landscape card — the preview gives it a wider cell
      doc: summaryCardDoc(army, options.cardSize, resolveAccent(options, army),
        { showPoints: !!options.summaryPoints }),
    }];
    if (rulesCardShown(army, options)) {
      cards.push({
        key: 'rules',
        name: 'Army rules',
        doc: rulesCardDoc(army, options.cardSize, resolveAccent(options, army),
          { withEnh: enhOnRulesCard(options) }),
      });
    }
    return cards;
  },

  // A standalone Typst doc for one card group's cards (per-card preview). `index`
  // is a datasheet-group index (see cardGroups). Enhancements stay on the unit
  // card only when "with unit" is on; otherwise they live on the rules card.
  previewUnit(army, index, options) {
    const g = cardGroups(army)[index];
    if (!g) return '';
    const view = groupView(g);
    if (enhOnRulesCard(options)) view.enhancements = [];
    return previewUnitDoc(view, options.cardSize, resolveAccent(options, army),
      { invBottom: !!options.invAtBottom });
  },

  // The imposed PDF of the selected card groups (defaults to all if unspecified).
  // Aux cards (summary, rules) are included per options.auxSelected — a list of
  // aux keys the user kept checked; when absent (e.g. CLI) all shown aux cards
  // are included. opponentCopy adds a second summary copy.
  render(army, options = {}, _mode = 'print') {
    const groups = cardGroups(army);
    const sel = Array.isArray(options.selected) ? options.selected : groups.map((_g, i) => i);
    const enhOnRules = enhOnRulesCard(options);
    const views = sel
      .filter((i) => groups[i])
      .map((i) => {
        const v = groupView(groups[i]);
        if (enhOnRules) v.enhancements = []; // shown on the rules card instead
        return v;
      });

    const rulesShown = rulesCardShown(army, options);
    const auxSel = Array.isArray(options.auxSelected)
      ? new Set(options.auxSelected)
      : new Set(['summary', ...(rulesShown ? ['rules'] : [])]); // default: all shown aux cards
    const summaryCopies = auxSel.has('summary') ? (options.opponentCopy ? 2 : 1) : 0;

    return imposeDoc(views, options.cardSize, options.cardPaper, resolveAccent(options, army), {
      army,
      summaryCopies,
      includeRules: rulesShown && auxSel.has('rules'),
      rulesEnhancements: enhOnRules,
      showPoints: !!options.summaryPoints,
      invBottom: !!options.invAtBottom,
    });
  },
};

// Enhancements go on the rules card (not the unit cards) unless "with unit" is on.
function enhOnRulesCard(options) {
  return !bool(options.enhancementsWithUnit, false);
}

// The rules card is always offered when it has content to show — the army &
// detachment rules, plus (unless they're on the unit cards) the enhancements.
function rulesCardShown(army, options) {
  return rulesCardHasContent(army, enhOnRulesCard(options));
}

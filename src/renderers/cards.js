// "Cards" renderer — one unit per card (overflowing to more cards as needed).
// The preview shows individual cards (the app renders each unit separately and
// adds a select checkbox); the PDF imposes the selected cards onto the print
// page. render(army, options, 'print') returns the imposed Typst doc.

import {
  CARD_SIZES, resolveAccent, cardGroups, groupView,
  previewUnitDoc, imposeDoc, unitList, summaryCardDoc,
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
      key: 'accent',
      label: 'Card color',
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

  // The army-summary card preview doc. Always available — the app shows it as a
  // selectable card (checkbox) alongside the units.
  summaryDoc(army, options) {
    return summaryCardDoc(army, options.cardSize, resolveAccent(options, army),
      { showPoints: !!options.summaryPoints });
  },

  // A standalone Typst doc for one card group's cards (per-card preview). `index`
  // is a datasheet-group index (see cardGroups).
  previewUnit(army, index, options) {
    const g = cardGroups(army)[index];
    if (!g) return '';
    return previewUnitDoc(groupView(g), options.cardSize, resolveAccent(options, army),
      { invBottom: !!options.invAtBottom });
  },

  // The imposed PDF of the selected card groups (defaults to all if unspecified).
  // The summary is included when its checkbox is selected (options.summarySelected);
  // opponentCopy adds a second copy.
  render(army, options = {}, _mode = 'print') {
    const groups = cardGroups(army);
    const sel = Array.isArray(options.selected) ? options.selected : groups.map((_g, i) => i);
    const views = sel
      .filter((i) => groups[i])
      .map((i) => groupView(groups[i]));
    const summaryCopies = options.summarySelected ? (options.opponentCopy ? 2 : 1) : 0;
    return imposeDoc(views, options.cardSize, options.cardPaper, resolveAccent(options, army), {
      army,
      summaryCopies,
      showPoints: !!options.summaryPoints,
      invBottom: !!options.invAtBottom,
    });
  },
};

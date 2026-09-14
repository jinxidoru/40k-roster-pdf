// "Cards" renderer — one unit per card (overflowing to more cards as needed).
// The preview shows individual cards (the app renders each unit separately and
// adds a select checkbox); the PDF imposes the selected cards onto the print
// page. render(army, options, 'print') returns the imposed Typst doc.

import { CARD_SIZES, resolveAccent, unitView, previewUnitDoc, imposeDoc, unitList, summaryCardDoc } from './cards-lib.js';

const sizeChoices = Object.entries(CARD_SIZES).map(([value, s]) => ({ value, label: s.label }));

export default {
  id: 'cards',
  name: 'Cards',
  description: 'One unit per card; the PDF imposes the selected cards onto the page.',
  // Tells the app to use the per-card preview (individual cards + checkboxes).
  perCardPreview: true,
  options: [
    {
      key: 'cardSize',
      label: 'Card size',
      type: 'select',
      default: 'standard',
      help: 'Physical card size. Standard is Magic/Poker (63×88mm).',
      choices: sizeChoices,
    },
    {
      key: 'paper',
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
      key: 'summaryCopies',
      label: 'Army summary card',
      type: 'select',
      default: '1',
      help: 'A landscape card at the top of the deck listing the whole army’s stats (name, faction, points, and every unit). Choose how many copies to print.',
      choices: [
        { value: '0', label: 'None' },
        { value: '1', label: '1 copy' },
        { value: '2', label: '2 copies' },
      ],
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
      label: 'Invuln at bottom',
      type: 'bool',
      default: false,
      help: 'Place the invulnerable-save shield at the bottom of the stat rail. Off = just below the armour save (Sv).',
    },
  ],

  // Units available for selection: [{ index, name }].
  unitList,

  // The army-summary card preview doc, or null when set to zero copies.
  summaryDoc(army, options) {
    return Number(options.summaryCopies) > 0
      ? summaryCardDoc(army, options.cardSize, resolveAccent(options, army))
      : null;
  },

  // A standalone Typst doc for one unit's cards (used by the per-card preview).
  previewUnit(army, index, options) {
    return previewUnitDoc(unitView(army.units[index]), options.cardSize, resolveAccent(options, army),
      { invBottom: !!options.invAtBottom });
  },

  // The imposed PDF of the selected units (defaults to all if none specified).
  render(army, options = {}, _mode = 'print') {
    const sel = Array.isArray(options.selected) ? options.selected : army.units.map((_u, i) => i);
    const views = sel
      .filter((i) => army.units[i])
      .map((i) => unitView(army.units[i]));
    return imposeDoc(views, options.cardSize, options.paper, resolveAccent(options, army), {
      army,
      summaryCopies: Number(options.summaryCopies) || 0,
      invBottom: !!options.invAtBottom,
    });
  },
};

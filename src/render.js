// Renderer registry. Each renderer is a module { id, name, description,
// options, render(army, options) -> Typst source }. Add new renderers (cards,
// a4, …) by importing them and listing them here.

import compact from './renderers/compact.js';

export const renderers = [compact];
export const byId = Object.fromEntries(renderers.map((r) => [r.id, r]));
export const defaultRenderer = compact;

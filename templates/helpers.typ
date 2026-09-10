// Style preamble for generated 40k quick-reference sheets.
// typst.js reads this file and prepends it to the generated document, so the
// output .typ is self-contained. Edit here to restyle every sheet.

#set page(paper: "a4", margin: (x: 9mm, y: 8mm))
#set text(font: ("Helvetica Neue", "Arial"), size: 7.6pt)
#set par(leading: 0.42em)

#let accent = rgb("#c8102e")      // Imperial Fists yellow reads poorly on white; red header bar
#let ink = rgb("#1a1a1a")
#let faint = luma(150)
#let band = luma(238)

#set table(inset: (x: 4pt, y: 2.2pt), stroke: 0.3pt + luma(200))

// A header cell (dark band, white bold text).
#let hc(body) = table.cell(fill: accent, text(fill: white, weight: "bold", size: 7pt, body))

// Sheet title block.
#let sheettitle(name, sub) = {
  block(width: 100%, fill: accent, inset: (x: 6pt, y: 5pt), radius: 2pt)[
    #text(fill: white, weight: "bold", size: 13pt, name)
    #h(1fr)
    #text(fill: white, size: 8pt, sub)
  ]
  v(2pt)
}

// Section heading.
#let section(title) = {
  v(4pt)
  block(width: 100%, fill: band, inset: (x: 5pt, y: 3pt), radius: 1.5pt)[
    #text(weight: "bold", size: 9pt, fill: ink, upper(title))
  ]
  v(2pt)
}

// Unit name row inside the detail section.
#let unitband(name, meta) = {
  block(width: 100%, inset: (x: 4pt, y: 2.5pt), fill: luma(248), stroke: (bottom: 0.6pt + accent))[
    #text(weight: "bold", size: 8.5pt, name)
    #h(1fr)
    #text(size: 7pt, fill: faint, meta)
  ]
}

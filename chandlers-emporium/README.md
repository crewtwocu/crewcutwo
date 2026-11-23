# Chandler’s Emporium — gallery site

Static site for an antiques shop (plain HTML/CSS/JS, no build step).

```
chandlers-emporium/
  index.html   page: hero, intro, spotlight, rooms, visit, footer, detail view
  styles.css   walnut / oxblood / brass styling
  script.js    renders rooms, spotlight and the detail view from items.js
  items.js     <- ALL PIECES LIVE HERE (one file to edit)
  img/         photos: <name>.jpg (~1600 px) and <name>-800.jpg (~800 px)
  CREDITS.md   source and licence for every image
```

## Preview locally

From the repo root:

```
cd chandlers-emporium && python3 -m http.server 8080
```

Then open http://localhost:8080/. A piece can be linked directly, e.g.
http://localhost:8080/#piece-block-shell-chest.

## Editing pieces

Open `items.js`. Each piece is one object (name, era, origin, material, blurb,
story, price, image, alt text, room). Rooms are listed in `CE_ROOMS`. Set
`featured: true` on the piece for the spotlight. Leave `price: ""` to show
"Price on request".

## Still placeholders (to do before going live)

- **All 11 pieces are SAMPLES.** The photos are CC0 images of objects at The
  Metropolitan Museum of Art (see `CREDITS.md`). They aren't shop stock and
  aren't for sale. Replace them with real pieces and photos, then remove the
  "Sample pieces, for display only" bar at the top of `index.html` and the
  sample wording in the footer.
- **Prices:** every piece shows "Price on request". A price entered on a piece
  still marked `sample: true` is labelled "(sample price)".
- **Visit details:** address, opening hours, phone and email are bracketed
  placeholders in the `#visit` section of `index.html`.
- **Shop story:** the intro is deliberately general. No history, owners or
  reviews have been written in.

## Not deployed

This folder isn't connected to any Render service and doesn't affect the live
Crew sites.

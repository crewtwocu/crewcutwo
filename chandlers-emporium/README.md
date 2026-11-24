# Chandler’s Emporium — gallery site

Static site for an antiques shop (plain HTML/CSS/JS, no build step).

```
chandlers-emporium/
  index.html   page: hero, intro, spotlight, rooms, visit, footer, detail view
  styles.css   walnut / oxblood / brass styling
  script.js    renders rooms, spotlight and the detail view from items.js
  items.js     <- ALL PIECES LIVE HERE (one file to edit)
  img/         photos: <name>.jpg (~1600 px) and <name>-600.jpg (~600 px)
  CREDITS.md   brief note on the photographs
```

## Preview locally

From the repo root:

```
cd chandlers-emporium && python3 -m http.server 8080
```

Then open http://localhost:8080/. A piece can be linked directly, e.g.
http://localhost:8080/#piece-gum-tree-landscape.

## Editing pieces

Open `items.js`. Each piece is one object (name, era, origin, material, blurb,
story, price, image, alt text, room). Rooms are listed in `CE_ROOMS`. Set
`featured: true` on the piece for the spotlight. Leave `price: ""` to show
"Price on request".

To add another view of the same piece (for example a lid open), set a
`gallery` array of `{ img, alt }` objects. The first view is the card image
if `img` is also set.

Prepare photos before adding them: long edge about 1600 px, a 600 px thumb
named `<stem>-600.jpg`, JPEG quality around 80, auto-oriented, with EXIF and
GPS metadata stripped.

## Still to confirm

- **Visit details:** the `#visit` section invites people to the shop and to
  enquire, but does not list an address, opening hours, phone or email until
  those are confirmed. Do not invent them.
- **Shop story:** the intro is deliberately general. No history, owners or
  reviews have been written in.

This folder is published as the Chandler’s Emporium demo. It does not affect
the live Crew marketplace sites.

## Pending photograph

A photograph of the embossed silver-plate coal scuttle (rose pattern, with a
scoop) could not be retrieved for this update. That piece is pending and is
not shown on the site yet.

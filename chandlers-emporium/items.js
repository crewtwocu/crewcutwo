/* =====================================================================
 * CHANDLER’S EMPORIUM — PIECES
 * =====================================================================
 * Edit this one file to change what's on the site. No build step.
 *
 * Every entry below is a SAMPLE for display only. The photos are
 * public-domain (CC0) museum images, not shop stock. See CREDITS.md.
 * To add a real piece: copy an entry, set sample: false, put its
 * photos in img/ (a ~1600px .jpg and an ~800px "-800.jpg"), and fill
 * in the fields. Use price: "" (or omit it) for "Price on request".
 *
 * Fields
 *   id          unique, lowercase-with-dashes (used in the #piece-... link)
 *   room        "furniture" | "china" | "collectibles"  (see ROOMS)
 *   name        plaque title
 *   era         date or period, e.g. "c. 1770"
 *   origin      place / maker, e.g. "Meissen, Germany"
 *   material    short medium line
 *   blurb       1–2 sentences shown on the card
 *   story       longer text for the detail view
 *   price       e.g. "$1,200" — or "" for "Price on request"
 *   img         file name in img/ without extension
 *   alt         description of the photo for screen readers
 *   sample      true = shows the SAMPLE tag
 *   featured    true = used in the spotlight (first one wins)
 * ===================================================================== */
window.CE_ROOMS = [
  { id: "furniture",    name: "Furniture",           note: "Chairs, chests and case pieces." },
  { id: "china",        name: "China & Porcelain",   note: "Plates, tureens, teapots and vases." },
  { id: "collectibles", name: "Collectibles",        note: "Small treasures: boxes, watches, silver." },
];

window.CE_ITEMS = [
  {
    id: "carved-side-chair", room: "furniture", sample: true,
    name: "Carved Mahogany Side Chair",
    era: "1755–75", origin: "American", material: "Carved mahogany, upholstered seat",
    blurb: "A pierced splat, a red drop-in seat and claw feet that grip the floor like they mean it.",
    story: "Chairs like this were made to be looked at as much as sat on. The back is cut through in a ribbon of carved mahogany, the front legs swell out and end in carved feet. A piece that has seen a few centuries of dinners.",
    price: "", img: "side-chair",
    alt: "Mahogany side chair with a pierced, carved back splat, a red upholstered seat and carved cabriole legs.",
  },
  {
    id: "block-shell-chest", room: "furniture", sample: true, featured: true,
    name: "Block-and-Shell Chest of Drawers",
    era: "1765–75", origin: "American", material: "Carved mahogany, brass hardware",
    blurb: "Four drawers, three carved shells and a gleam of old brass across a deep mahogany front.",
    story: "The front of this chest rises and falls in blocked panels, each crowned with a carved shell. Brass handles and escutcheons catch the light against the dark wood. A centrepiece for a hallway or bedroom, and a reminder of how much care went into everyday storage.",
    price: "", img: "chest-of-drawers",
    alt: "Mahogany chest of four drawers with a blocked front, three carved shells along the top drawer and brass handles.",
  },
  {
    id: "open-armchair", room: "furniture", sample: true,
    name: "Open Armchair",
    era: "1770–90", origin: "American", material: "Wood, upholstered seat",
    blurb: "Straight legs, a gently curving crest rail and a pierced back built for long conversations.",
    story: "A quieter, more architectural chair. Straight square legs and stretchers, sweeping arms, and a pierced back splat in the same family as the side chair beside it.",
    price: "", img: "armchair",
    alt: "Dark wooden armchair with a pierced back splat, curved arms, a pale upholstered seat and straight legs.",
  },
  {
    id: "powder-blue-teapots", room: "china", sample: true,
    name: "Pair of Powder-Blue Teapots",
    era: "c. 1662–1722", origin: "China", material: "Porcelain",
    blurb: "Twin covered pots in a deep powder blue, with tall arched handles and traces of gilding.",
    story: "A matched pair is always harder to find than a single piece. These covered pots, for tea or wine, share the same deep blue glaze, high looping handles and faded gilt decoration.",
    price: "", img: "blue-teapots",
    alt: "Two matching deep-blue porcelain covered teapots with tall arched handles, side by side.",
  },
  {
    id: "elephant-head-vase", room: "china", sample: true,
    name: "Elephant-Head Vase",
    era: "c. 1758", origin: "Sèvres, France", material: "Porcelain, gilding",
    blurb: "A pink lattice body, gilded feet and two elephant heads for handles. Nothing subtle about it.",
    story: "A theatrical piece in the rococo spirit. The body is painted with a pink lattice framing small flower sprays, the base sits on gilded scrolls, and the shoulders turn into elephant heads whose trunks curl out as candle arms.",
    price: "", img: "sevres-vase",
    alt: "Ornate porcelain vase with a pink lattice pattern, gilded base and elephant heads at the shoulders.",
  },
  {
    id: "armorial-sauce-tureen", room: "china", sample: true,
    name: "Covered Sauce Tureen",
    era: "1785–90", origin: "China, for the American market", material: "Porcelain, enamel colours",
    blurb: "A white tureen with a painted crest, scattered flowers and a gilded fruit finial on the lid.",
    story: "Porcelain made in China to order for overseas tables. The centre of the side carries a painted coat of arms, with sprays of flowers around it and a gilt fruit on the cover.",
    price: "", img: "sauce-tureen",
    alt: "White porcelain covered sauce tureen with a painted coat of arms, flower sprays and a gilded fruit-shaped finial.",
  },
  {
    id: "meissen-harbour-plate", room: "china", sample: true,
    name: "Painted Plate with Figures",
    era: "c. 1730–35", origin: "Meissen, Germany", material: "Porcelain, enamel and gilding",
    blurb: "Figures in a painted landscape, framed by gold scrollwork and tiny harbour scenes.",
    story: "Early Meissen at its most detailed. A crowd of small figures stands in the centre, surrounded by gilded scroll borders and panels of painted harbour views around the rim.",
    price: "", img: "meissen-plate",
    alt: "Porcelain plate painted with figures in a landscape, framed by gold scrollwork and small harbour scenes around the rim.",
  },
  {
    id: "open-face-pocket-watch", room: "collectibles", sample: true,
    name: "Open-Face Pocket Watch",
    era: "c. 1900", origin: "Paris, France", material: "Metal case, enamel dial",
    blurb: "A clean white dial, Roman numerals and a small seconds register. Quietly perfect.",
    story: "The kind of watch that was wound every morning and carried for a lifetime. A white dial with bold Roman numerals, slim hands and a subsidiary seconds dial above the six.",
    price: "", img: "pocket-watch",
    alt: "Open-face pocket watch with a white dial, black Roman numerals and a small seconds dial.",
  },
  {
    id: "painted-snuffbox", room: "collectibles", sample: true,
    name: "Painted Porcelain Snuffbox",
    era: "c. 1770", origin: "Nymphenburg, Germany", material: "Porcelain, gilt metal mounts",
    blurb: "A pocket-sized landscape painting with a hinged lid and gilded edges.",
    story: "Snuffboxes were made to be shown off. This one is painted on every side with small landscape scenes and held in gilt-metal mounts with a hinged lid.",
    price: "", img: "snuffbox",
    alt: "Small rectangular porcelain snuffbox painted with landscape scenes, with gilt metal edges and a hinged lid.",
  },
  {
    id: "shield-music-box", room: "collectibles", sample: true,
    name: "Shield-Shaped Musical Pendant",
    era: "c. 1815", origin: "Switzerland", material: "Enamel, pearl border, metal mount",
    blurb: "A rose on red enamel, edged in pearls, with a tune hidden inside.",
    story: "Small enough to hang from a chain, with a painted rose in the centre and a border of seed pearls. Inside sits a tiny music movement, which is the surprise.",
    price: "", img: "music-box",
    alt: "Shield-shaped pendant with a painted rose on red enamel inside a border of pearls, hanging from a ring.",
  },
  {
    id: "rococo-tea-caddy", room: "collectibles", sample: true,
    name: "Rococo Silver Tea Caddy",
    era: "1762–63", origin: "Britain", material: "Silver",
    blurb: "Scrolls, shells and flowers chased all over a waisted silver body. Built to guard the tea.",
    story: "Tea was once expensive enough to deserve its own locked box. This caddy is chased with rococo scrolls and flowers, stands on scrolled feet and has a flower finial on the lid.",
    price: "", img: "tea-caddy",
    alt: "Ornate silver tea caddy with chased scrolls, shells and flowers, standing on scrolled feet with a flower finial.",
  },
];

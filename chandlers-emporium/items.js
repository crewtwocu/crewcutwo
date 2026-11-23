/* =====================================================================
 * CHANDLER’S EMPORIUM — PIECES
 * =====================================================================
 * Edit this one file to change what's on the site. No build step.
 *
 * To add a piece:
 *   1. Put photos in img/: a ~1600px <stem>.jpg and a ~600px <stem>-600.jpg
 *      (JPEG quality ~80, auto-oriented, EXIF/GPS stripped).
 *   2. Copy an entry below, give it a unique id, and set img to the stem.
 *   3. For a second view of the same piece, add:
 *        gallery: [
 *          { img: "stem", alt: "..." },
 *          { img: "stem-open", alt: "..." }
 *        ]
 *   4. Leave price: "" for "Price on request".
 *
 * Fields
 *   id          unique, lowercase-with-dashes (used in the #piece-... link)
 *   room        one of the ids in CE_ROOMS
 *   name        plaque title
 *   era         period or "Date unknown" — hedge when the date is not known
 *   origin      place, style, or a visible signature / mark
 *   material    short medium line
 *   blurb       1–2 sentences shown on the card
 *   story       longer text for the detail view
 *   price       e.g. "$60 AUD" — or "" for "Price on request"
 *   img         file name in img/ without extension (primary / card image)
 *   alt         description of the primary photo for screen readers
 *   gallery     optional extra views: [{ img, alt }, ...]
 *   featured    true = used in the spotlight (first one wins)
 * ===================================================================== */
window.CE_ROOMS = [
  { id: "pictures",     name: "Pictures",        note: "Paintings, pictures and prints." },
  { id: "hearth",       name: "Hearth & camp",    note: "Camp ovens, coal boxes and the like." },
  { id: "silver",       name: "Silver",           note: "Silver-plate, cased sets and table pieces." },
  { id: "china",        name: "China",            note: "Tea sets and china." },
  { id: "glass",        name: "Glass",            note: "Bottles, decanters and glassware." },
  { id: "collectibles", name: "Collectibles",     note: "Figures, tools and other pieces." },
];

window.CE_ITEMS = [
  {
    id: "gum-tree-landscape", room: "pictures", featured: true,
    name: "Gum Tree Landscape",
    era: "Date unknown", origin: "Signed lower right", material: "Oil painting, gilt frame",
    blurb: "A framed oil of a gum tree landscape with two small figures, in sepia and blue tones, in a gilt frame.",
    story: "A framed oil painting of a gum tree landscape. Two small figures stand in the scene, painted in sepia and blue tones, inside a gilt frame. Signed lower right.",
    price: "", img: "gum-tree-landscape",
    alt: "Framed oil painting of a gum tree landscape with two small figures, in sepia and blue tones, in a gilt frame.",
  },
  {
    id: "courtesan-red-kimono", room: "pictures",
    name: "Courtesan in a Red Kimono",
    era: "Date unknown", origin: "Japanese style", material: "Possibly painted on ceramic or a similar hard surface",
    blurb: "A Japanese-style painting of a courtesan in a red kimono, with hair pins. A solid piece, with no glass.",
    story: "A Japanese-style painting of a courtesan in a red kimono, with hair pins. Unlike the other paintings, this is a solid piece with no glass. It is possibly painted on ceramic or a similar hard surface. Artist and date are not claimed here.",
    price: "", img: "courtesan-red-kimono",
    alt: "Japanese-style painting of a courtesan in a red kimono with hair pins, a solid piece with no glass.",
  },
  {
    id: "bush-camp", room: "pictures",
    name: "Bush Camp",
    era: "Date unknown", origin: "Signed Jude Hart", material: "Painting, framed under glass",
    blurb: "An Australian bush camp among gum trees, with tents and a campfire. Signed Jude Hart, framed under glass.",
    story: "A painting of an Australian bush camp among gum trees, with tents and a campfire. It is signed Jude Hart and framed under glass.",
    price: "", img: "bush-camp",
    alt: "Framed painting of an Australian bush camp with tents and a campfire among gum trees, signed Jude Hart.",
  },
  {
    id: "charles-iii-portrait", room: "pictures",
    name: "Portrait of King Charles III",
    era: "Date unknown", origin: "Unspecified", material: "Framed portrait print",
    blurb: "A framed portrait print of King Charles III in a red ceremonial military uniform.",
    story: "A framed portrait print of King Charles III, shown in a red ceremonial military uniform.",
    price: "", img: "charles-iii-portrait",
    alt: "Framed portrait print of King Charles III in a red ceremonial military uniform.",
  },
  {
    id: "goannas-dot-painting", room: "pictures",
    name: "Two Goannas",
    era: "Date unknown", origin: "Unspecified", material: "Dot-style painting on a white board",
    blurb: "A dot-style painting of two goannas on a white board, with blue dot borders.",
    story: "A dot-style painting of two goannas on a white board, with blue dot borders.",
    price: "$300 AUD", img: "goannas-dot-painting",
    alt: "Dot-style painting of two goannas, or lizards, on a white board with blue dot borders.",
  },
  {
    id: "pelican-dot-painting", room: "pictures",
    name: "Pelican with Fish",
    era: "Date unknown", origin: "Signed RJB 84", material: "Dot-style painting",
    blurb: "A dot-style painting of a pelican with fish, signed RJB 84.",
    story: "A dot-style painting of a pelican with fish. It is signed RJB 84.",
    price: "", img: "pelican-dot-painting",
    alt: "Dot-style painting of a pelican with fish, signed RJB 84.",
  },
  {
    id: "echidna-dot-painting", room: "pictures",
    name: "Echidna with Ants",
    era: "Date unknown", origin: "Signed RJB", material: "Dot-style painting",
    blurb: "A dot-style painting of an echidna with ants, signed RJB.",
    story: "A dot-style painting of an echidna with ants. It is signed RJB.",
    price: "$250 AUD", img: "echidna-dot-painting",
    alt: "Dot-style painting of an echidna with ants, signed RJB.",
  },
  {
    id: "camp-oven", room: "hearth",
    name: "Cast Iron Camp Oven",
    era: "Date unknown", origin: "Unspecified", material: "Cast iron",
    blurb: "A cast iron camp oven, shown from the lid.",
    story: "A cast iron camp oven, photographed from the lid. Priced at $60 AUD as marked on the tag.",
    price: "$60 AUD", img: "camp-oven",
    alt: "Cast iron camp oven, photographed from above, showing the lid.",
  },
  {
    id: "nick-ranger-camp-oven", room: "hearth",
    name: "Nick Ranger Camp Oven",
    era: "Date unknown", origin: "Nick Ranger", material: "Cast iron, spring handle",
    blurb: "A Nick Ranger cast iron camp oven with a spring handle.",
    story: "A Nick Ranger cast iron camp oven with a spring handle. Priced at $50 AUD as marked on the tag.",
    price: "$50 AUD", img: "nick-ranger-camp-oven",
    alt: "Nick Ranger cast iron camp oven with a spring handle.",
  },
  {
    id: "painted-coal-box", room: "hearth",
    name: "Painted Tole Coal Box",
    era: "Victorian style", origin: "Unspecified", material: "Painted tole, copper-tone handle and hinges",
    blurb: "A Victorian-style painted tole coal box, decorated with a bird on a blossom branch.",
    story: "A Victorian-style painted tole coal box, decorated with a bird on a blossom branch, with a copper-tone handle and hinges. A second photograph shows the box open, with the interior visible.",
    price: "", img: "painted-coal-box",
    alt: "Victorian-style painted tole coal box, closed, with a bird on a blossom branch and a copper-tone handle.",
    gallery: [
      { img: "painted-coal-box", alt: "Victorian-style painted tole coal box, closed, with a bird on a blossom branch and a copper-tone handle." },
      { img: "painted-coal-box-open", alt: "The same painted tole coal box, open, showing the interior." },
    ],
  },

  {
    id: "silver-plate-tea-service", room: "silver",
    name: "Silver-plate Tea Service",
    era: "Date unknown", origin: "Unspecified", material: "Silver-plate",
    blurb: "A silver-plate tea service, with teapots, hot water jugs, a sugar bowl and a tea strainer.",
    story: "A silver-plate tea service, including teapots, hot water jugs, a sugar bowl and a tea strainer, photographed on lace.",
    price: "", img: "silver-plate-tea-service",
    alt: "Silver-plate tea service with teapots, hot water jugs, a sugar bowl and a tea strainer, photographed on lace.",
  },
  {
    id: "cased-silver-cutlery", room: "silver",
    name: "Cased Silver Cutlery Set",
    era: "Date unknown", origin: "Unspecified", material: "Cased silver cutlery in a wooden box with red lining",
    blurb: "A cased silver cutlery set in a wooden box with red lining, including spoons, forks, a ladle and serving pieces.",
    story: "A cased silver cutlery set in a wooden box with a red lining. The box holds spoons, forks, a ladle and serving pieces. No sterling hallmarks are claimed here.",
    price: "", img: "cased-silver-cutlery",
    alt: "Cased silver cutlery set in a wooden box with red lining, showing spoons, forks, a ladle and serving pieces.",
  },

  {
    id: "floral-tea-set", room: "china",
    name: "Floral Tea Set",
    era: "Date unknown", origin: "Unspecified", material: "Ceramic, raised floral decoration",
    blurb: "A floral tea set with a teapot, four mugs and a matching tray, in a raised flower and basket-weave pattern.",
    story: "A ceramic tea set with raised floral and basket-weave decoration: a teapot, four mugs with twisted handles, and a matching tray. Tagged $50 for the set.",
    price: "$50 AUD", img: "floral-tea-set",
    alt: "Ceramic floral tea set with a teapot, four mugs and a matching tray, in a raised flower and basket-weave pattern, tagged $50 set.",
  },
  {
    id: "blue-floral-tea-set", room: "china",
    name: "Blue Floral China Tea Set",
    era: "Date unknown", origin: "Unspecified", material: "China",
    blurb: "A white china tea set with a blue floral pattern, shown on a tray on a carved wooden side table.",
    story: "A white china tea set with a blue floral pattern, including a pot, a jug, cups, saucers and a bowl. It is shown on a tray, on a carved wooden side table. The lamp, lower-shelf items and other pieces around the table are not part of this listing.",
    price: "", img: "blue-floral-tea-set",
    alt: "White china tea set with a blue floral pattern, including a pot, jug, cups, saucers and a bowl, shown on a tray on a carved wooden side table.",
  },
  {
    id: "millennium-bottle-2000", room: "glass",
    name: "2000 Millennium Bottle",
    era: "c. 2000", origin: "Unspecified", material: "Clear glass, gold neck foil, cork top",
    blurb: "A clear glass 2000 millennium novelty bottle, with gold neck foil and a cork top.",
    story: "A clear glass novelty bottle marked 2000, with gold foil around the neck and a cork top.",
    price: "", img: "millennium-bottle-2000",
    alt: "Clear glass 2000 millennium novelty bottle with gold neck foil and a cork top.",
  },
  {
    id: "pineapple-decanter", room: "glass",
    name: "Pineapple-pattern Decanter",
    era: "Date unknown", origin: "Unspecified", material: "Glass, ball stopper",
    blurb: "A gold-speckled pineapple-pattern glass decanter with a ball stopper.",
    story: "A glass decanter with a gold-speckled pineapple pattern and a ball stopper.",
    price: "", img: "pineapple-decanter",
    alt: "Gold-speckled pineapple-pattern glass decanter with a ball stopper.",
  },
  {
    id: "dolls-prams", room: "collectibles",
    name: "Two Vintage Dolls’ Prams",
    era: "Vintage", origin: "Unspecified", material: "Painted metal and fabric",
    blurb: "Two vintage dolls’ prams, shown side by side, each with a doll inside.",
    story: "Two vintage dolls’ prams in the foreground: one pale, with a baby doll in a navy outfit on a red spotted lining; the other white, with a floral hood and a doll in a pale blue dress. Further prams are visible behind them.",
    price: "", img: "dolls-prams",
    alt: "Two vintage dolls’ prams side by side, each shown with a doll inside.",
  },
  {
    id: "chime-clock", room: "collectibles",
    name: "Grandmother-style Chime Clock",
    era: "Date unknown", origin: "Unspecified", material: "Wood case, glass panel",
    blurb: "A grandmother-style chime clock in a dark wood case, with a Roman-numeral dial and hanging chime tubes behind glass.",
    story: "A grandmother-style chime clock in a dark wood case. The dial has Roman numerals and decorative corners, and three hanging chime tubes show behind a faceted glass panel. Tagged $550.",
    price: "$550 AUD", img: "chime-clock",
    alt: "Grandmother-style chime clock in a dark wood case, with a Roman-numeral dial and three hanging chime tubes behind a faceted glass panel, tagged $550.",
  },
  {
    id: "pewter-look-jugs", room: "collectibles",
    name: "Pewter-look Hot Water Jugs",
    era: "Date unknown", origin: "Unspecified", material: "Pewter-look metal",
    blurb: "A pair of pewter-look lidded hot water jugs.",
    story: "Two pewter-look lidded hot water jugs, one with a spout and a hinged lid. Tagged $15.",
    price: "$15 AUD", img: "pewter-look-jugs",
    alt: "Two pewter-look lidded hot water jugs, with a tag marked $15.",
  },
  {
    id: "carved-timber-figure", room: "collectibles",
    name: "Carved Timber Figure",
    era: "Date unknown", origin: "Unspecified", material: "Carved timber",
    blurb: "A tall carved timber figure with two faces.",
    story: "A tall carved timber figure with two faces, one turned slightly aside from the other. Maker and origin are not claimed here.",
    price: "", img: "carved-timber-figure",
    alt: "Tall carved timber figure with two faces.",
  },
  {
    id: "vintage-toys-and-trains", room: "collectibles",
    name: "Vintage Toys and Trains",
    era: "Vintage", origin: "Unspecified", material: "Assorted toys",
    blurb: "An assortment of vintage toys and trains, shown on the shelves of a glass-fronted cabinet.",
    story: "An assortment of vintage toys and trains, including several toy locomotives and other small toys, shown on the shelves of a glass-fronted cabinet.",
    price: "", img: "vintage-toys-and-trains",
    alt: "Assortment of vintage toy trains and other toys on the shelves of a glass-fronted cabinet.",
  },
  {
    id: "marble-figure", room: "collectibles",
    name: "Marble Figure of a Woman",
    era: "Date unknown", origin: "Unspecified", material: "Marble, matching pedestal",
    blurb: "A marble figure of a woman, cream or white, on a matching pedestal.",
    story: "A marble figure of a woman, cream or white in colour, standing on a matching marble pedestal.",
    price: "", img: "marble-figure",
    alt: "Cream or white marble figure of a woman standing on a matching marble pedestal.",
  },
  {
    id: "a1-bottle-jack", room: "collectibles",
    name: "A1 Bottle Jack",
    era: "Vintage", origin: "Marked A1", material: "Cast metal, steel base plate",
    blurb: "A vintage red cast bottle jack, marked A1, on a steel base plate, with worn paint and patina.",
    story: "A vintage red cast bottle jack, marked A1, standing on a steel base plate. The paint is worn and the metal has a patina.",
    price: "", img: "a1-bottle-jack",
    alt: "Vintage red cast bottle jack marked A1, on a steel base plate, with worn paint and patina.",
  },
];

/* Chandler’s Emporium — renders rooms, spotlight and the detail view from items.js. */
(function () {
  "use strict";
  var ROOMS = window.CE_ROOMS || [];
  var ITEMS = window.CE_ITEMS || [];
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function price(it) {
    var p = String(it.price || "").trim();
    if (!p) return "Price on request";
    return it.sample ? p + " (sample price)" : p;
  }
  function roomName(id) {
    for (var i = 0; i < ROOMS.length; i++) if (ROOMS[i].id === id) return ROOMS[i].name;
    return "";
  }
  function src(it, small) { return "img/" + it.img + (small ? "-800" : "") + ".jpg"; }
  var sampleTag = '<span class="sample-tag" title="Sample piece, for display only">Sample</span>';

  var yr = $("#year"); if (yr) yr.textContent = new Date().getFullYear();

  /* Nav */
  var toggle = $(".nav-toggle"), menu = $("#nav-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.setAttribute("aria-label", open ? "Open menu" : "Close menu");
      menu.classList.toggle("open", !open);
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) { menu.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    });
  }

  /* Spotlight */
  var feat = ITEMS.filter(function (i) { return i.featured; })[0] || ITEMS[0];
  var slot = $("#spotlight-slot");
  if (feat && slot) {
    slot.innerHTML =
      '<figure class="spot-figure">' +
        '<div class="frame frame--gilt"><img src="' + src(feat) + '" alt="' + esc(feat.alt) + '" loading="lazy" /></div>' +
      '</figure>' +
      '<div class="spot-copy">' +
        '<p class="kicker">Spotlight</p>' +
        '<h2 id="spotlight-title" class="section-title">' + esc(feat.name) + '</h2>' +
        '<p class="plaque-meta">' + esc(feat.era) + ' · ' + esc(feat.origin) + (feat.sample ? ' · ' + sampleTag : '') + '</p>' +
        '<p class="spot-story">' + esc(feat.story) + '</p>' +
        '<p class="plaque-price">' + esc(price(feat)) + '</p>' +
        '<button type="button" class="btn btn-brass" data-open="' + esc(feat.id) + '">View the piece</button>' +
      '</div>';
  }

  /* Rooms */
  var roomsSlot = $("#rooms-slot");
  var html = "";
  ROOMS.forEach(function (room, ri) {
    var pieces = ITEMS.filter(function (i) { return i.room === room.id; });
    if (!pieces.length) return;
    html += '<section class="room" id="room-' + room.id + '" data-room="' + room.id + '" aria-labelledby="room-' + room.id + '-title">' +
      '<header class="room-head"><span class="room-no" aria-hidden="true">Room ' + ["I", "II", "III", "IV", "V", "VI"][ri] + '</span>' +
      '<h3 id="room-' + room.id + '-title" class="room-title">' + esc(room.name) + '</h3>' +
      '<p class="room-note muted">' + esc(room.note) + '</p></header><ul class="grid">';
    pieces.forEach(function (it) {
      html += '<li class="card">' +
        '<button type="button" class="card-btn" data-open="' + esc(it.id) + '" aria-label="View ' + esc(it.name) + '">' +
          '<span class="card-img"><img src="' + src(it, true) + '" alt="' + esc(it.alt) + '" loading="lazy" decoding="async" /></span>' +
        '</button>' +
        '<div class="plaque">' +
          (it.sample ? sampleTag : '') +
          '<h4 class="plaque-title"><button type="button" class="link-btn" data-open="' + esc(it.id) + '">' + esc(it.name) + '</button></h4>' +
          '<p class="plaque-meta">' + esc(it.era) + ' · ' + esc(it.origin) + '</p>' +
          '<p class="plaque-blurb">' + esc(it.blurb) + '</p>' +
          '<p class="plaque-price">' + esc(price(it)) + '</p>' +
        '</div></li>';
    });
    html += '</ul></section>';
  });
  if (roomsSlot) roomsSlot.innerHTML = html;

  /* Room filter */
  var filter = $("#room-filter");
  if (filter) {
    var opts = [{ id: "all", name: "All rooms" }].concat(ROOMS);
    filter.innerHTML = opts.map(function (r, i) {
      return '<button type="button" class="chip" data-room="' + r.id + '" aria-pressed="' + (i === 0) + '">' + esc(r.name) + '</button>';
    }).join("");
    filter.addEventListener("click", function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      filter.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", String(c === b)); });
      var id = b.getAttribute("data-room");
      document.querySelectorAll(".room").forEach(function (s) { s.hidden = id !== "all" && s.getAttribute("data-room") !== id; });
    });
  }

  /* Detail view */
  var dlg = $("#viewer"), current = -1, lastFocus = null;
  function show(idx) {
    var it = ITEMS[idx]; if (!it) return;
    current = idx;
    var img = $("#viewer-img");
    img.src = src(it); img.alt = it.alt || "";
    $("#viewer-room").innerHTML = esc(roomName(it.room)) + (it.sample ? " " + sampleTag : "");
    $("#viewer-title").textContent = it.name;
    $("#viewer-meta").textContent = it.era + " · " + it.origin;
    $("#viewer-story").textContent = it.story || it.blurb;
    $("#viewer-facts").innerHTML =
      '<div><dt>Period</dt><dd>' + esc(it.era) + '</dd></div>' +
      '<div><dt>Origin</dt><dd>' + esc(it.origin) + '</dd></div>' +
      (it.material ? '<div><dt>Material</dt><dd>' + esc(it.material) + '</dd></div>' : '') +
      (it.sample ? '<div><dt>Note</dt><dd>Sample piece for display only. Photo: The Met, CC0.</dd></div>' : '');
    $("#viewer-price").textContent = price(it);
    if (history.replaceState) history.replaceState(null, "", "#piece-" + it.id);
  }
  function open(id) {
    var idx = ITEMS.findIndex(function (i) { return i.id === id; });
    if (idx < 0 || !dlg) return;
    lastFocus = document.activeElement;
    show(idx);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    document.body.classList.add("modal-open");
    $(".viewer-close", dlg).focus();
  }
  function close() {
    if (!dlg || !dlg.open) return;
    dlg.close ? dlg.close() : dlg.removeAttribute("open");
  }
  if (dlg) {
    dlg.addEventListener("close", function () {
      document.body.classList.remove("modal-open");
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg || e.target.closest("[data-close]")) {
        var toVisit = e.target.closest('a[href="#visit"]');
        close();
        if (toVisit) { e.preventDefault(); $("#visit").scrollIntoView({ behavior: "smooth" }); }
      }
    });
    $("#viewer-prev").addEventListener("click", function () { show((current - 1 + ITEMS.length) % ITEMS.length); });
    $("#viewer-next").addEventListener("click", function () { show((current + 1) % ITEMS.length); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") show((current - 1 + ITEMS.length) % ITEMS.length);
      if (e.key === "ArrowRight") show((current + 1) % ITEMS.length);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-open]");
    if (b) { e.preventDefault(); open(b.getAttribute("data-open")); }
  });
  var m = location.hash.match(/^#piece-(.+)$/);
  if (m) open(decodeURIComponent(m[1]));
})();

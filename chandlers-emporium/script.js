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
    return p || "Price on request";
  }
  function roomName(id) {
    for (var i = 0; i < ROOMS.length; i++) if (ROOMS[i].id === id) return ROOMS[i].name;
    return "";
  }
  function views(it) {
    if (it.gallery && it.gallery.length) return it.gallery;
    return [{ img: it.img, alt: it.alt || "" }];
  }
  function src(stem, small) { return "img/" + stem + (small ? "-600" : "") + ".jpg"; }
  function metaLine(it) {
    return [it.era, it.origin].filter(function (s) { return String(s || "").trim(); }).join(" · ");
  }

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
        '<div class="frame frame--gilt"><img src="' + src(feat.img) + '" alt="' + esc(feat.alt) + '" loading="lazy" /></div>' +
      '</figure>' +
      '<div class="spot-copy">' +
        '<p class="kicker">Spotlight</p>' +
        '<h2 id="spotlight-title" class="section-title">' + esc(feat.name) + '</h2>' +
        '<p class="plaque-meta">' + esc(metaLine(feat)) + '</p>' +
        '<p class="spot-story">' + esc(feat.story) + '</p>' +
        '<p class="plaque-price">' + esc(price(feat)) + '</p>' +
        '<button type="button" class="btn btn-brass" data-open="' + esc(feat.id) + '">View the piece</button>' +
      '</div>';
  }

  /* Rooms */
  var roomsSlot = $("#rooms-slot");
  var html = "";
  var numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  ROOMS.forEach(function (room, ri) {
    var pieces = ITEMS.filter(function (i) { return i.room === room.id; });
    if (!pieces.length) return;
    html += '<section class="room" id="room-' + room.id + '" data-room="' + room.id + '" aria-labelledby="room-' + room.id + '-title">' +
      '<header class="room-head"><span class="room-no" aria-hidden="true">Room ' + (numerals[ri] || (ri + 1)) + '</span>' +
      '<h3 id="room-' + room.id + '-title" class="room-title">' + esc(room.name) + '</h3>' +
      '<p class="room-note muted">' + esc(room.note) + '</p></header><ul class="grid">';
    pieces.forEach(function (it) {
      html += '<li class="card">' +
        '<button type="button" class="card-btn" data-open="' + esc(it.id) + '" aria-label="View ' + esc(it.name) + '">' +
          '<span class="card-img"><img src="' + src(it.img, true) + '" alt="' + esc(it.alt) + '" loading="lazy" decoding="async" /></span>' +
        '</button>' +
        '<div class="plaque">' +
          '<h4 class="plaque-title"><button type="button" class="link-btn" data-open="' + esc(it.id) + '">' + esc(it.name) + '</button></h4>' +
          '<p class="plaque-meta">' + esc(metaLine(it)) + '</p>' +
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
    var opts = [{ id: "all", name: "All rooms" }].concat(ROOMS.filter(function (r) {
      return ITEMS.some(function (i) { return i.room === r.id; });
    }));
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
  var dlg = $("#viewer"), current = -1, viewIdx = 0, lastFocus = null;

  function setView(it, vi) {
    var list = views(it);
    viewIdx = Math.max(0, Math.min(vi, list.length - 1));
    var v = list[viewIdx];
    var img = $("#viewer-img");
    img.src = src(v.img);
    img.alt = v.alt || it.alt || "";
    var thumbs = $("#viewer-thumbs");
    if (!thumbs) return;
    if (list.length < 2) { thumbs.hidden = true; thumbs.innerHTML = ""; return; }
    thumbs.hidden = false;
    thumbs.innerHTML = list.map(function (g, i) {
      return '<button type="button" class="viewer-thumb" data-view="' + i + '" aria-label="Photo ' + (i + 1) + ' of ' + list.length + '"' +
        (i === viewIdx ? ' aria-current="true"' : '') + '>' +
        '<img src="' + src(g.img, true) + '" alt="" />' +
        '</button>';
    }).join("");
  }

  function show(idx) {
    var it = ITEMS[idx]; if (!it) return;
    current = idx;
    setView(it, 0);
    $("#viewer-room").textContent = roomName(it.room);
    $("#viewer-title").textContent = it.name;
    $("#viewer-meta").textContent = metaLine(it);
    $("#viewer-story").textContent = it.story || it.blurb;
    var facts = "";
    if (it.era) facts += '<div><dt>Period</dt><dd>' + esc(it.era) + '</dd></div>';
    if (it.origin) facts += '<div><dt>Origin</dt><dd>' + esc(it.origin) + '</dd></div>';
    if (it.material) facts += '<div><dt>Material</dt><dd>' + esc(it.material) + '</dd></div>';
    $("#viewer-facts").innerHTML = facts;
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
      var thumb = e.target.closest("[data-view]");
      if (thumb && ITEMS[current]) {
        setView(ITEMS[current], Number(thumb.getAttribute("data-view")));
        return;
      }
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

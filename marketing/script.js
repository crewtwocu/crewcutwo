(function () {
  "use strict";

  /**
   * Wire marketing CTAs to the match app (see config.js).
   * Production: set window.CREW_APP_URL to your deployed origin (no trailing slash).
   */
  function crewAppBase() {
    var base = typeof window.CREW_APP_URL === "string" ? window.CREW_APP_URL.trim() : "";
    if (!base) base = "http://127.0.0.1:3847";
    return base.replace(/\/+$/, "");
  }

  function crewAppHref(path, query) {
    var p = path || "/";
    if (p.charAt(0) !== "/") p = "/" + p;
    var url = crewAppBase() + p;
    if (query) url += (query.charAt(0) === "?" ? query : "?" + query);
    return url;
  }

  document.querySelectorAll("a.js-crew-app").forEach(function (link) {
    var path = link.getAttribute("data-crew-path") || "/";
    var query = link.getAttribute("data-crew-query") || "";
    link.setAttribute("href", crewAppHref(path, query));
  });

  // Year in footer
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Mobile nav
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("nav-menu");

  function setMenuOpen(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      setMenuOpen(open);
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenuOpen(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setMenuOpen(false);
    });

    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 769px)").matches) setMenuOpen(false);
    });
  }

  // Subtle header elevation on scroll
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.style.boxShadow =
        window.scrollY > 8 ? "0 1px 0 rgba(28,36,48,0.06), 0 4px 16px rgba(15,20,25,0.04)" : "none";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();

/* Slide Productions — nav, form validation, resume inspection, FormSubmit wiring.
 * No build step. Reads window.SLIDE_CONFIG from config.js. */
(function () {
  "use strict";

  var CFG = window.SLIDE_CONFIG || {};
  var EMAIL = String(CFG.SUBMIT_EMAIL || "").trim();
  var MAX_MB = Number(CFG.MAX_RESUME_MB) || 5;
  var MAX_BYTES = MAX_MB * 1024 * 1024;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // Either a real address or FormSubmit's random-string alias (hex) after activation.
  var CONNECTED = EMAIL_RE.test(EMAIL) || /^[a-f0-9]{16,64}$/i.test(EMAIL);

  function $(id) { return document.getElementById(id); }

  /* ---------- Year + nav ---------- */
  var yr = $("year"); if (yr) yr.textContent = new Date().getFullYear();
  var toggle = document.querySelector(".nav-toggle");
  var menu = $("nav-menu");
  if (toggle && menu) {
    function setMenu(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("open", open);
      document.body.classList.toggle("nav-open", open);
    }
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setMenu(false);
    });
    document.addEventListener("click", function (e) {
      if (toggle.getAttribute("aria-expanded") === "true" && !e.target.closest(".nav")) {
        setMenu(false);
      }
    });
  }

  /* ---------- Reveal on load ---------- */
  requestAnimationFrame(function () { document.body.classList.add("ready"); });

  /* ---------- Form ---------- */
  var form = $("case-form");
  if (!form) return;
  var notConnected = $("not-connected");
  var sentOk = $("sent-ok");
  var formErr = $("form-err");
  var btn = $("submit-btn");
  var fileInput = $("resume");
  var fileName = $("resume-name");
  var fileErr = $("resume-err");

  // Success state: FormSubmit redirects back here with ?sent=1
  function showForm() {
    form.hidden = false;
    if (document.querySelector(".case-form-wrap")) {
      document.querySelector(".case-form-wrap").classList.remove("is-sent");
    }
  }
  function showSuccess() {
    sentOk.hidden = false;
    form.hidden = true;
    if (document.querySelector(".case-form-wrap")) {
      document.querySelector(".case-form-wrap").classList.add("is-sent");
    }
    setTimeout(function () { sentOk.focus(); }, 50);
  }
  if (/[?&]sent=1\b/.test(location.search)) {
    showSuccess();
  }
  var again = $("submit-again");
  if (again) {
    again.addEventListener("click", function () {
      sentOk.hidden = true;
      showForm();
      if (window.history && history.replaceState) {
        history.replaceState({}, "", location.pathname + location.hash);
      }
      var first = $("pitch");
      if (first) first.focus();
    });
  }

  if (CONNECTED) {
    // Files only travel with a normal multipart POST (FormSubmit's AJAX
    // endpoint does not carry attachments), so we post the form natively.
    form.action = "https://formsubmit.co/" + EMAIL; // e.g. https://formsubmit.co/name@example.com
    $("next-url").value = location.origin + location.pathname + "?sent=1#submit";
  } else {
    // Not configured: never submit anywhere.
    form.removeAttribute("action");
    notConnected.hidden = false;
  }

  function setErr(field, msg) {
    var el = $(field + "-err");
    var input = $(field);
    if (el) el.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (input && input.closest(".field")) input.closest(".field").classList.toggle("has-err", !!msg);
    return !msg;
  }

  function validateFields() {
    var ok = true;
    var pitch = $("pitch").value.trim();
    ok = setErr("pitch", !pitch ? "The story idea is missing. Tell us the idea."
      : pitch.length < 20 ? "Too thin. Give us at least 20 characters." : "") && ok;
    var name = $("name").value.trim();
    ok = setErr("name", name ? "" : "We need a name to put on the file.") && ok;
    var email = $("email").value.trim();
    ok = setErr("email", !email ? "We need an email to reach you."
      : !EMAIL_RE.test(email) ? "That email doesn't look right." : "") && ok;
    var PHONE_RE = /^[+()\d\s-]{6,40}$/;
    var mobile = $("mobile").value.trim();
    ok = setErr("mobile", mobile && !PHONE_RE.test(mobile)
      ? "That mobile number doesn't look right. Use digits, spaces, +, ( ) and - only." : "") && ok;
    var phone = $("phone").value.trim();
    ok = setErr("phone", phone && !PHONE_RE.test(phone)
      ? "That phone number doesn't look right. Use digits, spaces, +, ( ) and - only." : "") && ok;
    return ok;
  }

  ["pitch", "name", "email", "mobile", "phone"].forEach(function (id) {
    $(id).addEventListener("blur", function () {
      if (form.dataset.tried) validateFields();
    });
  });

  /* =====================================================================
   * RESUME INSPECTION (client-side)
   *
   * IMPORTANT: THIS IS NOT ANTIVIRUS. It runs in the visitor's browser and
   * can be bypassed by anyone who posts to the relay directly. It only
   * filters obvious junk and risky document features:
   *   - size (1 byte .. MAX_MB), allowed extensions (.pdf, .docx),
   *     double extensions / hidden characters in the name
   *   - declared MIME type
   *   - magic bytes (PDF "%PDF", DOCX "PK\x03\x04", legacy DOC D0 CF 11 E0)
   *   - PDF: /JavaScript, /JS, /Launch, /EmbeddedFile in the first 2 MB
   *     (including #xx-escaped names). Compressed object streams can still
   *     hide these.
   *   - DOCX: macro (vbaProject), ActiveX or embedded-object parts
   *   - legacy .doc is refused because macros can't be vetted here
   * Real malware scanning needs a server-side step (e.g. a small backend
   * running ClamAV or a scanning API). That is NOT built and needs Loki's
   * go-ahead before anything paid or hosted is added.
   * ===================================================================== */
  var fileState = { status: "none", promise: Promise.resolve(true) };
  var KNOWN_EXT = /^(pdf|docx?|docm|dotm|xlsx?|xlsm|pptx?|pptm|rtf|txt|exe|com|bat|cmd|scr|pif|msi|js|jse|vbs|vbe|wsf|hta|ps1|jar|lnk|zip|rar|7z|iso|img|html?|svg|sh|apk|dmg|app)$/i;
  var MIME = {
    pdf: ["application/pdf", "application/x-pdf"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    doc: ["application/msword"]
  };

  function rejectFile(msg) {
    fileState.status = "bad";
    fileErr.textContent = msg;
    fileInput.setAttribute("aria-invalid", "true");
    fileInput.closest(".field").classList.add("has-err");
    fileInput.closest(".file-drop").classList.remove("is-ok");
    return false;
  }
  function passFile(f) {
    fileState.status = "ok";
    fileErr.textContent = "";
    fileInput.setAttribute("aria-invalid", "false");
    fileInput.closest(".field").classList.remove("has-err");
    fileInput.closest(".file-drop").classList.add("is-ok");
    fileName.textContent = f.name + " · " + (f.size / 1024 / 1024).toFixed(2) + " MB · inspected, cleared";
    return true;
  }

  function readBytes(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(blob);
    });
  }
  function latin1(bytes) {
    var out = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return out;
  }
  function startsWith(bytes, sig) {
    if (bytes.length < sig.length) return false;
    for (var i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
    return true;
  }

  function inspect(f) {
    var name = f.name || "";
    // Hidden/bidi/control characters used to disguise extensions
    if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(name)) {
      return Promise.resolve(rejectFile("FILE REJECTED — filename contains hidden characters."));
    }
    var parts = name.toLowerCase().split(".");
    var ext = parts.length > 1 ? parts[parts.length - 1] : "";
    if (ext === "doc") {
      return Promise.resolve(rejectFile("FILE REJECTED — legacy .doc can't be checked for macros. Save it as PDF or DOCX and attach again."));
    }
    if (ext !== "pdf" && ext !== "docx") {
      return Promise.resolve(rejectFile("FILE REJECTED — wrong file type. PDF or DOCX only."));
    }
    for (var i = 1; i < parts.length - 1; i++) {
      if (KNOWN_EXT.test(parts[i])) {
        return Promise.resolve(rejectFile("FILE REJECTED — double extension (." + parts[i] + "." + ext + "). Rename it and try again."));
      }
    }
    if (f.size === 0) return Promise.resolve(rejectFile("FILE REJECTED — the file is empty."));
    if (f.size > MAX_BYTES) {
      return Promise.resolve(rejectFile("FILE REJECTED — exceeds " + MAX_MB + " MB (" + (f.size / 1024 / 1024).toFixed(1) + " MB)."));
    }
    // Browsers sometimes report "" for Office files; magic bytes decide then.
    if (f.type && MIME[ext].indexOf(f.type) === -1) {
      return Promise.resolve(rejectFile("FILE REJECTED — failed inspection (type " + f.type + " doesn't match ." + ext + ")."));
    }

    var scanLen = ext === "pdf" ? Math.min(f.size, 2 * 1024 * 1024) : f.size; // DOCX <= 5 MB: read whole
    return readBytes(f.slice(0, scanLen)).then(function (bytes) {
      if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
        return rejectFile("FILE REJECTED — failed inspection (legacy Office file disguised as ." + ext + ").");
      }
      if (ext === "pdf") {
        if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) { // %PDF
          return rejectFile("FILE REJECTED — failed inspection (not a real PDF).");
        }
        var text = latin1(bytes);
        var risky = null;
        (text.match(/\/[A-Za-z0-9#]+/g) || []).some(function (tok) {
          var n = tok.slice(1).replace(/#([0-9A-Fa-f]{2})/g, function (_, h) {
            return String.fromCharCode(parseInt(h, 16));
          });
          if (/^(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles)$/.test(n)) { risky = n; return true; }
          return false;
        });
        if (risky) return rejectFile("FILE REJECTED — failed inspection (PDF contains /" + risky + "). Export a plain PDF and try again.");
        return passFile(f);
      }
      // DOCX
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) { // PK\x03\x04
        return rejectFile("FILE REJECTED — failed inspection (not a real DOCX).");
      }
      var z = latin1(bytes); // zip entry names are stored as plain text
      if (z.indexOf("[Content_Types].xml") === -1 || z.indexOf("word/") === -1) {
        return rejectFile("FILE REJECTED — failed inspection (not a Word document).");
      }
      if (/vbaProject|vbaData|macroEnabled/i.test(z)) {
        return rejectFile("FILE REJECTED — failed inspection (contains macros).");
      }
      if (/word\/activeX\/|word\/embeddings\//i.test(z)) {
        return rejectFile("FILE REJECTED — failed inspection (contains embedded objects). Save a plain copy and try again.");
      }
      return passFile(f);
    }).catch(function () {
      return rejectFile("FILE REJECTED — couldn't read the file. Try again.");
    });
  }

  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) {
      fileState = { status: "none", promise: Promise.resolve(true) };
      fileName.textContent = "No file attached";
      fileErr.textContent = "";
      fileInput.closest(".field").classList.remove("has-err");
      fileInput.closest(".file-drop").classList.remove("is-ok");
      return;
    }
    fileName.textContent = f.name + " · inspecting…";
    fileState = { status: "checking" };
    fileState.promise = inspect(f).then(function (ok) {
      if (!ok) fileName.textContent = f.name + " · rejected";
      return ok;
    });
  });

  var submitting = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return;
    form.dataset.tried = "1";
    formErr.hidden = true;
    var fieldsOk = validateFields();
    btn.disabled = true;
    fileState.promise.then(function (fileOk) {
      btn.disabled = false;
      if (!fieldsOk || !fileOk) {
        formErr.textContent = !fileOk
          ? "Submission blocked. The attached file didn't pass inspection. Remove it or attach a clean PDF or DOCX."
          : "Submission blocked. Fix the marked fields and try again.";
        formErr.hidden = false;
        var bad = form.querySelector('[aria-invalid="true"]');
        if (bad) bad.focus();
        return;
      }
      if (!CONNECTED) {
        formErr.textContent = "Submissions not yet connected. Nothing was sent.";
        formErr.hidden = false;
        notConnected.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (!navigator.onLine) {
        formErr.textContent = "You look offline. Nothing was sent. Try again when you're connected.";
        formErr.hidden = false;
        return;
      }
      submitting = true;
      btn.disabled = true;
      btn.textContent = "Sending…";
      HTMLFormElement.prototype.submit.call(form); // native multipart POST to FormSubmit
    });
  });
})();

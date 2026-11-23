# Sly Productions — landing site

Static site (plain HTML/CSS/JS, no build step). *No story stays buried.*

```
sly-productions/
  index.html            v1 page
  v2-truth/index.html   v2 page
  v3-story/index.html   v3 page
  styles.css   case-file styling
  script.js    nav, form validation, resume inspection, form relay
  config.js    <- SUBMIT_EMAIL lives here
```

## Three versions

Identical pages except the hero tagline (plus matching `<title>`, meta and footer line).
All three share `styles.css`, `script.js` and `config.js` in this folder.

| Version | Path | Tagline |
|---|---|---|
| v1 | [`index.html`](index.html) | No story stays buried. |
| v2 | [`v2-truth/index.html`](v2-truth/index.html) | Truth doesn't expire. |
| v3 | [`v3-story/index.html`](v3-story/index.html) | Never let the truth get in the road of a good story. |

## Preview locally

From the repo root:

```
cd sly-productions && python3 -m http.server 8080
```

Then open http://localhost:8080/ (v1), http://localhost:8080/v2-truth/ (v2)
and http://localhost:8080/v3-story/ (v3). Serve from `sly-productions/` so the
v2 and v3 pages can reach the shared files at `../`.

## Where submissions go

The closed inbox is set in **`config.js`** (`SUBMIT_EMAIL`). If it is ever
emptied, the form sends nothing and shows **"Submissions not yet connected."**

Submissions go through [FormSubmit](https://formsubmit.co) (free). The story,
notes, name, email, mobile, other phone and resume attachment all travel in one
`multipart/form-data` POST to `https://formsubmit.co/<SUBMIT_EMAIL>`. FormSubmit's
AJAX endpoint does not carry files, so the form posts natively and FormSubmit
redirects back to `?sent=1`, which shows the success message.

**One-time activation (must be done):** the first submission makes FormSubmit
send an activation email to that inbox. Nothing is delivered until the link in
it is clicked.

**After activation:** FormSubmit gives a random-string alias for the address.
Put that alias in `SUBMIT_EMAIL` instead of the real address, so the address
isn't exposed in this public repo or the page source. The script accepts either.

## Resume checks — NOT antivirus

`script.js` inspects the resume in the browser, and blocks submit until it passes:

- 5 MB max; empty files rejected
- `.pdf` and `.docx` only; double extensions (e.g. `cv.exe.pdf`) and hidden or
  right-to-left characters in the filename rejected
- declared MIME type must match the extension (an empty type is left to the byte check)
- magic bytes: PDF must start with `%PDF`, DOCX with `PK\x03\x04`; legacy
  Office bytes (`D0 CF 11 E0`) are rejected
- PDF: rejected if `/JavaScript`, `/JS`, `/Launch` or `/EmbeddedFile` appear in
  the first 2 MB (including `#xx`-escaped names)
- DOCX: rejected if it holds macros (`vbaProject`), ActiveX or embedded objects
- legacy `.doc` is refused outright, because macros can't be vetted in the browser.
  Visitors are told to save as PDF or DOCX.

This is a filter, **not real malware scanning**. It runs on the visitor's machine,
can be bypassed by posting to the relay directly, and can't see inside
compressed PDF object streams. Real scanning needs a server-side step (e.g. a
small backend running ClamAV, or a scanning API) before files reach the inbox.
That is **not built** and needs Loki's go-ahead.

## Not deployed

This folder isn't wired to any Render service. Nothing in it affects the live Crew sites.

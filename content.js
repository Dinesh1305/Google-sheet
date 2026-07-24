/**
 * content.js
 * ------------------------------------------------------------------
 * Injected into every http(s) page (see manifest.content_scripts).
 * Its single responsibility is to EXTRACT data from the current
 * page when asked by the background worker, and return it.
 *
 * The extraction strategy is intentionally generic so the extension
 * works on *any* website out of the box:
 *   1. <title> and <meta> description
 *   2. Open Graph tags
 *   3. JSON-LD structured data
 *   4. Headings (h1/h2)
 *   5. All text inputs / textareas (handy for forms)
 *
 * The returned object is a single row (array of strings) plus the
 * raw metadata, so the background worker can write it into Sheets.
 */

(() => {
  "use strict";

  /** Convenience: safely query a selector. */
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  /** Read a <meta> tag by name or property. */
  function meta(name) {
    return (
      qs(`meta[name="${name}"]`)?.getAttribute("content") ||
      qs(`meta[property="${name}"]`)?.getAttribute("content") ||
      ""
    );
  }

  /** Extract Open Graph + standard metadata. */
  function extractMetadata() {
    return {
      url: location.href,
      title: document.title || meta("og:title"),
      description: meta("description") || meta("og:description"),
      siteName: meta("og:site_name"),
      author: meta("author"),
      keywords: meta("keywords"),
      ogType: meta("og:type"),
      ogImage: meta("og:image"),
    };
  }

  /** Parse any JSON-LD blocks on the page. */
  function extractJsonLd() {
    return qsa('script[type="application/ld+json"]')
      .map((s) => {
        try { return JSON.parse(s.textContent); } catch { return null; }
      })
      .filter(Boolean);
  }

  /** Collect visible form-field values. */
  function extractFormFields() {
    const fields = qsa("input, textarea, select");
    return fields
      .map((el) => ({
        name: el.name || el.id || el.placeholder || el.getAttribute("aria-label") || "field",
        value: el.value || "",
      }))
      .filter((f) => f.value.trim() !== "");
  }

  /** Build the flat row(s) that will be written into Sheets. */
  function buildRows(metaData, jsonLd, formFields) {
    // Primary row: URL, title, description, author, site name, type, date.
    const date = new Date().toISOString();
    const row = [
      metaData.url,
      metaData.title,
      metaData.description,
      metaData.author,
      metaData.siteName,
      metaData.ogType,
      date,
    ];

    // If JSON-LD describes an Article/Product with useful fields, append them.
    const ld = Array.isArray(jsonLd) ? jsonLd[0] : jsonLd;
    if (ld && typeof ld === "object") {
      const extras = ["headline", "articleBody", "price", "sku", "brand", "datePublished"]
        .map((k) => (ld[k] ? String(ld[k]) : ""))
        .filter(Boolean);
      if (extras.length) row.push(...extras);
    }

    // Append form field values (name: value) as extra columns.
    for (const f of formFields.slice(0, 10)) {
      row.push(`${f.name}: ${f.value}`);
    }

    return [row]; // single row by default
  }

  // ----------------------------------------------------------------
  //  Message listener
  // ----------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "EXTRACT_DATA") return;

    try {
      const metaData = extractMetadata();
      const jsonLd = extractJsonLd();
      const formFields = extractFormFields();
      const rows = buildRows(metaData, jsonLd, formFields);

      sendResponse({
        ok: true,
        data: {
          rows,
          meta: metaData,
          jsonLdCount: Array.isArray(jsonLd) ? jsonLd.length : jsonLd ? 1 : 0,
          formFieldCount: formFields.length,
        },
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
    return true; // async
  });
})();

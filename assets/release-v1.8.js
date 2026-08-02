(function attachGrindPsdReleaseV18(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDReleaseV18 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdReleaseV18() {
  "use strict";

  const VERSION = "1.8.0";
  const STYLE_ID = "grindPsdReleaseV18Styles";

  function versionedUrl(value) {
    if (!value) return value;
    try {
      const url = new URL(value, document.baseURI);
      url.searchParams.set("v", VERSION);
      return url.href;
    } catch (error) {
      return value;
    }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .auth-hero h2 {
        overflow-wrap: normal !important;
        word-break: keep-all !important;
      }
      .auth-hero > div:last-child {
        min-width: 0 !important;
      }
      @media (max-width: 390px) {
        .topbar .brand-mark {
          display: none !important;
        }
        .auth-hero {
          grid-template-columns: minmax(0, 1fr) !important;
        }
        .auth-hero .brand-mark.large {
          display: none !important;
        }
        .auth-hero > div:last-child {
          width: 100% !important;
        }
        .auth-hero h2 {
          max-width: 100% !important;
          white-space: normal !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function synchronizeVersionDom() {
    document.querySelector('meta[name="application-version"]')?.setAttribute("content", VERSION);
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) manifest.setAttribute("href", versionedUrl(manifest.getAttribute("href")));
    document.documentElement.dataset.appVersion = VERSION;

    const intro = document.querySelector("#settingsModal .modal-intro");
    if (intro) intro.textContent = String(intro.textContent || "").replace(/Grind-PSD\s+[0-9.]+/, `Grind-PSD ${VERSION}`);
    document.querySelectorAll("#settingsModal .app-about span").forEach((span) => {
      if (/^版本：/.test(span.textContent || "")) span.textContent = `版本：${VERSION}`;
    });
  }

  function install() {
    installStyles();
    synchronizeVersionDom();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  }

  return Object.freeze({ version: VERSION, versionedUrl });
});

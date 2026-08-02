(function bootstrapGrindPsdComparisonV15() {
  "use strict";

  function patchInteractiveSource(source) {
    const patched = String(source || "")
      .replace('pitchMax: 70,', 'pitchMax: 90,')
      .replace('version: "1.4.1",', 'version: "1.5.0",')
      .replace('data-view="pitch" type="range" min="10" max="70"', 'data-view="pitch" type="range" min="10" max="90"');
    if (!patched.includes('pitchMax: 90,') || !patched.includes('max="90"')) {
      throw new Error("Grind-PSD v1.5 pitch patch failed.");
    }
    return patched;
  }

  if (typeof module === "object" && module.exports) {
    const fs = require("node:fs");
    const path = require("node:path");
    const basePath = path.join(__dirname, "record-policy-core-v1.4-base.js");
    const source = patchInteractiveSource(fs.readFileSync(basePath, "utf8"));
    eval(source);
    return;
  }

  function loadTextSync(url) {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if (request.status && (request.status < 200 || request.status >= 300)) {
      throw new Error(`Unable to load Grind-PSD module: ${url} (${request.status})`);
    }
    return request.responseText;
  }

  function execute(source, sourceUrl) {
    const script = `${source}\n//# sourceURL=${sourceUrl}`;
    Function(script)();
  }

  const currentUrl = document.currentScript?.src || location.href;
  const baseUrl = new URL("./record-policy-core-v1.4-base.js?v=1.5.0", currentUrl).href;
  const pairUrl = new URL("./pair-compare-v1.5.js?v=1.6.0", currentUrl).href;
  execute(patchInteractiveSource(loadTextSync(baseUrl)), baseUrl);
  execute(loadTextSync(pairUrl), pairUrl);

  const responsiveStyle = document.createElement("style");
  responsiveStyle.textContent = ".pair-chart-shell{overflow:hidden!important}#canvasCmpPair2d{min-width:0!important;max-width:100%}";
  document.head.appendChild(responsiveStyle);
})();

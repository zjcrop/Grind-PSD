(function attachGrindPsdSieveProtocolV182(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDSieveProtocolV182 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdSieveProtocolV182() {
  "use strict";

  const VERSION = "1.8.2";
  const SHAKE_SECONDS_PER_SIEVE = 20;
  const SHAKE_FREQUENCY_HZ = 2;
  const SHAKE_CYCLES_PER_SIEVE = SHAKE_SECONDS_PER_SIEVE * SHAKE_FREQUENCY_HZ;
  const TAP_MESHES = Object.freeze([60, 80]);
  const NO_TAP_MESHES = Object.freeze([18, 24, 35]);
  const TAP_POSITIONS = 4;
  const TAPS_PER_POSITION = 2;
  const TOTAL_TAPS = TAP_POSITIONS * TAPS_PER_POSITION;
  const DEFAULT_TOTAL_DURATION_SEC = 5 * SHAKE_SECONDS_PER_SIEVE;
  const ADHESION_STATEMENT = "避免静电吸附、受潮吸附需要敲击侧面，使附着在筛网底部或侧壁的筛下粉落入下一层。";

  function numericMesh(value) {
    const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function protocolForMesh(mesh) {
    const value = numericMesh(mesh);
    const tapRequired = TAP_MESHES.includes(value);
    return Object.freeze({
      mesh: value,
      shakeSeconds: SHAKE_SECONDS_PER_SIEVE,
      shakeFrequencyHz: SHAKE_FREQUENCY_HZ,
      shakeCycles: SHAKE_CYCLES_PER_SIEVE,
      tapRequired,
      tappingProhibited: NO_TAP_MESHES.includes(value),
      tapPositions: tapRequired ? TAP_POSITIONS : 0,
      tapsPerPosition: tapRequired ? TAPS_PER_POSITION : 0,
      totalTaps: tapRequired ? TOTAL_TAPS : 0,
      tapTarget: tapRequired ? "筛框侧壁" : "",
      tapTiming: tapRequired ? "完成20秒水平往复后" : ""
    });
  }

  function defaultMethodText() {
    return "逐筛水平往复：每筛20秒、约2次/秒；18/24/35目禁敲；60/80目完成后沿筛框侧壁四方位各轻敲2次（共8次）";
  }

  function protocolSummary() {
    return {
      version: VERSION,
      durationSecPerSieve: SHAKE_SECONDS_PER_SIEVE,
      frequencyHzApprox: SHAKE_FREQUENCY_HZ,
      cyclesPerSieveApprox: SHAKE_CYCLES_PER_SIEVE,
      defaultTotalDurationSec: DEFAULT_TOTAL_DURATION_SEC,
      noTapMeshes: [...NO_TAP_MESHES],
      tapMeshes: [...TAP_MESHES],
      tapPositions: TAP_POSITIONS,
      tapsPerPosition: TAPS_PER_POSITION,
      totalTaps: TOTAL_TAPS,
      adhesionStatement: ADHESION_STATEMENT
    };
  }

  const api = Object.freeze({
    version: VERSION,
    SHAKE_SECONDS_PER_SIEVE,
    SHAKE_FREQUENCY_HZ,
    SHAKE_CYCLES_PER_SIEVE,
    DEFAULT_TOTAL_DURATION_SEC,
    TAP_MESHES,
    NO_TAP_MESHES,
    TAP_POSITIONS,
    TAPS_PER_POSITION,
    TOTAL_TAPS,
    ADHESION_STATEMENT,
    protocolForMesh,
    defaultMethodText,
    protocolSummary
  });

  if (typeof document === "undefined") return api;

  const runtimeRoot = typeof window !== "undefined" ? window : globalThis;
  const baseFreshWizard = typeof freshWizard === "function" ? freshWizard : null;
  let activeTimer = null;

  function applyNewRecordDefaults(wizard) {
    if (!wizard || wizard.mode !== "create") return wizard;
    if (Number(wizard.durationSec) === 60 || !Number.isFinite(Number(wizard.durationSec))) {
      wizard.durationSec = DEFAULT_TOTAL_DURATION_SEC;
    }
    if (!wizard.method || wizard.method === "手动水平往复筛分") wizard.method = defaultMethodText();
    return wizard;
  }

  if (baseFreshWizard) {
    freshWizard = function freshWizardV182() {
      return applyNewRecordDefaults(baseFreshWizard());
    };
  }
  if (typeof state !== "undefined" && state.wizard) applyNewRecordDefaults(state.wizard);

  function meshRow(mesh) {
    const protocol = protocolForMesh(mesh);
    const action = protocol.tapRequired
      ? `<strong>${mesh} 目：水平往复后必须侧壁轻敲</strong>
         <span>先水平往复 ${protocol.shakeSeconds} 秒，约 ${protocol.shakeFrequencyHz} 次/秒（约 ${protocol.shakeCycles} 次）；随后保持筛面水平，在筛框侧壁四个等距方位各轻敲 ${protocol.tapsPerPosition} 次，共 ${protocol.totalTaps} 次。只敲筛框，不敲筛网面或筛底。</span>`
      : `<strong>${mesh} 目：仅水平往复，禁止敲击</strong>
         <span>水平往复 ${protocol.shakeSeconds} 秒，约 ${protocol.shakeFrequencyHz} 次/秒（约 ${protocol.shakeCycles} 次）。本档不得增加敲击。</span>`;
    return `<div class="sieve-protocol-row" data-protocol-mesh="${mesh}">
      <div>${action}</div>
      <button class="ghost small sieve-protocol-timer" type="button" data-protocol-timer="${mesh}">20 秒计时</button>
    </div>`;
  }

  function protocolPanelHtml() {
    return `<section class="sieve-protocol-panel" id="sieveProtocolPanelV182" aria-labelledby="sieveProtocolTitleV182">
      <div class="sieve-protocol-head">
        <div>
          <span class="eyebrow">Grind-PSD 项目操作规程</span>
          <h3 id="sieveProtocolTitleV182">逐筛动作必须固定</h3>
        </div>
        <span class="protocol-version">v${VERSION}</span>
      </div>
      <p class="sieve-protocol-lead">所有筛档均采用水平往复 ${SHAKE_SECONDS_PER_SIEVE} 秒、约 ${SHAKE_FREQUENCY_HZ} 次/秒。敲击不是全筛通用动作，仅用于 60 目和 80 目细粉段。</p>
      <div class="sieve-protocol-list">
        ${[18, 24, 35, 60, 80].map(meshRow).join("")}
      </div>
      <p class="sieve-protocol-warning"><strong>必须保留：</strong>${ADHESION_STATEMENT}若仍出现受潮团聚或持续粘附，应记录异常，并在样品与筛具恢复干燥、环境平衡后重新测量；不得通过增加不定次数或加大力度强行过筛。</p>
      <p class="sieve-protocol-boundary">本规程采用 ISO 2591-1 的“固定装置、动作、时间并完整报告”的一般原则，并参考标准化水平运动与敲击组合的工程实践；20 秒、约 2 次/秒及四方位各 2 次是 Grind-PSD 为提高重复性设定的项目参数，不宣称等同于 ISO/ASTM 的统一方法。</p>
    </section>`;
  }

  function installProtocolPanel() {
    const step = document.getElementById("wizardStep3");
    if (!step || document.getElementById("sieveProtocolPanelV182")) return;
    const header = step.querySelector(".step-header");
    header?.insertAdjacentHTML("afterend", protocolPanelHtml());
    step.querySelectorAll("[data-protocol-timer]").forEach((button) => {
      button.addEventListener("click", () => startTimer(button));
    });
  }

  function startTimer(button) {
    if (activeTimer) {
      clearInterval(activeTimer.id);
      activeTimer.button.disabled = false;
      activeTimer.button.textContent = "20 秒计时";
      activeTimer = null;
    }
    let remaining = SHAKE_SECONDS_PER_SIEVE;
    button.disabled = true;
    button.textContent = `${remaining} 秒`;
    const id = setInterval(() => {
      remaining -= 1;
      button.textContent = remaining > 0 ? `${remaining} 秒` : "已完成 20 秒";
      if (remaining > 0) return;
      clearInterval(id);
      button.disabled = false;
      button.classList.add("protocol-complete");
      activeTimer = null;
      const mesh = Number(button.dataset.protocolTimer);
      if (TAP_MESHES.includes(mesh) && typeof toast === "function") {
        toast(`${mesh} 目：现在沿筛框侧壁四个等距方位各轻敲 2 次，共 8 次。`, "success");
      }
    }, 1000);
    activeTimer = { id, button };
  }

  function installInputDefaults() {
    const duration = document.getElementById("durationInput");
    const method = document.getElementById("methodInput");
    if (duration) {
      duration.defaultValue = String(DEFAULT_TOTAL_DURATION_SEC);
      if (duration.value === "60" || duration.value === "") duration.value = String(DEFAULT_TOTAL_DURATION_SEC);
      if (!duration.parentElement?.querySelector(".protocol-duration-help")) {
        duration.insertAdjacentHTML("afterend", `<span class="field-help protocol-duration-help">项目默认 ${DEFAULT_TOTAL_DURATION_SEC} 秒＝5 个筛档 × 每档 ${SHAKE_SECONDS_PER_SIEVE} 秒；侧壁轻敲时间不计入。</span>`);
      }
    }
    if (method) {
      method.defaultValue = defaultMethodText();
      if (!method.value || method.value === "手动水平往复筛分") method.value = defaultMethodText();
    }
  }

  function installStandardPage() {
    const list = document.querySelector("#tab-standard .protocol-steps");
    if (list && !document.getElementById("protocolStandardV182")) {
      const item = document.createElement("li");
      item.id = "protocolStandardV182";
      item.innerHTML = `<strong>固定逐筛动作与细粉释附</strong><span>18/24/35 目仅水平往复 20 秒、约 2 次/秒，禁止敲击；60/80 目完成相同水平动作后，在筛框侧壁四个等距方位各轻敲 2 次，共 8 次。${ADHESION_STATEMENT}不得敲击筛网面。</span>`;
      const fixed = [...list.children].find((node) => node.textContent.includes("固定方法"));
      if (fixed) fixed.insertAdjacentElement("afterend", item);
      else list.appendChild(item);
    }
    const note = document.querySelector("#tab-standard .source-note");
    if (note && !note.querySelector('[data-protocol-source="iso2591"]')) {
      note.insertAdjacentHTML("beforeend", ` 手工筛分的一般程序原则另参考 <a data-protocol-source="iso2591" href="https://www.iso.org/standard/7569.html" target="_blank" rel="noopener noreferrer">ISO 2591-1:1988</a>；水平运动与受控敲击组合的可重复机械实现参考 <a href="https://www.retsch.com/products/sieving/sieve-shakers/as-200-tap/" target="_blank" rel="noopener noreferrer">RETSCH AS 200 tap</a>。`);
    }
  }

  function installVersionLabel() {
    document.querySelector('meta[name="application-version"]')?.setAttribute("content", VERSION);
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) {
      const url = new URL(manifest.getAttribute("href"), document.baseURI);
      url.searchParams.set("v", VERSION);
      manifest.setAttribute("href", url.href);
    }
    const intro = document.querySelector("#settingsModal .modal-intro");
    if (intro) intro.textContent = String(intro.textContent || "").replace(/Grind-PSD\s+[0-9.]+/, `Grind-PSD ${VERSION}`);
    document.querySelectorAll("#settingsModal .app-about span").forEach((span) => {
      if (/^版本：/.test(span.textContent || "")) span.textContent = `版本：${VERSION}`;
    });
    document.documentElement.dataset.appVersion = VERSION;
  }

  function injectStyles() {
    if (document.getElementById("sieveProtocolV182Styles")) return;
    const style = document.createElement("style");
    style.id = "sieveProtocolV182Styles";
    style.textContent = `
      .sieve-protocol-panel{margin:0 0 18px;padding:16px;border:1px solid #27435c;border-radius:18px;background:linear-gradient(145deg,rgba(11,30,47,.96),rgba(3,10,17,.98))}
      .sieve-protocol-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
      .sieve-protocol-head h3{margin:4px 0 0;font-size:1.05rem}
      .protocol-version{padding:3px 8px;border:1px solid #315b7d;border-radius:999px;color:#8bc9ff;font-size:.76rem}
      .sieve-protocol-lead,.sieve-protocol-boundary{margin:8px 0;color:#aebdcb;line-height:1.6}
      .sieve-protocol-list{display:grid;gap:8px;margin:12px 0}
      .sieve-protocol-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 12px;border:1px solid #20384d;border-radius:12px;background:rgba(2,10,17,.66)}
      .sieve-protocol-row strong{display:block;color:#eaf4ff;margin-bottom:4px}
      .sieve-protocol-row span{display:block;color:#a8b7c5;font-size:.9rem;line-height:1.55}
      .sieve-protocol-timer{min-width:96px;white-space:nowrap}
      .sieve-protocol-timer.protocol-complete{border-color:#4f9f66;color:#8ee2a0}
      .sieve-protocol-warning{margin:10px 0 0;padding:11px 12px;border-left:3px solid #d89b45;background:rgba(83,50,13,.26);color:#e5d3b5;line-height:1.65}
      .sieve-protocol-boundary{font-size:.82rem}
      @media(max-width:560px){.sieve-protocol-row{grid-template-columns:1fr}.sieve-protocol-timer{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (runtimeRoot.__grindPsdSieveProtocolV182Installed) return;
    runtimeRoot.__grindPsdSieveProtocolV182Installed = true;
    injectStyles();
    installVersionLabel();
    installInputDefaults();
    installProtocolPanel();
    installStandardPage();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();

  return api;
});
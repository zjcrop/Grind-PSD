import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticUiTests(unittest.TestCase):
    def test_every_bound_static_id_exists(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        html_ids = set(re.findall(r"""\bid=["']([^"']+)["']""", html))
        bind_block = script.split("function bindEvents()", 1)[1].split(
            "function handleKeyboard", 1
        )[0]
        bound_ids = set(re.findall(r"""\$\(["']([^"']+)["']\)""", bind_block))
        self.assertEqual(sorted(bound_ids - html_ids), [])

    def test_required_flow_controls_are_present(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        for element_id in (
            "authModal",
            "authLoginPanel",
            "authRegisterPanel",
            "measurementStartBtn",
            "measurementWorkspace",
            "recordDetailUnit",
            "canvasRecordDetail",
            "wizardStep1",
            "wizardStep2",
            "wizardStep3",
            "wizardExit2",
            "wizardExit3",
        ):
            self.assertRegex(html, rf"""\bid=["']{re.escape(element_id)}["']""")

    def test_service_worker_uses_v132_network_first_shell(self):
        service_worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        pages_workflow = (
            ROOT / ".github" / "workflows" / "pages.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("grind-psd-shell-v1.7.0", service_worker)
        self.assertIn("./assets/supabase-sync-v7.2.2.js", service_worker)
        self.assertRegex(
            service_worker,
            r'endsWith\("/assets/app-v7\.js"\)[\s\S]+networkFirst\(request, SHELL_CACHE\)',
        )
        self.assertRegex(
            service_worker,
            r'endsWith\("/assets/supabase-sync-v7\.2\.2\.js"\)[\s\S]+networkFirst\(request, SHELL_CACHE\)',
        )
        self.assertIn("node --check assets/app-v7.js", pages_workflow)
        self.assertIn(
            "node --check assets/supabase-sync-v7.2.2.js",
            pages_workflow,
        )
        self.assertNotIn("node --check assets/supabase-sync.js", pages_workflow)
        self.assertNotIn("node --check assets/app-v4.js", pages_workflow)

    def test_all_canvas_charts_use_two_to_one_runtime_ratio(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        styles = (ROOT / "assets" / "styles-v5.css").read_text(encoding="utf-8")
        self.assertNotRegex(html, r"<canvas[^>]+\bheight=")
        self.assertIn("const height = Math.round(width / 2);", script)
        self.assertRegex(styles, r"canvas\s*\{[\s\S]*?aspect-ratio:\s*2\s*/\s*1")

    def test_local_only_runtime_and_persisted_login(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        init_block = script.split("async function init()", 1)[1].split(
            "function restoreLocalSession", 1
        )[0]
        self.assertIn("restoreLocalSession();", init_block)
        self.assertIn("if (!state.identityConfirmed)", init_block)
        self.assertNotIn("syncCommunity(", init_block)
        self.assertIn('id="syncBtn" type="button" hidden', html)
        self.assertIn('data-tab="syncLog" type="button" hidden', html)

    def test_save_ends_round_without_automatic_restart(self):
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        save_block = script.split("async function saveWizardRecord()", 1)[1].split(
            "function selectNewestRecord", 1
        )[0]
        self.assertIn('switchTab("measure")', save_block)
        self.assertIn("可继续开始下一次称测", save_block)
        self.assertNotIn("openWizard({ preferRecent: true })", save_block)

    def test_weighing_step_keeps_values_and_uses_blank_initial_mass(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        step2 = html[html.index('id="wizardStep2"'):html.index('id="wizardStep3"')]
        step3 = html[html.index('id="wizardStep3"'):html.index('id="settingsModal"')]
        fresh = script.split("function freshWizard()", 1)[1].split(
            "function defaultStore", 1
        )[0]
        step2_reader = script.split("function readWizardStep2()", 1)[1].split(
            "function buildWeighRows", 1
        )[0]
        save_block = script.split("async function saveWizardRecord()", 1)[1].split(
            "function selectNewestRecord", 1
        )[0]
        open_block = script.split("function openWizard(", 1)[1].split(
            "function isLastGrinderRecent", 1
        )[0]
        same_block = script.split("function sameAsLast()", 1)[1].split(
            "function goWizardStep", 1
        )[0]
        clone_block = script.split("function cloneAsRetest(", 1)[1].split(
            "function getRecordsForScope", 1
        )[0]

        self.assertNotIn('id="doseInput"', step2)
        self.assertIn("豆子初始质量 g", step3)
        self.assertRegex(
            step3,
            r'id="doseInput"[^>]+placeholder="请输入称测前的豆子质量"',
        )
        self.assertNotRegex(step3, r'id="doseInput"[^>]+\bvalue=')
        self.assertLess(step3.index('id="doseInput"'), step3.index('id="weighRows"'))
        self.assertIn("doseG: null", fresh)
        self.assertIn("function captureWeighingStep()", script)
        self.assertIn(
            'state.wizard.weightsGrams = Core.normalizeWeights(\n'
            "    state.wizard.weightsGrams,",
            step2_reader,
        )
        self.assertIn(
            '$("wizardBack3").addEventListener("click", returnFromWeighingStep)',
            script,
        )
        self.assertIn("captureWeighingStep();", save_block)
        self.assertIn("豆子初始质量", save_block)
        self.assertIn(
            'if (state.wizard.mode !== "edit-remote") state.wizard.doseG = null',
            open_block,
        )
        self.assertIn("doseG: null", same_block)
        self.assertIn("doseG: null", clone_block)

    def test_recovered_total_uses_the_active_sieve_profile(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        step3 = html[html.index('id="wizardStep3"'):html.index('id="settingsModal"')]
        reader = script.split("function readWeightInputs()", 1)[1].split(
            "function updateWeightSummary", 1
        )[0]

        self.assertIn("<span>回收总质量</span>", step3)
        self.assertNotIn("全部筛上 + 筛下合计", step3)
        self.assertIn(
            "const sieves = state.wizard?.sieveProfile?.bins || Core.SIEVES;",
            reader,
        )
        self.assertIn("return Core.normalizeWeights(weights, sieves);", reader)
        self.assertNotIn("return Core.normalizeWeights(weights);", reader)

    def test_grind_turns_is_adjacent_optional_and_persisted(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        core = (ROOT / "assets" / "psd-core.js").read_text(encoding="utf-8")
        schema = (ROOT / "data" / "record.schema.json").read_text(encoding="utf-8")
        step2 = html[html.index('id="wizardStep2"'):html.index('id="wizardStep3"')]

        self.assertIn("研磨圈数", step2)
        self.assertRegex(
            step2,
            r'id="turnsInput"[^>]+min="0"[^>]+step="0.01"',
        )
        self.assertLess(step2.index('id="dialInput"'), step2.index('id="turnsInput"'))
        self.assertLess(step2.index('id="turnsInput"'), step2.index('id="dialOrderInput"'))
        self.assertIn("settingTurns: null", script)
        self.assertIn('$("turnsInput").value = ""', script)
        self.assertIn("state.wizard.settingTurns =", script)
        self.assertIn("settingTurns: state.wizard.settingTurns", script)
        self.assertIn("record.grinder.settingTurns", script)
        self.assertIn('"setting_turns"', script)
        self.assertIn("settingTurns,", core)
        self.assertIn('"settingTurns"', schema)

    def test_multi_record_compare_and_mobile_cards(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        styles = (ROOT / "assets" / "styles-v5.css").read_text(encoding="utf-8")
        self.assertIn("MAX_COMPARE_RECORDS = 10", script)
        self.assertNotIn("activateTab(", script)
        self.assertIn('id="canvasCmpMulti3d"', html)
        self.assertIn("function drawMultiRecord3D(", script)
        self.assertIn(".record-table td::before", styles)
        for element_id in (
            "historyBrandFilter", "historyModelFilter", "historyDateFrom",
            "historyDateTo", "historySort", "compareHistorySelectionBtn",
        ):
            self.assertRegex(html, rf"""\bid=["']{element_id}["']""")

    def test_compact_history_and_multi_compare_only(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        styles = (ROOT / "assets" / "styles-v5.css").read_text(encoding="utf-8")
        self.assertIn('id="historyFilterModal"', html)
        self.assertIn('id="openHistoryFilterBtn"', html)
        self.assertIn('data-history-details', script)
        self.assertIn(".history-record-line", styles)
        self.assertIn(".current-summary-table", styles)
        self.assertIn(".legacy-bin-note", styles)
        self.assertNotIn("双记录重叠对比", html)
        self.assertNotIn('id="canvasCmp"', html)
        self.assertIn('data-tab="array3d" type="button">记录详情</button>', html)
        self.assertNotIn('data-tab="compare"', html)

    def test_verified_cloud_upload_ui(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        cloud = (ROOT / "assets" / "supabase-sync-v7.2.2.js").read_text(encoding="utf-8")
        styles = (ROOT / "assets" / "styles-v5.css").read_text(encoding="utf-8")
        self.assertIn('id="uploadCloudBtn"', html)
        self.assertIn('id="menuSyncDot"', html)
        self.assertIn("async function uploadAllRecordsToCloud()", script)
        self.assertIn("async function pushAndVerifyRecord(record)", script)
        self.assertIn("async function verifyRecord(record)", cloud)
        self.assertIn("measurement_fractions(", cloud)
        self.assertIn(".record-cloud-dot", styles)

    def test_mobile_export_and_complete_csv_are_supported(self):
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        workflow = (
            ROOT / ".github" / "workflows" / "pages.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("async function shareExportFile(", script)
        self.assertIn("navigator.canShare({ files: [file] })", script)
        self.assertIn("window.showSaveFilePicker", script)
        self.assertIn("EXPORT_URL_LIFETIME_MS", script)
        self.assertNotIn("setTimeout(() => URL.revokeObjectURL(url), 0)", script)
        self.assertIn("function exportFractionKeys(records)", script)
        self.assertIn("Core.getRecordSieves(record)", script)
        self.assertIn("sieve_profile_id", script)
        self.assertIn("node tests/test_mobile_io.js", workflow)

    def test_mobile_cloud_upload_recovery_is_supported(self):
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        cloud = (ROOT / "assets" / "supabase-sync-v7.2.2.js").read_text(
            encoding="utf-8"
        )
        legacy_cloud = (ROOT / "assets" / "supabase-sync.js").read_text(
            encoding="utf-8"
        )
        workflow = (
            ROOT / ".github" / "workflows" / "pages.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("function createUuidV4()", script)
        self.assertIn("globalThis.crypto?.getRandomValues", script)
        self.assertIn("const failures = [];", script)
        self.assertIn("uploaded += 1;", script)
        self.assertIn("REQUEST_TIMEOUT_MS = 20_000", cloud)
        self.assertIn("result.response.status === 401", cloud)
        self.assertIn("const refreshed = await refresh();", cloud)
        self.assertIn('cache: "no-store"', cloud)
        self.assertEqual(cloud, legacy_cloud)
        self.assertIn("node tests/test_cloud_sync.js", workflow)

    def test_manual_cloud_backup_includes_legacy_local_owners(self):
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        upload_block = script.split(
            "async function uploadAllRecordsToCloud()", 1
        )[1].split("function isValidUserId", 1)[0]
        self.assertIn("const localRecords = [...state.store.records];", upload_block)
        self.assertNotIn("record.user?.id === state.store.user.id", upload_block)

    def test_signup_redirects_to_project_directory(self):
        cloud = (ROOT / "assets" / "supabase-sync-v7.2.2.js").read_text(encoding="utf-8")
        self.assertIn("function authRedirectUrl()", cloud)
        self.assertIn("const SUPABASE_URL =", cloud)
        self.assertNotRegex(cloud, r"\bconst\s+URL\s*=")
        self.assertIn("new URL(", cloud)
        self.assertIn("redirect_to=${encodeURIComponent(authRedirectUrl())}", cloud)
        self.assertIn('hash.has("access_token")', cloud)
        self.assertIn('code === "otp_expired"', cloud)

    def test_canonical_url_and_legacy_v71_redirect(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        manifest = (ROOT / "manifest.webmanifest").read_text(encoding="utf-8")
        self.assertIn('rel="canonical" href="https://zjcrop.github.io/Grind-PSD/"', html)
        self.assertIn('location.search === "?v=7.1"', html)
        settings_block = html[html.index('id="settingsModal"'):]
        self.assertIn("版本：1.4.0", settings_block)
        topbar = html[html.index('<header class="topbar">'):html.index("</header>")]
        self.assertNotIn("正式版", topbar)
        self.assertIn("https://zjcrop.github.io/Grind-PSD/", readme)
        self.assertIn('"version": "1.7.0"', manifest)
        self.assertIn('name="application-version" content="1.4.0"', html)
        for asset in (
            "./manifest.webmanifest?v=1.4.0",
            "./assets/styles-v5.css?v=1.4.0",
            "./assets/psd-core.js?v=1.4.0",
            "./assets/supabase-sync-v7.2.2.js?v=1.4.0",
            "./assets/app-v7.js?v=1.4.0",
        ):
            self.assertIn(asset, html)
        self.assertIn('const APP_VERSION = "1.4.0"', script)

    def test_v12_measurement_home_and_adaptive_record_detail(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        nav = html[html.index('<nav class="tabs"'):html.index("</nav>")]
        measure_pos = nav.index('data-tab="measure"')
        current_pos = nav.index('data-tab="current"')
        self.assertLess(measure_pos, current_pos)
        self.assertIn('data-tab="measure" type="button">称测</button>', nav)
        self.assertNotIn("对比分析</button>", nav)
        self.assertIn('activeTab: "measure"', script)
        self.assertIn("prepareMeasurementPage();", script)
        self.assertIn("showMeasurementWorkspace();", script)
        self.assertIn("function renderRecordDetail()", script)
        self.assertIn("selectedLocalRecords.length > 1", script)
        self.assertIn('drawBarChart($("canvasRecordDetail")', script)
        self.assertIn('switchTab("array3d")', script)

    def test_single_history_detail_reuses_complete_current_record_summary(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        self.assertIn('id="singleRecordSummary"', html)
        self.assertIn("function renderRecordSummaryPanel(", script)
        self.assertIn(
            'renderRecordSummaryPanel(record, sourceLabel, { actions: true })',
            script,
        )
        detail_block = script.split("function renderRecordDetail()", 1)[1].split(
            "function renderMultiCompare", 1
        )[0]
        for expected in (
            "summaryContainer.innerHTML = renderRecordSummaryPanel",
            "本地历史记录",
            "完整记录",
            'drawBarChart($("canvasRecordDetail")',
        ):
            self.assertIn(expected, detail_block)

    def test_single_history_detail_tolerates_old_cached_html_shell(self):
        script = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        detail_block = script.split("function renderRecordDetail()", 1)[1].split(
            "function renderMultiCompare", 1
        )[0]
        self.assertIn(
            'const summaryContainer = $("singleRecordSummary") || $("singleRecordMeta")',
            detail_block,
        )
        self.assertIn("if (summaryContainer)", detail_block)
        self.assertIn("if (chartTitle)", detail_block)
        self.assertIn('grind-psd-shell-v1.7.0', worker)

    def test_samsung_safe_responsive_shell_and_reworked_controls(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "assets" / "app-v7.js").read_text(encoding="utf-8")
        css = (ROOT / "assets" / "styles-v5.css").read_text(encoding="utf-8")
        standard = html[html.index('id="tab-standard"'):html.index('id="historyFilterModal"')]
        history = html[html.index('id="tab-history"'):html.index('id="tab-array3d"')]
        topbar = html[html.index('<header class="topbar">'):html.index("</header>")]
        self.assertIn('class="gear-button"', topbar)
        self.assertIn('id="menuSyncDot"', topbar)
        self.assertNotIn('id="activeUserButtonText"', topbar)
        self.assertIn("称测数据质量可信度等级", standard)
        self.assertNotIn("数据库字段", standard)
        self.assertIn('class="pan-label"', app)
        self.assertIn('id="selectAllHistoryBtn"', history)
        self.assertIn('class="record-manage-menu"', history)
        self.assertNotIn("点击单行记录展开详情", history)
        self.assertIn("overflow-x: clip", css)
        self.assertIn("@media (max-width: 390px)", css)
        self.assertIn("grid-template-columns: minmax(0, 1fr) auto", css)
        self.assertIn("function selectAllHistory()", app)
        self.assertIn("updateNetworkStatus.hideTimer", app)


if __name__ == "__main__":
    unittest.main()

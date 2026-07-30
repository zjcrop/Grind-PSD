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
            "sel3dOverlay",
            "wizardStep1",
            "wizardStep2",
            "wizardStep3",
            "wizardExit2",
            "wizardExit3",
        ):
            self.assertRegex(html, rf"""\bid=["']{re.escape(element_id)}["']""")

    def test_service_worker_uses_v70_network_first_shell(self):
        service_worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        pages_workflow = (
            ROOT / ".github" / "workflows" / "pages.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("grind-psd-shell-v7.0.0", service_worker)
        self.assertIn("./assets/supabase-sync.js", service_worker)
        self.assertRegex(
            service_worker,
            r'endsWith\("/assets/app-v7\.js"\)[\s\S]+networkFirst\(request, SHELL_CACHE\)',
        )
        self.assertIn("node --check assets/app-v7.js", pages_workflow)
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
        self.assertIn("点击“开始称测”可进行下一次测量", save_block)
        self.assertNotIn("openWizard({ preferRecent: true })", save_block)

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


if __name__ == "__main__":
    unittest.main()

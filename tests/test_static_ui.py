import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticUiTests(unittest.TestCase):
    def test_every_bound_static_id_exists(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "app-v4.js").read_text(encoding="utf-8")
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
            "syncChoiceModal",
            "wizardStep1",
            "wizardStep2",
            "wizardStep3",
            "wizardExit2",
            "wizardExit3",
        ):
            self.assertRegex(html, rf"""\bid=["']{re.escape(element_id)}["']""")

    def test_service_worker_uses_v4_network_first_shell(self):
        service_worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        self.assertIn("grind-psd-shell-v4.0.0", service_worker)
        self.assertRegex(
            service_worker,
            r'endsWith\("/assets/app-v4\.js"\)[\s\S]+networkFirst\(request, SHELL_CACHE\)',
        )


if __name__ == "__main__":
    unittest.main()

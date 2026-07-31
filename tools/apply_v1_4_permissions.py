from pathlib import Path

# Triggered after the workflow file exists on the feature branch.
ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


index = read("index.html").replace("1.3.2", "1.4.0")
index = replace_once(
    index,
    '  <script src="./assets/app-v7.js?v=1.4.0" defer></script>',
    '  <script src="./assets/app-v7.js?v=1.4.0" defer></script>\n'
    '  <script src="./assets/record-policy-core-v1.4.js?v=1.4.0" defer></script>\n'
    '  <script src="./assets/permissions-v1.4.js?v=1.4.0" defer></script>',
    "index script insertion",
)
write("index.html", index)

app = read("assets/app-v7.js")
app = replace_once(
    app,
    "// Grind-PSD 1.3.2 application shell and Supabase-aware interaction state machine.",
    "// Grind-PSD 1.4.0 application shell; permission overrides load from permissions-v1.4.js.",
    "app version comment",
)
app = replace_once(app, 'const APP_VERSION = "1.3.2";', 'const APP_VERSION = "1.4.0";', "app version")
write("assets/app-v7.js", app)

worker = read("service-worker.js").replace("1.3.2", "1.4.0")
worker = replace_once(
    worker,
    '  "./assets/app-v7.js",',
    '  "./assets/app-v7.js",\n'
    '  "./assets/record-policy-core-v1.4.js",\n'
    '  "./assets/permissions-v1.4.js",',
    "service worker shell entries",
)
worker = replace_once(
    worker,
    '    url.pathname.endsWith("/assets/app-v7.js") ||',
    '    url.pathname.endsWith("/assets/app-v7.js") ||\n'
    '    url.pathname.endsWith("/assets/record-policy-core-v1.4.js") ||\n'
    '    url.pathname.endsWith("/assets/permissions-v1.4.js") ||',
    "service worker network-first entries",
)
write("service-worker.js", worker)

manifest = read("manifest.webmanifest").replace('"version": "1.3.2"', '"version": "1.4.0"')
write("manifest.webmanifest", manifest)

pages = read(".github/workflows/pages.yml")
pages = replace_once(
    pages,
    "          node --check assets/app-v7.js\n",
    "          node --check assets/app-v7.js\n"
    "          node --check assets/record-policy-core-v1.4.js\n"
    "          node --check assets/permissions-v1.4.js\n",
    "pages syntax checks",
)
pages = replace_once(
    pages,
    "          node tests/test_cloud_sync.js\n",
    "          node tests/test_cloud_sync.js\n"
    "          node tests/test_permissions_v14.js\n",
    "pages v1.4 tests",
)
write(".github/workflows/pages.yml", pages)

readme = read("README.md")
marker = "## v1.4 权限与对比模型"
if marker not in readme:
    readme += """

## v1.4 权限与对比模型

- 普通账户只编辑或删除当前浏览器中的本地副本；登录同步仅只读拉取，不自动回写云端。
- 新测次在开始时生成隐藏且不可变的结构化主键：用户 2 位 + 邮箱 2 位 + YYMMDD + Base36 日序 3 位 + Base36 时间校验 2 位。旧 `gpsd-*` 主键继续兼容。
- 只有显式点击“上传到服务器”才会写入云端；相同隐藏主键视为同一次测试并覆盖，主键不同则建立新测次。
- `zj_crop@163.com` 由 Supabase JWT 邮箱与 RLS 共同识别为管理员，可读取、更新和删除全部在线记录。
- 多记录对比按实际粒径区间建立并集，缺失区间补 0%，纵轴固定为百分比；不同边界不执行无依据的拆分或插值。
- 数据库权限与原子替换函数见 `supabase/migrations/20260731_record_permissions.sql`，部署前必须由数据库所有者应用。
"""
write("README.md", readme)

print("Applied Grind-PSD v1.4 permission, identity and comparison patches.")

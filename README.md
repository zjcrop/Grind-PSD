# Grind-PSD

Grind-PSD 是一个按“五张筛网、六个质量分段”记录、绘制和比较咖啡研磨粒径分布的深色 PWA 工具。1.2 版采用本地优先架构，并通过 Supabase Auth、PostgreSQL 与 RLS 提供个人云端同步。

## 在线访问

- 正式网址：<https://zjcrop.github.io/Grind-PSD/>
- 旧网址 <https://zjcrop.github.io/Grind-PSD/?v=7.1> 仍可访问，并会自动跳转到不带版本参数的正式网址。

## 1.2

- “称测”是默认首页，称测录入在该页内完成；保存后仍停留在称测页，便于连续操作。
- 顶部“开始称测”会自动返回称测页并启动新一轮，但打开应用时不会自动开始。
- 单条记录详情与多记录对比已合并：选择 1 条显示二维柱状图，选择 2–10 条自动切换为对比分析。
- 独立“对比分析”页面已删除。

- “数据与 App”菜单新增“上传到服务器”。
- 上传完成后从 Supabase 回读测次主表和全部粒径分段，逐项核对本地数据。
- 顶部菜单状态点区分上传中、成功与失败；历史记录仅在云端校验一致后显示绿点。
- 本地记录发生修改后，旧的云端确认标记自动失效，直到重新上传并通过校验。

## 核心功能

- 云端账户：邮箱和密码由 Supabase Auth 管理，自定义用户 ID 写入个人档案。
- 手动启动：打开应用后保持在主界面，只有点击“开始称测”才进入设备、刻度和六分段称重流程。
- 单轮结束：保存记录后关闭称测流程，不自动开始下一轮。
- 本地优先：品牌、型号、刻度和测量记录先写入浏览器 `localStorage`；断网仍可使用，登录联网后与 Supabase 核对。
- 数据隔离：所有业务表启用 RLS，只允许认证用户读写 `auth.uid()` 对应数据。
- 数据交换：磨豆机、筛网组、测次和粒径分段采用独立共享数据模型；`source_app` 标记来源应用，其他项目可在同一用户授权下复用。
- 图表：单条柱状图、记录详情阵列及最多 10 条记录的 3D 多测次对比。
- 紧凑记录：历史记录默认仅显示时间、型号/刻度和可靠性，点击后展开完整详情；筛选与排序收纳在弹窗中。
- 严格比例：全部 Canvas 图表的 CSS 显示尺寸与内部像素画布均固定为宽高 2:1；窗口尺寸变化时按当前容器宽度重新计算。
- PWA：首次联网加载后可安装到主屏幕并离线使用核心记录和绘图功能。

## 固定测量体系

标准 ID：`grind-psd-sieve-v2`

| 记录档 | 标称粒径范围 | 数据字段 |
|---|---:|---|
| ≥1000 µm | ≥1000 µm | `gte1000_g` |
| 800–1000 µm | 800–1000 µm | `um800_1000_g` |
| 500–800 µm | 500–800 µm | `um500_800_g` |
| 300–500 µm | 300–500 µm | `um300_500_g` |
| 80目筛上 | 180–300 µm | `mesh80_retained_g` |
| 低于80目（筛下） | <180 µm | `pan_lt180_g` |

五张筛网产生六份样品：五层筛上物与最后底盘筛下物。默认80目筛上为180–300 µm，筛下极细粉为<180 µm。跨设备比较以实际孔径区间和相同筛分方法为准；自定义筛网必须填写孔径，系统按相邻孔径自动生成区间。

## 数据、同步与隐私

1.2 版的密码不会写入本地业务数据或 GitHub。浏览器仅保存 Supabase 会话；公开仓库只包含 Publishable Key，业务安全由 Auth JWT 与 RLS 共同保证。Secret Key 和 `service_role` 不进入前端。

云端结构包含 `profiles`、`grinders`、`sieve_sets`、`measurements`、`measurement_fractions`、`app_settings`、`sync_tombstones` 和 `data_schema_versions`。旧五段数据存入 `legacy_payload` 并标记为 `legacy-five-bin`，不会伪造拆分。

仓库中的 `data/database.json` 仅作为旧版兼容文件，不再是个人数据同步目标。

## 部署

源码位于 `main`。GitHub Pages 工作流会校验静态文件并发布网页运行资源。应用不需要构建工具，静态服务器直接提供仓库根目录即可。

本地检查：

```bash
node --check assets/psd-core.js
node --check assets/supabase-sync-v7.2.2.js
node --check assets/app-v7.js
node tests/test_core.js
python -m unittest discover -s tests -p "test_*.py"
```

## 许可

- 程序代码：MIT，见 [`LICENSE`](LICENSE)。
- 既有社区数据许可说明保留在 [`DATA_LICENSE.md`](DATA_LICENSE.md)。

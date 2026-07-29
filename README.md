# Grind-PSD

Grind-PSD 是一个公开的咖啡研磨粒径分布记录、共享与对比工具。当前 v3.0 以项目原始单文件工具为交互基线，保留三步称重向导、历史记录、研磨刻度 3D 阵列图和双色重叠对比，并增加标准化社区数据库、按用户 ID 独立归档、旧数据迁移和 PWA App 安装能力。

在线使用：

- <https://zjcrop.github.io/Grind-PSD/>

## 功能

- 原版三步流程：选择品牌/型号 → 录入刻度与条件 → 五档称重。
- 原版图表：单条柱状图、同一磨豆机多刻度 3D 阵列、两条记录重叠比较、两组阵列并排比较。
- 本地优先：记录保存在浏览器；支持 JSON 备份、旧版 JSON 导入和 CSV 导出。
- 旧数据兼容：首次运行会自动迁移 `grindAnalyzerV1` 与 `grindPsdAppV2` 的浏览器记录。
- 社区数据库：下载、筛选、导入或比较其他用户的公开结果。
- 独立用户库：总库位于 `data/database.json`，每个用户另存于 `data/users/<user_id>.json`。
- 安全上传：网页生成 GitHub Issue；Actions 在服务端校验后入库，前端不保存 GitHub 写入令牌。
- PWA App：Android、iOS、Windows 和 macOS 的支持浏览器可添加到主屏幕/安装为应用；核心记录与绘图可离线使用。

## 固定测量体系

标准 ID：`grind-psd-sieve-v1`

| 原始档位标签 | 数据库粒径区间 | 原始重量字段 |
|---|---:|---|
| 18 目筛上 | ≥1000 μm | `mesh18_retained_g` |
| 24 目筛上 | 800–1000 μm | `mesh24_retained_g` |
| 35 目筛上 | 500–800 μm | `mesh35_retained_g` |
| 60 目筛上 | 300–500 μm | `mesh60_retained_g` |
| 80 目档底盘 | <300 μm | `pan80_lt300_g` |

这里的“目数”是原始工具沿用的项目档位标签，公开数据库实际按右侧粒径区间比较。不得把这些标签自动换算成 ASTM、ISO 或其他国家的标准筛孔径；如需改变区间，必须创建新的 `standardId`，不能修改 v1 的既有定义。

完整标准见：

- [`data/standard.json`](data/standard.json)
- [`data/record.schema.json`](data/record.schema.json)
- [`docs/data-standard.md`](docs/data-standard.md)

## 公开提交流程

1. 在网页中完成并保存一条本地记录。
2. 在“当前记录”点击“提交到社区库”。
3. 确认质量等级与 CC BY 4.0 数据许可。
4. 网页打开预填 GitHub Issue。
5. `.github/workflows/ingest-result.yml` 解析、校验和重新计算结果。
6. 校验通过后，记录同时写入总库和用户独立文件，Issue 自动回复并关闭。

第一个使用某个 `user.id` 成功入库的 GitHub 账号会成为该 ID 的提交所有者。后续其他 GitHub 账号不能向同一用户 ID 写入数据，以减少冒名提交。显示名称可以是中文；用户 ID 仅允许 2–48 位小写字母、数字、下划线和连字符。

## 数据质量

公开记录必须填写投粉量、筛具/装置、筛分方法与时长。质量等级由五档回收总重相对投粉量的误差决定：

| 等级 | 回收质量误差 | 用途 |
|---|---:|---|
| A | ≤2%，且方法字段完整 | 高可比 |
| B | ≤5% | 可比 |
| C | >5% 且 ≤10% | 谨慎比较 |
| D | >10% | 只允许本地保存，不接受公开入库 |

正式比较建议每个刻度至少进行 3 次独立重复。五段筛分数据不能等同于激光衍射或图像法的连续粒径分布，因此 v3.0 不在主界面强调由五个宽区间线性插值得出的 D10/D50/D90。

## 本地运行

本项目无构建步骤：

```bash
python3 -m http.server 8000
```

打开 <http://localhost:8000/>。

检查：

```bash
node --check assets/psd-core.js
node --check assets/app.js
python3 -m unittest discover -s tests -v
```

## 部署

源代码保存在 `main`。`.github/workflows/pages.yml` 会验证静态文件，并把网页运行所需内容同步到 `gh-pages`；仓库的 GitHub Pages 从 `gh-pages` 发布。数据库每次更新也会触发同一发布流程。

## 许可证

- 程序代码：Apache License 2.0，见 [`LICENSE`](LICENSE)。
- 社区测量数据：CC BY 4.0，见 [`DATA_LICENSE.md`](DATA_LICENSE.md)。

贡献前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

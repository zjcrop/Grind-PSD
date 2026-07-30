# Grind-PSD

Grind-PSD 是一个公开的咖啡研磨粒径分布记录、共享与对比工具。当前 v4.0 以项目原始单文件工具的深色交互为基线，采用“登录/注册 → 同步选择 → 设备 → 刻度 → 五档称重”的连续流程，保留历史记录、研磨刻度 3D 阵列图和双色重叠对比。

在线使用：

- <https://zjcrop.github.io/Grind-PSD/>

## 功能

- 启动身份流程：对比在线用户列表后登录或注册唯一用户 ID。
- 连续三步测量：选择/注册设备 → 选择刻度 → 五档称重；保存后自动进入下一轮。
- 30 分钟设备记忆：距上次测试不超过 30 分钟时，下一轮默认预选同款设备。
- 每步可退出：登录、同步、设备、刻度和称重步骤均可安全退出，不丢失既有记录。
- 原版图表：单条柱状图、同一磨豆机多刻度 3D 阵列、两条记录重叠比较、两组阵列并排比较。
- 本地优先：记录保存在浏览器；支持 JSON 备份、旧版 JSON 导入和 CSV 导出。
- 旧数据兼容：首次运行会自动迁移 `grindAnalyzerV1`、`grindPsdAppV2` 与 `grindPsdAppV3` 的浏览器记录。
- 社区数据库：下载、筛选、导入或比较其他用户的公开结果。
- 独立用户库：总库位于 `data/database.json`，每个用户另存于 `data/users/<user_id>.json`。
- 权限化数据操作：注册、批量新增、编辑和删除均通过 GitHub Issue；Actions 以 Issue 作者核验 ID 所有权。
- 登录后同步选择：可决定是否同步网络记录，并对当前 ID 的未同步本地记录选择是否批量上传。
- 缓存修复：应用脚本和样式采用网络优先更新，降低旧 Service Worker 导致按钮失效的风险。
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

## 用户注册与公开提交流程

1. 网页读取 `data/database.json` 的在线用户列表，先做 ID 重名检查。
2. 注册新 ID 时，网页打开 `[PSD-USER]` GitHub Issue。
3. `.github/workflows/ingest-result.yml` 再次检查唯一性，并把 ID 绑定到 Issue 作者的 GitHub 账号。
4. 登录后可选择同步网络记录，并决定是否上传本机未同步记录。
5. 单条或批量上传均重新校验原始克重、质量等级、标准 ID 和 CC BY 4.0 许可。
6. 校验通过后，记录同时写入总库和用户独立文件，Issue 自动回复并关闭。
7. 当前 ID 的在线记录会显示“编辑/删除”；工作流只接受该 ID 所绑定 GitHub 账号发起的操作。

在线列表检查用于即时反馈；最终唯一性由串行 GitHub Actions 在写库时保证，以处理两个用户同时申请同一 ID 的竞态。显示名称可以是中文；用户 ID 仅允许 2–48 位小写字母、数字、下划线和连字符。

## 数据质量

公开记录必须填写投粉量、筛具/装置、筛分方法与时长。质量等级由五档回收总重相对投粉量的误差决定：

| 等级 | 回收质量误差 | 用途 |
|---|---:|---|
| A | ≤2%，且方法字段完整 | 高可比 |
| B | ≤5% | 可比 |
| C | >5% 且 ≤10% | 谨慎比较 |
| D | >10% | 只允许本地保存，不接受公开入库 |

正式比较建议每个刻度至少进行 3 次独立重复。五段筛分数据不能等同于激光衍射或图像法的连续粒径分布，因此 v4.0 不在主界面强调由五个宽区间线性插值得出的 D10/D50/D90。

## 本地运行

本项目无构建步骤：

```bash
python3 -m http.server 8000
```

打开 <http://localhost:8000/>。

检查：

```bash
node --check assets/psd-core.js
node --check assets/app-v4.js
python3 -m unittest discover -s tests -v
```

## 部署

源代码保存在 `main`。`.github/workflows/pages.yml` 会验证静态文件，并把网页运行所需内容同步到 `gh-pages`；仓库的 GitHub Pages 从 `gh-pages` 发布。数据库每次更新也会触发同一发布流程。

## 许可证

- 程序代码：Apache License 2.0，见 [`LICENSE`](LICENSE)。
- 社区测量数据：CC BY 4.0，见 [`DATA_LICENSE.md`](DATA_LICENSE.md)。

贡献前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

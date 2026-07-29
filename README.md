# Grind-PSD

Grind-PSD 是一个公开的咖啡研磨粒径分布统计工具，用来按照统一筛分标准记录、比较和共享不同咖啡研磨器在不同刻度下的粉径分布结果。

在线地址：

- https://zjcrop.github.io/Grind-PSD/

## 核心功能

- 网页端离线记录：品牌、型号、刻度、投粉量、筛层重量、备注均保存在本机浏览器。
- 标准化筛分体系：默认采用 18 / 24 / 35 / 60 目和 80 目底盘极细粉五段分布。
- 自动计算指标：各筛层占比、粗粉占比、极细粉占比、近似 D10 / D50 / D90 和分布跨度。
- 社区数据库：从 `data/database.json` 下载其他用户公开提交的记录，用于对比分析；同时按 `data/users/<user_id>.json` 独立归集用户结果。
- 公开上传通道：网页生成标准 JSON，并通过 GitHub Issue 提交；仓库 Actions 校验后写入数据库。
- 数据导入导出：支持导出本地 JSON、导入本地备份或他人分享的标准记录。

## 标准体系

当前标准版本为 `grind-psd-sieve-v1`，字段定义见：

- `data/standard.json`
- `docs/data-standard.md`

筛层定义如下：

| 标准字段 | 名称 | 粒径区间 | 记录值 |
|---|---:|---:|---:|
| `mesh18_retained_g` | 18 目筛上 | `>=1000 μm` | 重量 g |
| `mesh24_retained_g` | 24 目筛上 | `800-1000 μm` | 重量 g |
| `mesh35_retained_g` | 35 目筛上 | `500-800 μm` | 重量 g |
| `mesh60_retained_g` | 60 目筛上 | `300-500 μm` | 重量 g |
| `pan80_lt300_g` | 80 目底盘极细粉 | `<300 μm` | 重量 g |

注意：这里沿用项目原始工具中的标称孔径体系，优先保证社区数据之间可比。若使用实验室标准筛或其他孔径体系，必须在记录中注明筛具与校准差异，不应直接混入默认数据库。

## 公开数据提交流程

1. 在网页中填写或导入一条粒径记录。
2. 点击“提交到社区数据库”。
3. 网页会打开一个预填好的 GitHub Issue，正文包含标准 JSON。
4. 提交 Issue 后，`.github/workflows/ingest-result.yml` 会校验数据。
5. 校验通过后，记录会被追加到 `data/database.json`，并同步写入 `data/users/<user_id>.json`，供所有人下载对比。

纯静态网页不能安全地直接写入 GitHub 仓库，因为写入令牌不能暴露在前端。当前方案使用 GitHub Issue + Actions 作为公开、可审查、可回滚的数据同步通道。

## 本地开发

这是一个无构建步骤的静态项目，直接打开 `index.html` 即可；推荐用本地 HTTP 服务预览：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

## 许可证

本项目使用 Apache License 2.0。

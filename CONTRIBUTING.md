# 参与 Grind-PSD

欢迎修复界面、兼容性、可访问性、图表、数据导入导出和数据库工具，但所有贡献必须保护公开测量结果的可比性。

## 不可破坏的规则

1. `grind-psd-sieve-v1` 的五个粒径区间和原始重量字段不可原地修改。
2. 新测量体系必须使用新的 `standardId`，并与 v1 数据分开比较。
3. 客户端不得包含可写 GitHub Token、Personal Access Token 或其他仓库密钥。
4. 公开入库必须经过服务端校验；不能直接信任浏览器计算的占比、等级或指标。
5. 用户输入和社区数据必须按不可信内容处理，输出到 HTML 前必须转义。
6. 公开记录的编辑或删除只能通过受控 Issue 操作，由记录所属 ID 的 GitHub 所有者发起；不得绕过工作流直接改库。
7. 任何 D10/D50/D90 等连续分布指标必须清楚标注为区间近似，不能以伪精度替代五段原始数据。

## 提交代码前

```bash
node --check assets/psd-core.js
node --check assets/app-v4.js
python3 -m json.tool data/standard.json > /dev/null
python3 -m json.tool data/record.schema.json > /dev/null
python3 -m unittest discover -s tests -v
```

修改 UI 时至少检查：

- 360 px 宽手机布局；
- 原版三步录入流程；
- 登录/注册、在线 ID 唯一性检查和本地上传询问；
- 30 分钟内上一设备预选与保存后自动下一轮；
- 本人在线记录的编辑/删除权限，以及其他账号越权拒绝；
- 本地记录保存、JSON 导入/导出；
- 3D 阵列刻度排序；
- 两条记录对比；
- 离线启动与联网同步；
- 社区记录中的恶意文本不能执行脚本。

## 数据标准变更

标准变更 PR 必须说明：

- 为什么既有 standardId 不再适用；
- 新旧区间、单位和方法的完整差异；
- 是否能进行数学转换，以及转换的不确定性；
- 前端、JSON Schema、服务端校验和文档如何同时升级；
- 如何保证旧数据库仍可读取。

项目维护者保留对标准体系和公开数据库的最终审核权。

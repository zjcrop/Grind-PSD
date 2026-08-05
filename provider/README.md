# Grind-PSD Provider Layer

该发布层只向 LuckyBean 与 BrewProfiles 提供保守的粒径—设备参考，不把有限筛分样本包装成精确刻度。

## 强制原则

- A、B级记录可进入数值聚合；C级及以下仅保留为原始证据，不进入刻度建议；
- 少于3条合格样本时，不返回任何数值刻度范围；
- 样本充足时也只返回带外扩不确定度的宽范围；
- 消费端必须显示样本数、贡献者数、置信度和操作警告；
- “最佳刻度”“精确刻度”等表述被合同禁止；
- BrewProfiles决定目标粒径，Grind-PSD只把目标粒径映射为参考范围。

## 发布物

- `provider/releases/latest.json`
- `provider/releases/catalog/grinder-reference-*.json`
- `provider/scripts/reference-engine.mjs`

## 验证

```bash
node --test provider/tests/*.test.mjs
node provider/scripts/build-provider-release.mjs --output=/tmp/grind-provider
node provider/scripts/verify-provider-release.mjs --output=/tmp/grind-provider
```

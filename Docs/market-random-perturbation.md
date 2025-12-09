# 随机扰动定价算法 - 实施说明
> 仅关注市场情绪扰动的融合定价方案  
> 更新时间：2025-12-09

## 1. 目标
- 在现有供应驱动定价上加入可控随机波动，让价格具备“呼吸感”而不过度失控。
- 提供配置开关与参数，便于快速启停和调节波动强度。
- 保持当日锁价：每日 04:00 计算后锁定一天，玩家行为次日生效。

## 2. 核心公式
```
ratio = (baseSupply / actualSupply) × (1 + noise)
noise ~ Normal(0, σ) ，截断于 [-max_noise, +max_noise]

price = basePrice × (1 + ln(ratio) × K)
```
- `σ`：基础波动率（全局统一）。
- `max_noise`：绝对截断，防止极端波动。
- 价格最终仍受全局限幅：min_ratio / max_ratio。

## 3. 配置示例（market.yaml 增量段）
```yaml
pricing:
  sensitivity: 0.1
  min_ratio: 0.5
  max_ratio: 1.5

  market_sentiment:
    enabled: true        # 关掉则回退到纯供应驱动
    volatility: 0.05          # σ，全局统一波动率
    max_noise: 0.15           # 截断 ±15%
```

## 4. 实现步骤
1) **采样函数**：使用 Box-Muller 生成 `noise`，σ 取全局 `volatility`，再用 `Math.max/min` 截断到 ±`max_noise`。  
2) **供应比率函数**：`rawRatio = baseSupply / actualSupply` → `ratio = rawRatio × (1 + noise)`，随后再做极值钳制（extreme_ratio_min/max）。  
3) **价格计算**：沿用现有对数公式与 min/max 价格限幅。  
4) **开关控制**：`market_sentiment.enabled=false` 时，直接跳过噪声分支，保持原有结果。  
5) **缓存与锁价**：价格计算结果缓存 24h；仍在每日调度（04:00）中执行。

## 5. 伪代码
```js
function sampleNoise() {
  const z = boxMuller(); // ~N(0,1)
  const noise = z * cfg.volatility;
  return clamp(noise, -cfg.max_noise, cfg.max_noise);
}

function calcSupplyRatio(baseSupply, actualSupply) {
  const raw = safeDiv(baseSupply, actualSupply, 1); // 默认 1 防除零
  const noise = cfg.enabled ? sampleNoise() : 0;
  const ratio = raw * (1 + noise);
  return clamp(ratio, extremeMin, extremeMax);
}

function calcPrice(basePrice, ratio) {
  const adj = Math.log(ratio) * sensitivity;
  const price = basePrice * (1 + adj);
  return clamp(price, basePrice * min_ratio, basePrice * max_ratio).toFixed(2);
}
```

## 6. 接入点（当前代码参考）
- `services/market/PriceCalculator.js`
  - `_calculateSupplyRatio`：插入噪声逻辑。
  - `_calculatePriceFromSupply`：无需改动，继续对数+限幅。
- `config/default_config/market.yaml`
  - 增加 `pricing.market_sentiment` 段（仅含统一波动率）。

## 8. 测试要点
- `enabled=false` 时结果应与旧版完全一致。
- 噪声截断：多次采样检查 |noise|≤max_noise。
- 锁价：同一日内多次请求价格应返回同值（依赖日更流程）。

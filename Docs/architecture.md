# 系统架构设计

## 架构概览

Farm Game 采用分层架构设计，遵循单一职责原则和依赖注入模式。

```
┌─────────────────────────────────────────────────────┐
│                   Apps Layer                         │
│    (farm.js, player.js, shop.js, steal.js ...)      │
│         指令解析 → 参数验证 → 调用服务                │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│                Services Layer                        │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │PlayerService│ │PlantingService│ │MarketService │  │
│  └─────────────┘ └──────────────┘ └──────────────┘  │
│           业务逻辑 → 数据操作 → 事件处理              │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│                 Models Layer                         │
│     Player.js    Land.js    Item.js    Config.js    │
│         数据结构 → 验证逻辑 → 序列化                  │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│                Storage Layer                         │
│        Redis (高频)    YAML/JSON (持久化)            │
└─────────────────────────────────────────────────────┘
```

## 服务容器

### ServiceContainer

所有服务通过 `services/index.js` 的 ServiceContainer 统一管理：

```javascript
// 获取服务
const playerService = serviceContainer.getService('playerService');
const plantingService = serviceContainer.getService('plantingService');
```

### 服务注册表

| 服务名 | 类 | 职责 |
|--------|-----|------|
| `playerService` | PlayerService | 玩家核心管理 |
| `plantingService` | PlantingService | 种植生命周期 |
| `inventoryService` | InventoryService | 仓库物品管理 |
| `shopService` | ShopService | 商店交易 |
| `marketService` | MarketService | 市场价格 |
| `stealService` | StealService | 偷菜逻辑 |
| `protectionService` | ProtectionService | 防护系统 |
| `landService` | LandService | 土地操作 |
| `economyService` | EconomyService | 经济系统 |

## 核心子系统

### 1. 玩家子系统 (Player Subsystem)

```
PlayerService
├── PlayerDataService      # Redis+YAML 混合存储
├── PlayerSerializer       # 数据序列化
├── SignInService          # 签到功能
├── LevelCalculator        # 等级计算
└── PlayerStatsService     # 统计服务
```

**数据流**:
```
用户指令 → PlayerService.getPlayer() → Redis缓存
                                         ↓ (miss)
                                      YAML文件
```

### 2. 种植子系统 (Planting Subsystem)

```
PlantingService
├── CropPlantingService    # 种植逻辑
├── CropHarvestService     # 收获逻辑
├── CropCareService        # 护理逻辑 (浇水/施肥/除虫)
├── CropMonitorService     # 状态监控
├── PlantingDataService    # 数据访问
└── PlantingUtils          # 工具方法
```

**作物生命周期**:
```
种植 → 生长中 → 需要护理 → 成熟 → 收获
  ↓                ↓
消耗种子      浇水/施肥/除虫
```

### 3. 市场子系统 (Market Subsystem)

采用混合存储架构：

```
┌─────────────────────────────────────────────────────┐
│                    Market Data                       │
├─────────────────────┬───────────────────────────────┤
│       Redis         │           JSON File            │
│  (高频/临时统计)     │      (低频/持久数据)           │
├─────────────────────┼───────────────────────────────┤
│ • demand_24h        │ • basePrice                   │
│ • supply_24h        │ • currentPrice                │
│ • last_transaction  │ • priceTrend                  │
│                     │ • priceHistory                │
└─────────────────────┴───────────────────────────────┘
```

**组件**:
- `MarketService`: Facade 模式统一入口
- `MarketDataManager`: 混合存储管理
- `PriceCalculator`: 价格计算引擎
- `MarketScheduler`: 分布式任务调度
- `TransactionManager`: 交易事务

### 4. 偷菜子系统 (Steal Subsystem)

```
StealService
├── 冷却检查      # Redis 时间戳
├── 防护检查      # ProtectionService
├── 成熟作物查找  # PlantingService
├── 成功率计算    # 配置+防护加成
└── 奖励分发      # InventoryService
```

## 依赖注入模式

### Lazy Initialization

解决循环依赖问题：

```javascript
class PlayerService {
  constructor(redisClient, config) {
    this._serviceContainer = null;
    this._landServiceCache = null;
  }

  setServiceContainer(container) {
    this._serviceContainer = container;
  }

  _getLandService() {
    if (!this._landServiceCache && this._serviceContainer) {
      this._landServiceCache = this._serviceContainer.getService('landService');
    }
    return this._landServiceCache;
  }
}
```

### 服务初始化顺序

```javascript
// ServiceContainer.init() 顺序
1. Config
2. CommonUtils
3. ItemResolver
4. PlayerService
5. AdminService
6. InventoryService
7. LandService
8. PlantingService
9. ShopService
10. ProtectionService (注入到 PlayerService)
11. StealService
12. MarketService → MarketScheduler
```

## 数据模型

### Player 模型

```javascript
{
  name: string,
  level: number,
  experience: number,
  coins: number,
  landCount: number,
  maxLandCount: number,
  lands: Land[],
  inventory: { [itemId]: { quantity: number } },
  inventory_capacity: number,
  signIn: {
    lastSignDate: string,
    consecutiveDays: number,
    totalSignDays: number
  },
  protection: {
    dogFood: { type, effectEndTime }
  },
  stealing: { lastStealTime, cooldownEndTime },
  statistics: { ... }
}
```

### Land 模型

```javascript
{
  id: number,
  crop: string | null,
  quality: 'normal' | 'fertile' | 'rich' | 'legendary',
  plantTime: number,
  harvestTime: number,
  status: 'empty' | 'growing' | 'mature',
  needsWater: boolean,
  hasPests: boolean,
  health: number
}
```

## 存储策略

### Redis 键设计

| 键模式 | 用途 | TTL |
|--------|------|-----|
| `farm:player:{userId}` | 玩家缓存 | 30min |
| `farm:market:stats:{itemId}` | 市场统计 | 24h |
| `farm:steal:{userId}:cooldown` | 偷菜冷却 | 配置 |
| `farm:lock:{resource}` | 分布式锁 | 30s |

### YAML 持久化

```
data/players/{userId}.yaml   # 玩家持久数据
data/market/market.json      # 市场持久数据
data/backups/                # 自动备份
```

## 工具类

### CommonUtils

```javascript
// 时间工具
CommonUtils.getRemainingMinutes(endTime)
CommonUtils.formatRemainingTime(endTime)
CommonUtils.getTodayKey()

// 计算工具
CommonUtils.calcCoins(price, qty)
CommonUtils.safeCalculation(fn, fallback)

// 验证工具
CommonUtils.validatePrice(price)
CommonUtils.validateQuantity(quantity)
```

### Calculator

```javascript
// 业务计算
Calculator.getTotalItems(inventory)
Calculator.calculateGrowTime(base, quality)
Calculator.calculateYield(crop, land)
Calculator.calculateShopPrice(item, qty)
```

### ItemResolver

```javascript
// 物品解析
itemResolver.getItemInfo(itemId)
itemResolver.findItemByName(name)
itemResolver.findItemById(itemId)
itemResolver.getCategoryDisplayName(category)
```

## 定时任务

| 任务 | Cron | 执行器 |
|------|------|--------|
| 作物状态更新 | `0 * * * * *` | farm.js |
| 市场价格更新 | `0 */5 * * * *` | MarketScheduler |
| 数据备份 | `0 0 * * *` | DataBackupService |

## 优雅关闭

```javascript
// 信号处理
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

// 关闭流程
1. 停止接收新请求
2. 持久化市场数据 → JSON
3. 停止定时任务
4. 关闭 Redis 连接
5. 退出进程
```

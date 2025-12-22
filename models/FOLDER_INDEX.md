# models/ - 数据模型层

## 📁 文件夹概述

**位置**: `/models`
**角色**: 数据模型层 (Data Model Layer)
**职责**: 定义数据结构 → 数据验证 → 序列化/反序列化 → 业务逻辑方法

## 📂 文件列表

| 文件 | 功能 | 主要类/导出 | 职责 |
|------|------|------------|------|
| **Player.js** | 玩家数据模型 | `Player` | 玩家数据结构、验证、状态检查 |
| **Land.js** | 土地数据模型 | `Land` | 土地数据结构、状态验证 |
| **Item.js** | 物品数据模型 | `Item` | 物品数据结构、分类管理 |
| **Config.js** | 配置管理器 | `Config` | YAML配置加载、热更新、文件监听 |
| **Data.js** | 数据工具 | `Data` | 配置导入、模块动态加载 |
| **constants.js** | 常量定义 | `_path`, `PLUGIN_NAME` | 项目常量和路径 |
| **services.js** | 服务聚合 | `Data`, `Puppeteer` | 导出常用服务的快捷方式 |
| **puppeteer.js** | 图片渲染 | `Puppeteer` | Vue组件图片渲染引擎 |

## 🎯 核心模型详解

### Player 模型
```javascript
class Player {
  // 基础属性
  name: string          // 玩家名称
  level: number         // 等级
  experience: number    // 经验值
  coins: number         // 金币 (别名: gold)

  // 土地系统
  landCount: number     // 当前土地数量
  maxLandCount: number  // 最大土地数量
  lands: Land[]         // 土地列表

  // 仓库系统
  inventory: Object     // 物品库存 { itemId: { quantity } }
  inventory_capacity: number  // 仓库容量
  maxInventoryCapacity: number // 最大容量

  // 子系统状态
  signIn: Object        // 签到数据
  protection: Object    // 防护数据 (狗粮)
  stealing: Object      // 偷菜冷却
  statistics: Object    // 统计数据

  // 时间戳
  createdAt: number     // 创建时间
  lastUpdated: number   // 最后更新
  lastActiveTime: number // 最后活跃
}
```

**关键方法**:
- `static createEmpty(name, config)` - 创建新玩家
- `static fromObjectData(rawData, config)` - 从对象恢复
- `validate()` - 数据验证
- `toJSON()` - 序列化
- `getInventoryInfo()` - 仓库状态
- `hasDogFoodProtection()` - 防护检查

### Land 模型
```javascript
class Land {
  id: number            // 土地编号 (1-based)
  quality: string       // 品质: normal/red/black/gold
  status: string        // 状态: empty/growing/mature
  crop: string          // 作物类型
  plantTime: number     // 种植时间
  harvestTime: number   // 收获时间
  needsWater: boolean   // 需要浇水
  hasPests: boolean     // 有害虫
  waterDelayApplied: boolean // 浇水延时已应用
  upgradeLevel: number  // 升级等级
}
```

**关键方法**:
- `validate()` - 验证土地数据完整性
- `isEmpty()` - 检查是否为空地
- `isMature()` - 检查作物是否成熟

### Item 模型
```javascript
class Item {
  id: string            // 物品ID
  category: string      // 分类: crop/seed/fertilizer/pesticide/dogfood
  name: string          // 显示名称
  quantity: number      // 数量
  price: number         // 价格
  icon: string          // 图标
  metadata: Object      // 扩展元数据
}
```

### Config 模型
**配置文件加载**:
- `crops.yaml` - 作物配置
- `items.yaml` - 物品配置 (种子/肥料/杀虫剂/狗粮)
- `land.yaml` - 土地品质和升级
- `levels.yaml` - 等级和经验
- `market.yaml` - 市场价格波动
- `steal.yaml` - 偷菜和防护

**功能**:
- 配置文件热更新 (chokidar 监听)
- 默认配置自动复制
- 深度合并用户自定义配置

## 🔗 依赖关系

### 输入依赖 (Input)
```
Player.js
  ├─→ ../utils/calculator.js (Calculator)
  └─→ ../utils/CommonUtils.js (CommonUtils)

Land.js
  └─→ (无外部依赖)

Item.js
  ├─→ ../utils/ItemResolver.js (ItemResolver)
  └─→ ../utils/CommonUtils.js (CommonUtils)

Config.js
  ├─→ yaml (YAML解析)
  ├─→ chokidar (文件监听)
  ├─→ lodash (深度合并)
  └─→ fs, path (文件操作)
```

### 输出依赖 (Output)
```
models/*
  ├─→ services/* (服务层使用模型)
  └─→ apps/* (应用层使用配置)
```

## 📐 设计模式

### 1. 工厂模式
```javascript
// Player 创建工厂方法
const player = Player.createEmpty('username', config);
const player = Player.fromObjectData(jsonData, config);
```

### 2. 单例模式
```javascript
// Config 全局单例
import Config from '../models/Config.js';
const crops = Config.crops;
```

### 3. 验证器模式
```javascript
// 数据验证
const result = player.validate();
if (!result.isValid) {
  console.error(result.errors);
}
```

## 🛡️ 数据验证规则

### Player 验证
- ✅ `level` >= 1 (正整数)
- ✅ `experience` >= 0 (非负整数)
- ✅ `coins` >= 0 (非负整数)
- ✅ `landCount` <= `maxLandCount`
- ✅ `inventory_capacity` <= `maxInventoryCapacity`
- ✅ `lands.length` === `landCount`

### Land 验证
- ✅ `id` >= 1
- ✅ `quality` in ['normal', 'red', 'black', 'gold']
- ✅ `status` in ['empty', 'growing', 'mature']
- ✅ `plantTime` 和 `harvestTime` 为有效时间戳

## 🔄 数据流

```
YAML配置文件 → Config.initCfg()
  ↓
Config实例 (缓存配置)
  ↓
Services (读取配置)
  ↓
Model构造函数 (使用配置初始化)
  ↓
Redis/YAML持久化
```

## 📝 序列化/反序列化

### Player 序列化
```javascript
// 序列化为 JSON (存储到 Redis/YAML)
const jsonData = player.toJSON();

// 从 JSON 反序列化
const player = Player.fromObjectData(jsonData, config);

// 深拷贝
const clonedPlayer = player.clone();
```

### 向后兼容性
```javascript
// 支持旧字段名 inventoryCapacity → inventory_capacity
player.inventoryCapacity; // getter 自动映射到 inventory_capacity
player.gold;             // getter 自动映射到 coins
```

## 🔍 使用示例

### 创建新玩家
```javascript
import Player from '../models/Player.js';
import Config from '../models/Config.js';

const player = Player.createEmpty('Alice', Config);
console.log(player.getDisplayInfo());
```

### 验证土地数据
```javascript
import Land from '../models/Land.js';

const land = new Land({ id: 1, quality: 'normal', status: 'empty' });
const validation = land.validate();
if (!validation.isValid) {
  console.error(validation.errors);
}
```

### 配置访问
```javascript
import Config from '../models/Config.js';

const wheatConfig = Config.crops.wheat;
const fertilizerConfig = Config.items.fertilizers.normalFertilizer;
```

## 🎯 最佳实践

1. **总是验证数据**: 在保存数据前调用 `validate()`
2. **使用工厂方法**: 优先使用 `createEmpty()` 而非直接 `new Player()`
3. **不可变性**: 使用 `clone()` 创建副本而非直接修改
4. **类型安全**: 依赖模型的类型定义,而非动态对象

## 🔍 相关文档

- [服务层文档](../services/FOLDER_INDEX.md)
- [工具类文档](../utils/FOLDER_INDEX.md)
- [项目架构文档](../Docs/architecture.md)

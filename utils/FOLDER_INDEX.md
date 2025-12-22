# utils/ - 工具类层

## 📁 文件夹概述

**位置**: `/utils`
**角色**: 工具类层 (Utility Layer)
**职责**: 提供通用工具函数 → 数据计算 → 格式化 → 解析 → 存储抽象

## 📂 文件列表

| 文件 | 功能 | 主要导出 | 职责 |
|------|------|---------|------|
| **ItemResolver.js** | 物品解析器 | `ItemResolver` | 物品ID/名称解析、分类识别、配置查询 |
| **CommonUtils.js** | 通用工具集 | `CommonUtils` | 时间格式化、随机数、数组操作、对象深拷贝 |
| **calculator.js** | 计算工具 | `Calculator` | 经验计算、价格计算、物品统计 |
| **redisClient.js** | Redis客户端 | `redisClient` | Redis连接管理 |
| **fileStorage.js** | 文件存储 | `FileStorage` | YAML/JSON 文件读写 |
| **playerYamlStorage.js** | 玩家存储 | `PlayerYamlStorage` | 玩家数据 YAML 持久化 |

## 🎯 核心工具详解

### ItemResolver - 物品解析器
**职责**: 统一物品查询和分类识别

**核心方法**:
```javascript
// 根据名称或ID解析物品
resolveItem(nameOrId, category = null)
  → { itemId, category, config }

// 识别物品分类
identifyCategory(itemId)
  → 'crop' | 'seed' | 'fertilizer' | 'pesticide' | 'dogfood'

// 获取物品配置
getItemConfig(itemId, category)
  → { name, price, icon, ... }

// 获取物品显示名称
getItemDisplayName(itemId)
  → string
```

**使用场景**:
- 用户输入 "小麦" → 解析为 `wheat` (crop)
- 用户输入 "小麦种子" → 解析为 `wheat_seed` (seed)
- 物品ID `wheat_seed` → 分类识别为 `seed`

### CommonUtils - 通用工具集
**职责**: 提供常用的辅助函数

**时间工具**:
```javascript
getRemainingMinutes(endTime, now)  // 剩余时间(分钟)
formatDuration(ms)                  // 格式化时长
getCurrentTimestamp()               // 当前时间戳
```

**随机工具**:
```javascript
getRandomInt(min, max)              // 随机整数
getRandomFloat(min, max, decimals)  // 随机浮点数
getRandomElement(array)             // 随机数组元素
shuffleArray(array)                 // 打乱数组
```

**数组工具**:
```javascript
removeDuplicates(array)             // 去重
chunkArray(array, size)             // 分块
flattenArray(nestedArray)           // 扁平化
```

**对象工具**:
```javascript
deepClone(obj)                      // 深拷贝
deepMerge(target, source)           // 深度合并
isEmpty(value)                      // 空值检查
```

### Calculator - 计算工具
**职责**: 游戏数值计算

**核心方法**:
```javascript
// 计算仓库总物品数
getTotalItems(inventory)
  → number

// 计算物品总价值
calculateTotalValue(inventory, config)
  → number

// 计算经验值
calculateExpGain(action, config)
  → number

// 计算价格 (含浮动)
calculatePrice(basePrice, fluctuation)
  → number
```

### redisClient - Redis 客户端
**职责**: 管理 Redis 连接

**功能**:
- 自动连接到全局 `global.redis`
- 提供统一的 Redis 访问接口
- 支持连接池管理

### FileStorage - 文件存储抽象
**职责**: YAML/JSON 文件读写

**核心方法**:
```javascript
async readYaml(filePath)        // 读取 YAML
async writeYaml(filePath, data) // 写入 YAML
async readJson(filePath)        // 读取 JSON
async writeJson(filePath, data) // 写入 JSON
ensureDir(dirPath)              // 确保目录存在
```

### PlayerYamlStorage - 玩家存储
**职责**: 玩家数据 YAML 持久化

**核心方法**:
```javascript
async save(userId, playerData)  // 保存玩家数据
async load(userId)              // 加载玩家数据
async exists(userId)            // 检查玩家是否存在
async delete(userId)            // 删除玩家数据
async listAll()                 // 列出所有玩家
```

**存储路径**: `data/players/{userId}.yaml`

## 🔗 依赖关系

### 输入依赖 (Input)
```
ItemResolver.js
  └─→ ../models/Config.js (配置访问)

CommonUtils.js
  └─→ lodash (工具函数库)

calculator.js
  └─→ (无外部依赖)

redisClient.js
  └─→ global.redis (Yunzai框架提供)

fileStorage.js
  ├─→ yaml (YAML解析)
  └─→ fs/promises (文件操作)

playerYamlStorage.js
  ├─→ ./fileStorage.js (文件操作)
  └─→ ../models/Player.js (Player模型)
```

### 输出依赖 (Output)
```
utils/*
  ├─→ models/* (模型层使用工具)
  ├─→ services/* (服务层使用工具)
  └─→ apps/* (应用层间接使用)
```

## 📐 设计模式

### 1. 单例模式
```javascript
// redisClient 全局单例
import redisClient from '../utils/redisClient.js';
await redisClient.hget('key', 'field');
```

### 2. 策略模式
```javascript
// ItemResolver 根据不同分类使用不同解析策略
resolver.resolveItem('wheat', 'crop');     // 作物解析策略
resolver.resolveItem('wheat_seed', 'seed'); // 种子解析策略
```

### 3. 工具类模式 (Static Methods)
```javascript
// CommonUtils 静态方法集合
CommonUtils.getRandomInt(1, 100);
CommonUtils.deepClone(obj);
```

## 🎯 使用示例

### 物品解析
```javascript
import ItemResolver from '../utils/ItemResolver.js';
import Config from '../models/Config.js';

const resolver = new ItemResolver(Config);

// 根据中文名解析
const result = resolver.resolveItem('小麦种子');
// { itemId: 'wheat_seed', category: 'seed', config: {...} }

// 识别分类
const category = resolver.identifyCategory('wheat_seed');
// 'seed'

// 获取显示名称
const name = resolver.getItemDisplayName('wheat_seed');
// '小麦种子'
```

### 通用工具
```javascript
import { CommonUtils } from '../utils/CommonUtils.js';

// 时间工具
const minutes = CommonUtils.getRemainingMinutes(endTime, Date.now());

// 随机工具
const randomGold = CommonUtils.getRandomInt(100, 500);

// 数组工具
const uniqueItems = CommonUtils.removeDuplicates(['apple', 'banana', 'apple']);

// 对象工具
const cloned = CommonUtils.deepClone(player);
```

### 计算工具
```javascript
import Calculator from '../utils/calculator.js';

// 仓库统计
const totalItems = Calculator.getTotalItems(player.inventory);

// 价值计算
const totalValue = Calculator.calculateTotalValue(player.inventory, Config);
```

### 文件存储
```javascript
import FileStorage from '../utils/fileStorage.js';

// YAML 读写
const data = await FileStorage.readYaml('config/crops.yaml');
await FileStorage.writeYaml('data/backup.yaml', playerData);

// JSON 读写
const market = await FileStorage.readJson('data/market.json');
```

### 玩家存储
```javascript
import PlayerYamlStorage from '../utils/playerYamlStorage.js';

// 保存玩家
await PlayerYamlStorage.save('123456', playerData);

// 加载玩家
const player = await PlayerYamlStorage.load('123456');

// 检查存在
const exists = await PlayerYamlStorage.exists('123456');
```

## 🔄 数据流

```
用户输入 "小麦种子"
  ↓
ItemResolver.resolveItem()
  ↓
识别为 'wheat_seed' (seed)
  ↓
从 Config.items.seeds 获取配置
  ↓
返回完整物品信息
```

## 🛡️ 错误处理

### ItemResolver
- 未找到物品时返回 `null`
- 无效分类时抛出异常

### FileStorage
- 文件不存在时返回默认值或 `null`
- 解析失败时抛出详细错误信息

### CommonUtils
- 输入验证,非法值返回安全默认值
- 深拷贝遇到循环引用时警告

## 🎯 最佳实践

1. **工具类无状态**: 工具函数应该是纯函数,不依赖外部状态
2. **错误处理**: 所有文件操作都应 try-catch
3. **性能优化**: ItemResolver 应缓存查询结果
4. **类型安全**: 使用 JSDoc 注释声明参数类型

## 📊 性能优化

### ItemResolver 缓存
```javascript
// 缓存解析结果
this._cache = new Map();
resolveItem(name) {
  if (this._cache.has(name)) {
    return this._cache.get(name);
  }
  // 解析逻辑...
  this._cache.set(name, result);
}
```

### CommonUtils 深拷贝
- 小对象使用 `JSON.parse(JSON.stringify())`
- 大对象使用 `lodash.cloneDeep`

## 🔍 相关文档

- [数据模型文档](../models/FOLDER_INDEX.md)
- [服务层文档](../services/FOLDER_INDEX.md)
- [项目架构文档](../Docs/architecture.md)

# Player Service 模块

## 📁 目录结构

```
services/player/
├── PlayerManagerService.js      # 主服务入口
├── PlayerDataService.js         # 数据持久化服务
├── modules/                     # 功能模块
│   ├── EconomyService.js        # 经济系统
│   ├── SignInService.js         # 签到系统
│   ├── ProtectionService.js     # 防御系统
│   ├── StatisticsService.js     # 统计系统
│   └── LandManagerService.js    # 土地管理
├── utils/                       # 工具类
│   ├── PlayerSerializer.js     # 数据序列化
│   └── LevelCalculator.js      # 等级计算
└── README.md                    # 本文件
```

## 🎯 设计原则

### 单一职责原则
每个服务只负责一个特定的业务领域：
- **PlayerManagerService**: 统一入口，保持向后兼容
- **PlayerDataService**: 数据持久化和Redis操作
- **EconomyService**: 金币、经验、升级逻辑
- **SignInService**: 签到奖励和统计
- **ProtectionService**: 防御机制和冷却管理
- **StatisticsService**: 游戏统计数据
- **LandManagerService**: 土地扩张和管理

### 依赖注入
- 清晰的依赖关系
- 便于单元测试
- 支持模拟和替换

### 数据层分离
- 统一的数据访问接口
- 一致的序列化逻辑
- 事务支持

## 🔧 使用方式

### 通过服务容器（推荐）
```javascript
import serviceContainer from '../index.js'

await serviceContainer.init()
const playerService = serviceContainer.getService('playerService')

// 使用统一接口
const playerData = await playerService.getPlayer(userId)
await playerService.addCoins(userId, 100)
```

### 直接使用子服务
```javascript
// 获取子服务实例
const economyService = playerService.getEconomyService()
const signInService = playerService.getSignInService()

// 使用专门的方法
const financialStats = await economyService.getFinancialStats(userId)
const signInStats = await signInService.getSignInStats(userId)
```

### 直接实例化（测试用）
```javascript
import PlayerDataService from './PlayerDataService.js'
import EconomyService from './modules/EconomyService.js'

const dataService = new PlayerDataService(redisClient, config)
const economyService = new EconomyService(dataService, config)
```

## 📚 API 文档

### PlayerManagerService
主服务入口，提供所有原有接口的兼容性。

**核心方法:**
- `getPlayer(userId)` - 获取玩家数据
- `ensurePlayer(userId, userName)` - 确保玩家存在
- `createPlayer(userId, userName)` - 创建新玩家

**子服务访问器:**
- `getDataService()` - 获取数据服务
- `getEconomyService()` - 获取经济服务
- `getSignInService()` - 获取签到服务
- `getProtectionService()` - 获取防御服务
- `getStatisticsService()` - 获取统计服务
- `getLandManagerService()` - 获取土地管理服务

### PlayerDataService
负责所有数据持久化操作。

**主要方法:**
- `getPlayerFromHash(userId)` - 从Redis读取玩家数据
- `savePlayerToHash(userId, playerData)` - 保存玩家数据到Redis
- `updateSimpleField(userId, field, value)` - 更新简单字段
- `updateComplexField(userId, field, value)` - 更新复杂字段
- `executeWithTransaction(userId, operation)` - 执行事务操作

### EconomyService
管理金币、经验和升级系统。

**主要方法:**
- `addCoins(userId, amount)` - 添加金币
- `addExp(userId, amount)` - 添加经验值
- `getPlayerLevelInfo(userId)` - 获取等级信息
- `hasEnoughCoins(userId, amount)` - 检查金币是否足够
- `deductCoins(userId, amount)` - 扣除金币

### SignInService
处理签到系统和奖励。

**主要方法:**
- `signIn(userId)` - 执行签到
- `getSignInStatus(userId)` - 获取签到状态
- `getSignInStats(userId)` - 获取签到统计
- `canSignIn(userId)` - 检查是否可以签到

### ProtectionService
管理防御系统和冷却机制。

**主要方法:**
- `useDogFood(userId, dogFoodType)` - 使用狗粮
- `getProtectionStatus(userId)` - 获取防御状态
- `setStealCooldown(userId, minutes)` - 设置偷菜冷却
- `setFarmProtection(userId, minutes)` - 设置农场保护
- `isProtected(userId)` - 检查是否受保护

### StatisticsService
管理游戏统计数据。

**主要方法:**
- `updateStatistics(userId, stats)` - 更新统计数据
- `getStatistics(userId)` - 获取统计数据
- `getDetailedReport(userId)` - 获取详细报告
- `addHarvestStats(userId, amount, value)` - 添加收获统计

### LandManagerService
管理土地系统。

**主要方法:**
- `expandLand(userId)` - 扩张土地
- `getLandById(userId, landId)` - 获取指定土地
- `updateLand(userId, landId, updates)` - 更新土地属性
- `getAllLands(userId)` - 获取所有土地
- `validateLandId(userId, landId)` - 验证土地ID

## ⚡ 事务最佳实践

### 事务边界设计原则

本项目采用统一的事务处理模式，确保数据一致性和并发安全性。

#### 核心原则
1. **业务操作层使用 `executeWithTransaction`**
2. **原子操作层直接操作 `multi` 实例**
3. **避免事务嵌套**
4. **在事务内进行完整的业务检查**

#### 标准事务模式
```javascript
async businessOperation(userId, params) {
  return await this.playerDataService.executeWithTransaction(userId, async (multi, playerKey) => {
    // 1. 在事务内获取最新数据
    const playerData = await this.playerDataService.getPlayerFromHash(userId);

    // 2. 业务逻辑验证
    if (playerData.coins < params.cost) {
      throw new Error('金币不足');
    }

    // 3. 直接操作数据（避免调用外部事务方法）
    const actualChange = this.economyService._updateCoinsInTransaction(playerData, -params.cost);

    // 4. 保存数据
    const serializer = this.playerDataService.getSerializer();
    multi.hSet(playerKey, serializer.serializeForHash(playerData));

    return { success: true, remainingCoins: playerData.coins };
  });
}
```

#### 常见陷阱与解决方案

**❌ 错误：事务嵌套**
```javascript
// 在事务内调用其他事务方法
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  await this.economyService.deductCoins(userId, amount); // 导致嵌套事务
});
```

**✅ 正确：使用内部方法**
```javascript
// 使用内部方法避免嵌套
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  const playerData = await this.getPlayerFromHash(userId);
  this.economyService._updateCoinsInTransaction(playerData, -amount);
});
```

**❌ 错误：检查-操作分离**
```javascript
// 事务外检查，存在竞态条件
if (playerData.coins < cost) {
  return { success: false };
}
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  playerData.coins -= cost; // 数据可能已经改变
});
```

**✅ 正确：事务内检查**
```javascript
// 在事务内进行检查和操作
return await this.executeWithTransaction(userId, async (multi, playerKey) => {
  const playerData = await this.getPlayerFromHash(userId);
  if (playerData.coins < cost) {
    throw new Error('金币不足');
  }
  playerData.coins -= cost;
});
```

### 并发安全指南

#### 编写并发测试
```javascript
test('concurrent operations should be safe', async () => {
  const promises = Array(10).fill().map(() =>
    service.businessOperation(userId, params)
  );

  const results = await Promise.all(promises);

  // 验证只有合理数量的操作成功
  const successCount = results.filter(r => r.success).length;
  expect(successCount).toBeLessThanOrEqual(expectedMax);
});
```

#### 性能考虑
- 事务内操作应尽可能简洁
- 避免在事务内进行耗时的外部调用
- 合理使用批量操作减少事务次数

详细的事务设计规范请参考：[事务设计规范指南](../../docs/transaction-design-guidelines.md)

## 🧪 测试

### 单元测试示例
```javascript
import { jest } from '@jest/globals'
import EconomyService from '../modules/EconomyService.js'

describe('EconomyService', () => {
  let economyService
  let mockDataService

  beforeEach(() => {
    mockDataService = {
      getPlayerFromHash: jest.fn(),
      executeWithTransaction: jest.fn()
    }
    economyService = new EconomyService(mockDataService, config)
  })

  test('should add coins correctly', async () => {
    // 测试逻辑
  })
})
```

### 集成测试
```javascript
import serviceContainer from '../../index.js'

describe('PlayerService Integration', () => {
  beforeEach(async () => {
    await serviceContainer.init()
  })

  test('should handle complete player workflow', async () => {
    const playerService = serviceContainer.getService('playerService')
    // 测试完整流程
  })
})
```

### 并发安全测试
```javascript
describe('Concurrency Safety', () => {
  test('should handle concurrent land expansion safely', async () => {
    const promises = Array(5).fill().map(() =>
      landManagerService.expandLand(userId)
    );

    const results = await Promise.all(promises);
    const successResults = results.filter(r => r.success);

    // 验证只有一次成功
    expect(successResults).toHaveLength(1);
  });
});
```

## 🚀 扩展开发

### 添加新的功能模块
1. 在 `modules/` 目录下创建新的服务类
2. 在 `PlayerManagerService.js` 中添加对应的委托方法
3. 在服务容器中注册新服务

### 添加新的工具类
1. 在 `utils/` 目录下创建新的工具类
2. 在需要的服务中导入和使用

### 最佳实践
- 保持单一职责原则
- 使用依赖注入
- 编写单元测试
- 保持接口一致性
- 添加适当的错误处理和日志记录

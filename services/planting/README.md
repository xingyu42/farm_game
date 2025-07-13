# Planting Service 重构模块

## 📋 重构概述

本文档详细说明了 PlantingService.js 的重构过程，该重构按照单一职责原则将原有的大型服务类拆分为多个专注的服务类，同时保持完全的向后兼容性。

### 重构目标
- ✅ **单一职责原则**：每个服务类只负责一个特定的业务领域
- ✅ **代码复用**：最大化复用现有组件，避免重复实现
- ✅ **向后兼容**：保持所有公共接口不变，现有代码无需修改
- ✅ **可维护性**：清晰的职责分离，便于测试和扩展
- ✅ **性能优化**：通过专门服务提高处理效率

## 📁 新的目录结构

```
services/planting/
├── PlantingService.js           # 主服务（门面模式）
├── CropPlantingService.js       # 作物种植专门服务
├── CropHarvestService.js        # 作物收获专门服务
├── CropCareService.js           # 作物护理专门服务
├── CropStatusService.js         # 作物状态更新服务
├── CropScheduleService.js       # 作物调度管理服务
├── validators/                  # 验证器目录
│   └── PlantingValidator.js     # 种植验证逻辑
└── utils/                       # 工具类目录
    └── MessageBuilder.js        # 消息构建工具
```

## 🔄 重构前后对比

### 重构前（单一大型服务）
```
PlantingService.js (913 行)
├── 种植逻辑 (plantCrop)
├── 收获逻辑 (harvestCrop)
├── 护理逻辑 (waterCrop, fertilizeCrop, pesticideCrop)
├── 状态更新 (updateAllCropsStatus)
├── 验证方法 (多个私有验证方法)
├── 计算逻辑 (生长时间、产量、经验)
├── 调度管理 (Redis ZSet 操作)
└── 工具方法 (消息构建、格式化等)
```

### 重构后（专门服务架构）
```
PlantingService.js (138 行) - 门面服务
├── CropPlantingService.js - 种植专门服务
├── CropHarvestService.js - 收获专门服务
├── CropCareService.js - 护理专门服务
├── CropStatusService.js - 状态更新服务
├── CropScheduleService.js - 调度管理服务
├── PlantingValidator.js - 验证逻辑
└── MessageBuilder.js - 消息构建工具
```

## 🎯 各服务职责说明

### PlantingService（主服务 - 门面模式）
**职责**：保持向后兼容性，委托给专门服务处理
- 维护所有原有公共方法签名
- 通过依赖注入初始化所有子服务
- 将方法调用委托给对应的专门服务

### CropPlantingService（种植专门服务）
**职责**：专门处理作物种植逻辑
- 种植条件验证（等级、种子、土地状态）
- 生长时间计算（考虑土地品质）
- 护理需求随机生成
- 收获计划添加
- 支持单个和批量种植

### CropHarvestService（收获专门服务）
**职责**：专门处理作物收获逻辑
- 成熟度检查和验证
- 产量计算（考虑健康度和品质）
- 经验计算和升级处理
- 仓库空间管理
- 收获计划移除

### CropCareService（护理专门服务）
**职责**：专门处理作物护理逻辑
- 浇水护理（恢复健康度）
- 施肥护理（减少生长时间，支持自动/手动选择）
- 除虫护理（移除虫害状态）
- 批量护理支持
- 护理效果计算

### CropStatusService（状态更新服务）
**职责**：专门处理作物状态的批量更新
- 定时任务批量更新（高性能）
- 成熟度状态检查
- 护理需求状态更新
- 分布式锁确保并发安全
- 统计信息收集

### CropScheduleService（调度管理服务）
**职责**：专门处理收获计划管理
- Redis ZSet 操作封装
- 收获计划的增删改查
- 到期计划批量获取
- 按用户分组处理
- 过期数据清理

### PlantingValidator（验证器）
**职责**：统一的验证逻辑
- 复用 Land 模型的验证方法
- 玩家数据和土地状态验证
- 作物类型和种植要求验证
- 护理条件验证
- 肥料可用性验证

### MessageBuilder（消息构建工具）
**职责**：统一的消息构建
- 标准化消息格式
- 种植、收获、护理消息构建
- 错误和验证失败消息
- 批量操作结果消息
- 图标和格式统一

## 🔧 使用方式

### 通过服务容器（推荐）
```javascript
import serviceContainer from '../index.js'

await serviceContainer.init()
const plantingService = serviceContainer.getService('plantingService')

// 使用统一接口（完全兼容原有代码）
const result = await plantingService.plantCrop(userId, landId, cropType)
await plantingService.harvestCrop(userId, landId)
await plantingService.waterCrop(userId, landId)
```

### 直接使用子服务（高级用法）
```javascript
// 获取专门服务实例
const cropPlantingService = plantingService.cropPlantingService
const cropHarvestService = plantingService.cropHarvestService

// 使用专门的方法
const plantResult = await cropPlantingService.batchPlantCrop(userId, cropType)
const harvestInfo = await cropHarvestService.getHarvestableInfo(userId)
```

### 直接实例化（测试用）
```javascript
import { CropPlantingService } from './planting/CropPlantingService.js'
import { CropScheduleService } from './planting/CropScheduleService.js'

const scheduleService = new CropScheduleService(redis, logger)
const plantingService = new CropPlantingService(
  playerDataService, 
  scheduleService, 
  config, 
  logger
)
```

## 📚 API 文档

### PlantingService（主服务）
保持所有原有接口的完全兼容性。

**核心方法:**
- `plantCrop(userId, landId, cropType)` - 种植作物
- `harvestCrop(userId, landId?)` - 收获作物
- `waterCrop(userId, landId)` - 浇水护理
- `fertilizeCrop(userId, landId, fertilizerType?)` - 施肥护理
- `pesticideCrop(userId, landId)` - 除虫护理
- `updateAllCropsStatus()` - 更新所有作物状态

### CropPlantingService
专门的种植服务，提供更丰富的种植功能。

**主要方法:**
- `plantCrop(userId, landId, cropType)` - 单个作物种植
- `batchPlantCrop(userId, cropType, landIds?)` - 批量种植

### CropHarvestService
专门的收获服务，提供详细的收获信息。

**主要方法:**
- `harvestCrop(userId, landId?)` - 收获作物
- `harvestAllMatureCrops(userId)` - 收获所有成熟作物
- `getHarvestableInfo(userId)` - 获取可收获信息

### CropCareService
专门的护理服务，支持批量操作。

**主要方法:**
- `waterCrop(userId, landId)` - 浇水
- `fertilizeCrop(userId, landId, fertilizerType?)` - 施肥
- `pesticideCrop(userId, landId)` - 除虫
- `batchCare(userId, careType, fertilizerType?)` - 批量护理

## 🔄 迁移指南

### 对现有代码的影响
**✅ 零影响**：所有现有代码无需任何修改即可继续工作。

### 服务容器配置更新
已自动更新 `services/index.js` 中的依赖注入配置：
```javascript
// 新的 PlantingService 实例化（已完成）
this.services.plantingService = new PlantingService(
  redisClient, 
  config, 
  null, 
  this.services.playerService.getDataService()
);
```

### 推荐的代码优化（可选）
虽然不是必需的，但建议在新代码中使用专门服务：

```javascript
// 原有方式（仍然有效）
await plantingService.plantCrop(userId, landId, cropType)

// 推荐方式（更明确的意图）
await plantingService.cropPlantingService.batchPlantCrop(userId, cropType)
```

## 🚀 性能优化

### 代码复用带来的优势
- **验证逻辑**：复用 Land 模型和现有验证器，减少重复代码
- **计算逻辑**：复用 utils/calculator.js 和 LevelCalculator，确保一致性
- **消息构建**：统一的消息格式，提高用户体验

### 架构优化
- **并发安全**：CropStatusService 使用分布式锁确保数据一致性
- **批量处理**：支持批量种植、收获、护理，提高处理效率
- **调度优化**：CropScheduleService 优化了 Redis ZSet 操作

## 🧪 测试建议

### 单元测试
每个专门服务都可以独立测试：
```javascript
// 测试种植服务
const mockPlayerDataService = createMockPlayerDataService()
const plantingService = new CropPlantingService(mockPlayerDataService, ...)
```

### 集成测试
通过主服务测试完整流程：
```javascript
// 测试完整的种植-护理-收获流程
await plantingService.plantCrop(userId, landId, cropType)
await plantingService.waterCrop(userId, landId)
await plantingService.harvestCrop(userId, landId)
```

## 🔮 最佳实践

### 1. 使用专门服务
对于新功能开发，建议直接使用专门服务以获得更好的类型安全和功能丰富性。

### 2. 批量操作
利用批量操作方法提高性能：
```javascript
// 批量种植
await cropPlantingService.batchPlantCrop(userId, 'wheat')

// 批量护理
await cropCareService.batchCare(userId, 'water')
```

### 3. 错误处理
所有服务都提供统一的错误格式，便于处理：
```javascript
const result = await plantingService.plantCrop(userId, landId, cropType)
if (!result.success) {
  console.error(result.message)
}
```

### 4. 扩展新功能
添加新功能时，遵循单一职责原则：
- 创建新的专门服务
- 在主服务中添加委托方法
- 更新服务容器配置

## 📈 重构成果

### 代码质量提升
- **代码行数**：从 913 行减少到 138 行（主服务）
- **职责分离**：8 个明确的职责领域
- **复用率**：最大化复用现有组件
- **可测试性**：每个服务可独立测试

### 维护性改善
- **单一职责**：每个服务只关注一个业务领域
- **依赖清晰**：明确的依赖注入关系
- **扩展性**：新功能可以独立添加
- **向后兼容**：现有代码零修改

### 性能优化
- **并发安全**：分布式锁保证数据一致性
- **批量处理**：支持高效的批量操作
- **调度优化**：优化的 Redis 操作
- **内存优化**：减少重复代码和对象创建

---

**重构完成时间**：2025年7月13日  
**重构版本**：v2.0  
**兼容性**：完全向后兼容  
**测试状态**：✅ 已验证

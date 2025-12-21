# 开发者指南

## 开发环境

### 环境要求

- Node.js >= 18.0
- pnpm >= 8.0
- Redis >= 6.0
- Miao-Yunzai 框架

### 本地开发

```bash
# 克隆项目
git clone <repository-url>
cd farm_game

# 安装依赖
pnpm install

# 启动 Redis
redis-server

# 在 Miao-Yunzai 中启动
cd ..  # 回到 Miao-Yunzai 根目录
node app
```

## 代码规范

### 目录结构

```
farm_game/
├── apps/                 # 指令处理器 (继承 plugin)
├── services/             # 业务服务层
│   ├── player/          # 玩家相关服务
│   ├── planting/        # 种植相关服务
│   ├── market/          # 市场相关服务
│   └── system/          # 系统服务
├── models/               # 数据模型
├── utils/                # 工具类
├── config/               # 配置覆盖
│   └── default_config/  # 默认配置
├── resources/            # 前端资源 (Vue)
├── data/                 # 运行时数据
└── tests/                # 测试用例
```

### 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 文件名 | PascalCase | `PlayerService.js` |
| 类名 | PascalCase | `class PlayerService` |
| 方法名 | camelCase | `getPlayer()` |
| 私有方法 | _camelCase | `_initServices()` |
| 常量 | UPPER_SNAKE | `MAX_LAND_COUNT` |
| 配置键 | snake_case | `starting_coins` |

### 代码风格

```javascript
// 服务类模板
class ExampleService {
  constructor(redisClient, config, ...dependencies) {
    this.redis = redisClient;
    this.config = config;
    this.logger = global.logger;
  }

  /**
   * 方法描述
   * @param {string} userId 用户ID
   * @returns {Promise<Object>} 返回结果
   */
  async doSomething(userId) {
    // 实现
  }
}
```

## 添加新功能

### 1. 添加新指令

在 `apps/` 目录创建或修改文件：

```javascript
// apps/example.js
import serviceContainer from '../services/index.js';

export class example extends plugin {
  constructor() {
    super({
      name: '示例功能',
      dsc: '功能描述',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#nc示例指令(.*)$',
          fnc: 'handleExample'
        }
      ]
    });

    this._initServices();
  }

  _initServices() {
    this.playerService = serviceContainer.getService('playerService');
  }

  async handleExample(e) {
    try {
      const match = e.msg.match(/^#nc示例指令(.*)$/);
      const param = match[1].trim();

      const userId = e.user_id.toString();

      // 检查玩家注册
      if (!(await this.playerService.isPlayer(userId))) {
        return e.reply('您未注册，请先"#nc注册"');
      }

      // 业务逻辑
      const result = await this.someService.doSomething(userId, param);

      if (result.success) {
        await e.reply(result.message);
      } else {
        await e.reply(`操作失败: ${result.message}`);
      }

      return true;
    } catch (error) {
      this.logger.error('[示例功能] 执行失败:', error);
      await e.reply('操作失败，请稍后重试');
      return true;
    }
  }
}
```

### 2. 添加新服务

在 `services/` 目录创建服务类：

```javascript
// services/example/ExampleService.js
export default class ExampleService {
  constructor(redisClient, config, playerService) {
    this.redis = redisClient;
    this.config = config;
    this.playerService = playerService;
    this.logger = global.logger;
  }

  async doSomething(userId, param) {
    try {
      // 获取玩家数据
      const player = await this.playerService.getPlayer(userId);

      // 业务逻辑

      // 保存数据
      await this.playerService.savePlayer(userId, player);

      return { success: true, message: '操作成功' };
    } catch (error) {
      this.logger.error(`[ExampleService] 操作失败: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
}
```

在 `services/index.js` 注册服务：

```javascript
import ExampleService from './example/ExampleService.js';

// 在 init() 方法中
this.services.exampleService = new ExampleService(
  redisClient,
  config,
  this.services.playerService
);
```

### 3. 添加新配置

在 `config/default_config/` 添加默认配置：

```yaml
# config/default_config/example.yaml
example:
  enabled: true
  settings:
    option1: value1
    option2: 100
```

在 `models/Config.js` 中加载配置：

```javascript
// 添加配置加载逻辑
```

## 数据访问

### Redis 操作

使用 `utils/redisClient.js` 封装的客户端：

```javascript
// 基础操作
await redis.set('key', 'value');
const value = await redis.get('key');

// Hash 操作
await redis.hSet('hash', 'field', 'value');
await redis.hIncrBy('hash', 'field', 1);

// 事务操作
await this.redis.transaction(async (multi) => {
  multi.hSet('key1', 'field', 'value');
  multi.hIncrBy('key2', 'count', 1);
  return { result: 'data' };
});
```

### YAML 存储

使用 `utils/fileStorage.js`：

```javascript
import { fileStorage } from '../utils/fileStorage.js';

// 读取
const data = await fileStorage.readYAML(filePath);

// 写入
await fileStorage.writeYAML(filePath, data);

// 原子写入
await fileStorage.atomicWrite(filePath, data);
```

### 玩家数据

通过 PlayerService 访问：

```javascript
// 获取玩家
const player = await this.playerService.getPlayer(userId);

// 保存玩家
await this.playerService.savePlayer(userId, player);

// 检查注册
const isPlayer = await this.playerService.isPlayer(userId);
```

## 工具类使用

### CommonUtils

```javascript
import { CommonUtils } from '../utils/CommonUtils.js';

// 时间处理
const remaining = CommonUtils.getRemainingMinutes(endTime);
const formatted = CommonUtils.formatRemainingTime(endTime);
const todayKey = CommonUtils.getTodayKey();

// 数量处理
const qty = CommonUtils.getItemQuantity(inventoryEntry);

// 计算
const total = CommonUtils.calcCoins(price, quantity);
```

### Calculator

```javascript
import Calculator from '../utils/calculator.js';

// 仓库计算
const total = Calculator.getTotalItems(inventory);

// 生长时间
const time = Calculator.calculateGrowTime(base, quality);

// 产量
const actualYield = Calculator.calculateYield(baseYield, land.quality, config);
```

### ItemResolver

```javascript
const itemResolver = serviceContainer.getService('itemResolver');

// 查找物品
const itemId = itemResolver.findItemByName('小麦种子');
const config = itemResolver.findItemById('wheat_seed');
const info = itemResolver.getItemInfo('wheat_seed');
```

## 图片渲染

使用 Puppeteer + Vue 渲染：

```javascript
import { Puppeteer } from '../models/services.js';

// 渲染数据准备
const renderData = {
  playerName: player.name,
  level: player.level,
  // ... 其他数据
};

// 渲染图片
await Puppeteer.renderVue('template/index', renderData, { e, scale: 2.0 });
```

模板位于 `resources/` 目录。

## 测试

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test -- --grep "PlayerService"
```

### 编写测试

```javascript
// tests/services/PlayerService.test.js
import { jest } from '@jest/globals';

describe('PlayerService', () => {
  let playerService;
  let mockRedis;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
    };
    playerService = new PlayerService(mockRedis, mockConfig);
  });

  it('should get player data', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(mockPlayerData));

    const player = await playerService.getPlayer('123');

    expect(player.name).toBe('TestPlayer');
  });
});
```

## 调试

### 日志

使用框架的 logger：

```javascript
logger.info('信息日志');
logger.warn('警告日志');
logger.error('错误日志', error);
logger.debug('调试日志');  // 需要开启 debug 模式
```

### 常见问题

1. **服务未初始化**
   ```
   Error: Service container not initialized
   ```
   确保在 `index.js` 中调用了 `serviceContainer.init()`

2. **循环依赖**
   使用 Lazy Initialization 模式解决

3. **Redis 连接失败**
   检查 Redis 服务状态和配置

## 发布检查清单

- [ ] 代码通过 ESLint 检查
- [ ] 所有测试通过
- [ ] 更新配置文档
- [ ] 更新 CHANGELOG
- [ ] 版本号更新

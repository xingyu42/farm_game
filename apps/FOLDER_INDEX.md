# apps/ - 应用指令处理层

## 📁 文件夹概述

**位置**: `/apps`
**角色**: 指令处理层 (Miao-Yunzai Plugin Layer)
**职责**: 接收用户指令 → 参数解析验证 → 调用服务层 → 返回响应

## 📂 文件列表

### 核心应用模块

| 文件 | 功能 | 主要指令 | 依赖服务 |
|------|------|---------|---------|
| **farm.js** | 农场核心操作 | #我的农场, #种植, #浇水, #施肥, #除虫, #收获 | PlantingService, InventoryService |
| **player.js** | 玩家基础功能 | #注册, #我的信息, #签到 | PlayerService, ProtectionService |
| **shop.js** | 商店交易 | #商店, #购买, #出售 | ShopService, InventoryService |
| **inventory.js** | 仓库管理 | #仓库, #仓库升级, #锁定, #解锁 | InventoryService |
| **steal.js** | 偷菜系统 | @用户 #偷菜, #狗粮 | StealService, ProtectionService |
| **land_management.js** | 土地管理 | #土地扩张, #土地升级 | LandService |
| **admin.js** | 管理员工具 | #nc管理... | AdminService, GlobalStatsService |
| **help.js** | 帮助文档 | #农场帮助 | - |
| **update.js** | 更新通知 | #农场更新 | - |

## 🔗 依赖关系

### 输入依赖 (Input)
```
apps/*.js
  ├─→ services/index.js (ServiceContainer - 获取服务实例)
  ├─→ models/Config.js (配置访问)
  ├─→ models/services.js (Puppeteer 图片渲染)
  └─→ ../../../lib/plugins/plugin.js (Miao-Yunzai 插件基类)
```

### 输出依赖 (Output)
```
apps/*.js
  └─→ index.js (插件入口动态加载)
```

## 📐 设计模式

- **继承**: 所有应用类继承自 `plugin` 基类
- **依赖注入**: 通过 `serviceContainer.getService()` 获取服务
- **MVC 模式**: 应用层仅负责指令路由和视图渲染,业务逻辑委托给服务层

## 🔄 数据流

```
用户消息 → Miao-Yunzai Framework
  ↓
apps/*.js (指令匹配 + 参数验证)
  ↓
ServiceContainer.getService() → services/*
  ↓
Redis / YAML 数据层
  ↓
apps/*.js (结果格式化 + 图片渲染)
  ↓
用户接收响应
```

## 📝 编码规范

### 应用类结构模板
```javascript
export class MyApp extends plugin {
  constructor() {
    super({
      name: '模块名称',
      dsc: '模块描述',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#指令正则$', fnc: 'methodName' }
      ]
    });
    this._initServices(); // 初始化服务依赖
  }

  _initServices() {
    this.someService = serviceContainer.getService('someService');
  }

  async methodName(e) {
    // 1. 参数验证
    // 2. 调用服务层
    // 3. 格式化响应
    // 4. 渲染图片或发送文本
  }
}
```

### 错误处理规范
- 使用 `try-catch` 包裹异步操作
- 用户友好的错误消息
- 详细的日志记录 (`logger.error`)

## 🎯 与服务层交互示例

```javascript
// ❌ 错误: 直接操作数据层
await redis.hget(`player:${userId}`, 'gold');

// ✅ 正确: 通过服务层
const playerService = serviceContainer.getService('playerService');
const player = await playerService.getPlayer(userId);
```

## 📊 性能优化

- 图片渲染使用 `Puppeteer.renderVue()` 支持 Vue 组件
- 批量操作优先使用服务层提供的批量方法
- 避免在应用层进行复杂计算

## 🔍 相关文档

- [服务层文档](../services/FOLDER_INDEX.md)
- [Miao-Yunzai 插件开发文档](https://github.com/yoimiya-kokomi/Miao-Yunzai)
- [项目架构文档](../Docs/architecture.md)

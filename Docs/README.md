# Farm Game Plugin

基于 Miao-Yunzai 框架的农场经营游戏插件，提供完整的种植、收获、交易、偷菜等玩法。

## 核心特性

- **种植系统**: 多种作物、实时生长周期、护理机制（浇水/施肥/除虫）
- **经济系统**: 动态市场价格、买卖交易、金币奖励
- **社交玩法**: 偷菜机制、防护系统、好友农场访问
- **成长系统**: 玩家等级、经验值、签到奖励、解锁内容
- **土地系统**: 土地扩张、品质升级、差异化收益

## 快速开始

### 安装

```bash
# 进入 Miao-Yunzai 插件目录
cd plugins

# 克隆仓库
git clone <repository-url> farm_game

# 安装依赖
cd farm_game && pnpm install
```

### 环境要求

- Node.js >= 18.0
- Redis >= 6.0
- Miao-Yunzai 框架

### 配置

配置文件位于 `config/` 目录，默认配置在 `config/default_config/`：

```
config/
├── crops.yaml          # 作物配置
├── items.yaml          # 物品配置
├── land.yaml           # 土地配置
├── levels.yaml         # 等级配置
├── market.yaml         # 市场配置
└── steal.yaml          # 偷菜配置
```

## 项目结构

```
farm_game/
├── apps/                 # 指令处理层
│   ├── farm.js          # 农场核心指令
│   ├── player.js        # 玩家相关指令
│   ├── shop.js          # 商店交易指令
│   ├── steal.js         # 偷菜防御指令
│   ├── inventory.js     # 仓库管理指令
│   └── admin.js         # 管理员指令
├── services/             # 业务逻辑层
│   ├── player/          # 玩家服务
│   ├── planting/        # 种植服务
│   ├── market/          # 市场服务
│   └── system/          # 系统服务
├── models/               # 数据模型层
├── utils/                # 工具类
├── config/               # 配置文件
├── resources/            # 前端资源
└── Docs/                 # 项目文档
```

## 核心指令

| 分类 | 指令 | 描述 |
|------|------|------|
| 基础 | `#nc注册` | 注册成为玩家 |
| 基础 | `#nc签到` | 每日签到领奖励 |
| 基础 | `#nc我的信息` | 查看个人信息 |
| 农场 | `#nc我的农场` | 查看农场状态 |
| 农场 | `#nc种植[作物][土地]` | 种植作物 |
| 农场 | `#nc浇水[土地]` | 给作物浇水 |
| 农场 | `#nc收获` | 收获成熟作物 |
| 商店 | `#nc商店` | 查看商店 |
| 商店 | `#nc购买[物品][数量]` | 购买物品 |
| 商店 | `#nc出售[物品][数量]` | 出售物品 |
| 社交 | `@用户 #nc偷菜` | 偷取他人作物 |
| 社交 | `#nc狗粮[类型]` | 激活农场防护 |

完整指令列表请使用 `#农场帮助` 查看。

## 技术架构

- **框架**: Miao-Yunzai (QQ Bot Framework)
- **存储**: Redis (高频数据) + YAML/JSON (持久化)
- **渲染**: Puppeteer + Vue.js (图片生成)
- **架构**: Service-Oriented + Dependency Injection

## 相关文档

- [架构设计](./architecture.md) - 系统架构和设计模式
- [用户指南](./user-guide.md) - 完整游戏指南
- [开发者指南](./developer-guide.md) - 开发和贡献指南
- [API 参考](./api-reference.md) - 框架 API 文档

## 许可证

MIT License

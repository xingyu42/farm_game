# Miao-Yunzai 农场游戏插件

<div align="center">
  
[![farm_game](https://socialify.git.ci/xingyu42/farm_game/image?description=1&font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit%20Board&pulls=1&stargazers=1&theme=Auto)](https://github.com/xingyu42/farm_game)

![Miao-Yunzai Version](https://img.shields.io/badge/Miao--Yunzai-v3.0.0+-green.svg)
![Node.js Version](https://img.shields.io/badge/node-16.0.0+-blue.svg)
[![License](https://img.shields.io/badge/license-TIM-brightgreen.svg)](./LICENSE)

**一款为 [Miao-Yunzai](https://github.com/yoimiya-kokomi/miao-yunzai) 设计的高度可定制的农场模拟经营游戏插件。**

欢迎来到农场游戏的世界！在这里，你可以从零开始，打造一个专属于你的梦想庄园！
  
</div>

---
<img decoding="async" align=right src="resources/log.jpg" width="25%">

## 💌 开发者寄语

你是否也曾梦想过拥有一片属于自己的土地，远离喧嚣，体验播种与收获的喜悦？

`farm_game` 插件的诞生，源于我们对田园生活的热爱与向往。

我们希望在这个小小的虚拟世界里，你能体验到从开垦荒地到丰收满仓的全过程，感受作物在你的精心照料下茁壮成长的成就感。

无论是成为一名精打细算的农场主，还是一个悠闲自得的田园诗人，这里都有属于你的一方天地。

希望这个插件不仅能给你带来欢乐，更能让你在忙碌的生活中找到一片宁静的港湾。

让我们一起，在群聊里种下一片希望吧！

## 🌟 主要功能

- **🌱 真实的种植体验**: 从播种、浇水到收获，体验作物的完整生长周期，感受丰收的喜悦！
- **🏡 个性化的家园管理**: 开垦荒地，升级土地，解锁更多高级作物，一步步打造你的梦想庄园。
- **🏪 自由的市场交易**: 在商店里自由买卖种子和作物，抓住市场机遇，体验成为商业大亨的乐趣。
- **🐶 刺激的社交互动**: 体验“半夜偷菜”的刺激，也可以部署忠诚的狗狗来保护你的劳动成果。
- **🛠️ 高度的自定义**: 从作物属性到商店物价，几乎所有游戏参数都可通过 `YAML` 文件进行配置，打造你专属的游戏规则。
- **⚙️ 强大的管理员工具**: 内置丰富的管理指令，方便服主轻松维护游戏秩序，调整玩家数据。

## 🚀 快速开始

### 1. 安装插件

进入 Miao-Yunzai 的根目录，使用 `git` 克隆本仓库。

- **GitHub (国外)**:

  ```bash
  git clone --depth=1 https://github.com/xingyu42/farm_game.git ./plugins/farm_game
  ```

- **Gitee (国内)**:

  ```bash
  git clone --depth=1 https://gitee.com/lianzi01/farm_game.git ./plugins/farm_game
  ```

### 2. 重启机器人

重启你的 Miao-Yunzai 机器人以加载新插件。

### 3. 开启农场之旅

在任意群聊中发送 `#nc注册`，即可成为一名光荣的农场主！

## 📋 指令列表

通过 `#nc` 前缀与游戏互动，发送 `#nc帮助` 获取完整的指令菜单。

| 分类 | 主要指令 | 描述 |
| :--- | :--- | :--- |
| **基础操作** | `#nc注册`, `#nc签到`, `#nc我的信息` | 创建角色，每日签到，查看个人状态。 |
| **农场管理** | `#nc我的农场`, `#nc种植`, `#nc收获`, `#nc浇水` | 查看农场，种植和收获作物，照料植物。 |
| **仓库与物品** | `#nc仓库`, `#nc出售`, `#nc锁定物品` | 管理你的物品，出售作物，保护重要道具。 |
| **商店交易** | `#nc商店`, `#nc购买` | 浏览并购买种子、道具等。 |
| **土地系统** | `#nc扩张土地`, `#nc升级土地` | 扩展你的农场规模，提升土地品质。 |
| **社交互动** | `#nc偷窃` | 与其他玩家互动，增加游戏乐趣。 |

## ❓ 常见问题 (Q&A)

**Q: 游戏刚开始，金币好少怎么办？**
A: 别担心，农场主的原始积累都是辛苦的！前期可以通过不断种植和出售初始作物来积累金币，记得每天 `#nc签到` 也能领到一笔启动资金哦！

**Q: 我的作物被偷了怎么办？**
A: 哎呀，看来有邻居来“拜访”了！你可以去商店购买“狗粮”防偷的概率。当然，你也可以选择去“拜访”别人家哦（小声）。

**Q: 插件安装后没反应？**
A: 请确认以下几点：

  1. 插件是否放置在正确的 `plugins` 目录下。
  2. 是否已重启过 Miao-Yunzai。
  3. 如果有报错，请检查控制台的日志信息。
  如果问题仍然存在，欢迎随时通过下面的联系方式找我们！

## 📞 支持与反馈

如果你在使用中遇到任何问题，或有任何功能建议，我们非常欢迎你通过以下方式联系我们：

- **提交 Issue**: 在 [GitHub Issues](https://github.com/xingyu42/farm_game/issues) 中详细描述你的问题或建议。
- **发起 Pull Request**: 如果你修复了 Bug 或开发了新功能，欢迎向我们提交 [Pull Request](https://github.com/xingyu42/farm_game/pulls)。

## ❤️ 贡献

感谢所有为本项目做出贡献的开发者！

[![contributors](https://contrib.rocks/image?repo=xingyu42/farm_game)](https://github.com/xingyu42/farm_game/graphs/contributors)

## 📄 许可证

本项目基于 [TIM](LICENSE) 授权。

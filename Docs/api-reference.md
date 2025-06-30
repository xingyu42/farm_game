# Miao-Yunzai框架 API 接口文档

## 目录

- [Bot对象API](#bot对象api)
- [事件处理](#事件处理)
- [消息处理](#消息处理)
- [插件开发](#插件开发)
- [权限控制](#权限控制)
- [定时任务](#定时任务)
- [上下文监听](#上下文监听)
- [消息撤回](#消息撤回)
- [转发消息](#转发消息)
- [配置管理](#配置管理)

---

## Bot对象API

### 应用端 (Bot)

```javascript
// Bot对象属性
Bot.uin  // 机器人账号数组 [bot1_id, bot2_id, ...]

// Bot对象方法
Bot.pickFriend(user_id)                          // 获取好友对象
Bot.pickGroup(group_id)                          // 获取群对象  
Bot.pickMember(group_id, user_id)                // 获取群成员对象
Bot.pickGuild(guild_id, channel_id)              // 获取频道对象
Bot.pickGuildMember(guild_id, channel_id, user_id) // 获取频道成员对象
```

### 机器人实例 (bot)

使用 `this.e.bot` 或 `Bot[bot_id]` 访问：

```javascript
// 机器人属性
bot.uin              // 机器人账号
bot.nickname         // 机器人昵称
bot.version.impl     // 适配器名称
bot.fl               // 好友列表 (Map)
bot.gl               // 群列表 (Map)  
bot.tl               // 频道列表 (Map)

// 机器人方法
bot.pickFriend(user_id)                           // 好友对象
bot.pickGroup(group_id)                           // 群对象
bot.pickMember(group_id, user_id)                 // 群成员对象
bot.pickGuild(guild_id, channel_id)               // 频道对象
bot.pickGuildMember(guild_id, channel_id, user_id) // 频道成员对象

// 获取列表
bot.getFriendList()  // 好友列表
bot.getFriendMap()   // 好友列表(Map)
bot.getGroupList()   // 群列表
bot.getGroupMap()    // 群列表(Map)  
bot.getGuildList()   // 频道列表
bot.getGuildMap()    // 频道列表(Map)

// API调用
bot.sendApi(action, params)  // 发送API请求

// 发送私聊消息
bot.sendPrivateMsg(user_id, message, source?)
bot.pickFriend(user_id).sendMsg(content, source?)  // 限已添加好友
bot.pickUser(user_id).sendMsg(content, source?)    // 通用方式
```

---

## 事件处理

### 事件对象结构

所有事件处理方法都会收到标准的事件对象：

```javascript
// 群聊事件
{
  isMaster: boolean,     // 是否是主人
  isGroup: boolean,      // 是否是群聊
  isPrivate: boolean,    // 是否是私聊
  isGuild: boolean,      // 是否是频道
  msg: string,           // 用户消息
  user_id: string,       // 用户编号
  user_name: string,     // 用户名
  user_avatar: string,   // 用户头像
  group_id: number,      // 群号
  group_name: string,    // 群名
  group_avatar: string,  // 群头像
  sender: object,        // 发送者信息
  group: object,         // 群组信息
  friend: object,        // 好友信息
  bot: object           // 机器人实例
}
```

### 事件类型

```javascript
// 事件监听类型
'message.group'    // 群消息
'message.private'  // 私聊消息  
'message'          // 全部消息
```

---

## 消息处理

### yunzaijs 风格 (推荐)

#### 函数式消息处理

```javascript
import { Messages } from 'yunzaijs'

const message = new Messages('message.group')
message.use(
  e => {
    e.reply('hello world')
  },
  [/^(#|\/)?hello/]  // 正则匹配规则
)

export const Word = message.ok
```

#### 类式消息处理

```javascript
import { Application } from 'yunzaijs'

export class Word extends Application<'message.group'> {
  constructor() {
    super('message.group')
    this.rule = [
      {
        reg: /^(#|\/)?hello/,
        fnc: this.hello.name
      }
    ]
  }
  
  hello() {
    this.e.reply('hello world')
  }
}
```

#### 发送图片

```javascript
import { Messages, Segment } from 'yunzaijs'

const message = new Messages('message.group')
message.use(
  e => {
    const img = null  // Buffer类型图片数据
    e.reply(Segment.image(img))
    
    // 复合消息
    e.reply(['这是一张图片', Segment.image(img)])
  },
  [/^(#|\/)?image/]
)
```

#### 转发消息

```javascript
import { Messages, makeForwardMsg } from 'yunzaijs'

const message = new Messages('message.group')
message.use(
  async e => {
    const forwardMsg = await makeForwardMsg(
      e, 
      ['hello', 'world'], 
      'this is makeForwardMsg'
    )
    e.reply(forwardMsg)
  },
  [/^(#|\/)?forward/]
)
```

---

## 插件开发

### 基础插件结构

```javascript
export class TextMsg extends plugin {
  constructor() {
    super({
      name: '测试插件',                    // 插件名称
      dsc: '这是一个基础的插件示例',        // 插件描述
      event: 'message',                   // 监听事件
      priority: 6,                        // 优先级 (数字越小优先级越高)
      rule: [
        {
          reg: '^#测试回复$',              // 正则表达式
          fnc: 'test'                     // 执行方法
        }
      ]
    })
  }

  async test(e) {
    // 各种回复方式
    e.reply("测试回复", true)                           // 引用回复
    e.reply("测试回复", false, { at: true })           // at回复
    e.reply("测试回复", true, { at: true })            // 引用并at回复
    e.reply("测试回复", false, { recallMsg: 5 })       // 5秒后撤回
    e.reply("测试回复", true, { at: true, recallMsg: 5 }) // 引用at并5秒后撤回
    
    return true  // 停止向下循环
  }
}
```

### 插件构造函数参数

```javascript
{
  name: string,        // 插件名称，默认 "your-plugin"
  dsc: string,         // 插件描述，默认 "无"
  handler: object,     // 事件处理器配置
  namespace: string,   // 命名空间
  event: string,       // 执行事件，默认 "message"
  priority: number,    // 优先级，数字越小优先级越高，默认 5000
  task: object,        // 定时任务配置
  rule: array         // 命令规则数组
}
```

---

## 权限控制

### 权限级别

```javascript
rule: [
  {
    reg: '^#命令$',
    fnc: 'method',
    permission: 'master'  // 权限控制
  }
]

// 权限级别
'master'  // 主人
'owner'   // 群主
'admin'   // 管理员  
'all'     // 所有用户
```

---

## 定时任务

### 配置定时任务

```javascript
constructor() {
  super({
    name: '插件名称',
    dsc: '插件描述',
    task: {
      name: '任务名称',
      cron: '0 0 * * *',  // cron表达式
      fnc: 'taskMethod'   // 执行方法
    }
  })
}

async taskMethod() {
  // 定时任务逻辑
}
```

---

## 上下文监听

### 基础上下文

```javascript
export class ContextExample extends plugin {
  constructor() {
    super({
      name: '复读',
      dsc: '复读用户发送的内容',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#复读$',
          fnc: 'repeat'
        }
      ]
    })
  }

  async repeat(e) {
    this.setContext('doRep')  // 开始监听上下文
    e.reply('请发送要复读的内容', false, { at: true })
  }

  doRep(e) {
    this.finish('doRep')  // 结束上下文监听
    e.reply(this.e.message, false, { recallMsg: 5 })
  }
}
```

### 进阶上下文 (带状态管理)

```javascript
let contextData = {}

export class AdvancedContext extends plugin {
  constructor() {
    super({
      name: '简单计算',
      dsc: '数学题上下文示例',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#来个数学题$',
          fnc: 'calculate'
        }
      ]
    })
  }

  async calculate(e) {
    const num1 = Math.floor(Math.random() * 10)
    const num2 = Math.floor(Math.random() * 10)
    const operator = Math.random() < 0.5 ? '+' : '-'
    const value = operator === "+" ? num1 + num2 : num1 - num2

    // 储存上下文数据
    contextData[e.user_id] = { 
      attempts: 1, 
      answer: value 
    }

    this.setContext('checkAnswer')
    e.reply(`请回答：${num1} ${operator} ${num2} = ?`, true, { at: true })
  }

  checkAnswer(e) {
    e = this.e
    const userData = contextData[e.user_id]

    if (e.msg == userData.answer) {
      this.finish('checkAnswer')
      delete contextData[e.user_id]
      e.reply("回答正确！", true)
      return true
    } else {
      if (userData.attempts >= 3) {
        this.finish('checkAnswer')
        delete contextData[e.user_id]
        e.reply("回答错误，已经错误3次，已关闭当前问答！", true, { at: true })
        return true
      } else {
        userData.attempts++
        e.reply("回答错误，请重新计算答案", true, { at: true })
      }
    }
  }
}
```

---

## 消息撤回

### 快速撤回

撤回用户触发的消息：

```javascript
async test(e) {
  e.recall()  // 撤回用户消息
  return true
}
```

### 定向撤回

撤回指定的消息：

```javascript
async test(e) {
  // 发送消息并获取message_id
  const res = await e.reply("消息1")
  const msg_id = res.message_id

  await e.reply("消息2")

  // 撤回之前的消息
  if (e.isGroup) {
    await e.group.recallMsg(msg_id)  // 群聊撤回
  } else {
    await e.friend.recallMsg(msg_id) // 私聊撤回
  }

  return true
}
```

### 消息返回结构

```javascript
// 发送消息后的返回值
{
  message_id: "P+u0LgAACL3eZoi7ZSBXHwE=",
  seq: 2237,
  rand: 3731261627,  
  time: 1696618271
}
```

---

## 转发消息

### 制作转发消息

```javascript
import common from '../../lib/common/common.js'

export class ForwardMsg extends plugin {
  constructor() {
    super({
      name: '转发',
      dsc: '转发示例', 
      event: 'message',
      priority: 6,
      rule: [
        {
          reg: '^#转发$',
          fnc: 'forwardmsg'
        }
      ]
    })
  }

  async forwardmsg(e) {
    // 收集转发消息
    const forward = [
      "这是消息1",
      segment.face(104),                              // 表情
      segment.image("./resources/test.png"),          // 本地图片
      segment.image("https://example.com/image.png")  // 网络图片
    ]

    // 动态添加消息
    forward.push("这是消息4")

    // 制作转发消息
    const msg = await common.makeForwardMsg(e, forward, '转发描述')
    
    // 发送转发消息
    await this.reply(msg)
    return true
  }
}
```

---

## 配置管理

### 系统配置

```javascript
// 系统常量 (不可修改)
import { BOT_NAME } from 'yunzaijs'

// 系统配置器 (可修改)
import { ConfigController } from 'yunzaijs'
```

### 配置文件

#### alemon.config.yaml

```yaml
pm2:
  name: 'qq'
  script: 'node lib/main.js'
```

## 注意事项

### 全局变量

在插件开发中，以下变量已经是全局变量，无需导入：

```javascript
// ❌ 不需要导入
// import plugin from '../../lib/plugins/plugin.js'
// import { segment } from 'oicq' 
// import { segment } from 'icqq'

// ✅ 直接使用
plugin
segment
bot
```

### 返回值控制

```javascript
// 返回值说明
return true   // 停止向下循环，阻止其他插件处理
return false  // 继续向下循环，允许其他插件处理
```

### 异步处理

```javascript
// 推荐使用 await 处理异步操作
await e.reply("消息")
await this.setContext('method')
```

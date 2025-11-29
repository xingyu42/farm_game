/*
* 农场游戏帮助系统配置文件
* 此配置文件为系统使用，请勿修改，否则可能无法正常使用
* 如需自定义配置请复制修改上一级help_system.js
*/

export const helpCfg = {
    title: '农场游戏帮助',
    subTitle: 'Miao-Yunzai & Farm-Game-Plugin',
    columnCount: 3, // 每行显示的指令数量
    colWidth: 265, // 每列宽度
    theme: 'all', // 主题
    themeExclude: ['default'], // 排除主题
    style: {
        fontColor: '#ceb78b', // 字体颜色
        descColor: '#eee', // 描述颜色
        contBgColor: 'rgba(6, 21, 31, .5)', // 内容背景颜色
        contBgBlur: 3, // 内容背景模糊
        headerBgColor: 'rgba(6, 21, 31, .4)', // 头部背景颜色
        rowBgColor1: 'rgba(6, 21, 31, .2)', // 行背景颜色1
        rowBgColor2: 'rgba(6, 21, 31, .35)' // 行背景颜色2
    }
}

export const helpList = [{
    group: '👤 基础功能',
    list: [{
        icon: 61,
        title: '#nc注册',
        desc: '注册成为农场玩家，开始游戏'
    }, {
        icon: 63,
        title: '#nc我的信息',
        desc: '查看个人农场详细信息'
    }, {
        icon: 66,
        title: '#nc签到',
        desc: '每日签到获取金币和经验奖励'
    }]
}, {
    group: '🌾 农场管理',
    list: [{
        icon: 58,
        title: '#nc我的农场',
        desc: '查看自己的农场状态和作物情况'
    }, {
        icon: 59,
        title: '@用户名 #nc农场',
        desc: '查看其他玩家的农场状态'
    }, {
        icon: 60,
        title: '#nc种植 [土地] [作物]',
        desc: '在指定土地种植作物'
    }, {
        icon: 88,
        title: '#nc浇水 [土地编号]',
        desc: '给指定土地的作物浇水，提升生长速度'
    }, {
        icon: 53,
        title: '#nc施肥 [土地编号]',
        desc: '给指定土地施肥，提升作物品质'
    }, {
        icon: 56,
        title: '#nc除虫 [土地编号]',
        desc: '给指定土地除虫，保护作物健康'
    }, {
        icon: 78,
        title: '#nc收获 [土地编号]',
        desc: '收获指定土地的成熟作物'
    }, {
        icon: 77,
        title: '#nc收获全部',
        desc: '一键收获所有成熟的作物'
    }]
}, {
    group: '🎒 仓库管理',
    list: [{
        icon: 15,
        title: '#nc仓库',
        desc: '查看仓库中的所有物品和容量'
    }, {
        icon: 5,
        title: '#nc仓库升级',
        desc: '升级仓库容量，存储更多物品'
    }, {
        icon: 10,
        title: '#nc锁定 [物品名称]',
        desc: '锁定指定物品，防止误操作出售'
    }, {
        icon: 22,
        title: '#nc解锁 [物品名称]',
        desc: '解锁指定物品，允许出售'
    }]
}, {
    group: '🏪 商店交易',
    list: [{
        icon: 11,
        title: '#nc商店',
        desc: '查看商店中可购买的物品'
    }, {
        icon: 12,
        title: '#nc市场',
        desc: '查看市场价格信息'
    }, {
        icon: 13,
        title: '#nc购买 [物品] [数量]',
        desc: '购买指定物品'
    }, {
        icon: 14,
        title: '#nc出售 [物品] [数量]',
        desc: '出售指定物品'
    }, {
        icon: 85,
        title: '#nc出售全部',
        desc: '出售所有可出售的作物'
    }]
}, {
    group: '🏞️ 土地系统',
    list: [{
        icon: 20,
        title: '#nc土地扩张',
        desc: '扩张新的土地，增加种植面积'
    }, {
        icon: 21,
        title: '#nc土地信息',
        desc: '查看所有土地的详细信息'
    }, {
        icon: 23,
        title: '#nc土地进阶 [土地编号]',
        desc: '提升指定土地的品质等级'
    }, {
        icon: 24,
        title: '#nc土地品质 [土地编号]',
        desc: '查看指定土地的品质信息'
    }]
}, {
    group: '🛡️ 偷菜防御',
    list: [{
        icon: 30,
        title: '@用户名 #nc偷菜',
        desc: '偷取其他玩家农场的成熟作物'
    }, {
        icon: 31,
        title: '#nc使用狗粮 [类型]',
        desc: '使用狗粮激活农场防护'
    }, {
        icon: 32,
        title: '#nc防护状态',
        desc: '查看当前农场的防护状态'
    }, {
        icon: 33,
        title: '#nc偷菜状态',
        desc: '查看偷菜冷却时间和相关状态'
    }]
}, {
    group: '⚙️ 管理功能',
    auth: 'master',
    list: [{
        icon: 40,
        title: '#nc管理 重置玩家 @用户',
        desc: '重置指定玩家的游戏数据'
    }, {
        icon: 41,
        title: '#nc管理 添加金币 @用户 [数量]',
        desc: '给指定玩家添加金币'
    }, {
        icon: 42,
        title: '#nc管理 添加经验 @用户 [数量]',
        desc: '给指定玩家添加经验'
    }, {
        icon: 43,
        title: '#nc管理 统计',
        desc: '查看游戏统计和经济分析数据'
    }, {
        icon: 44,
        title: '#nc管理 重载配置',
        desc: '重新加载游戏配置文件'
    }, {
        icon: 45,
        title: '#nc管理 备份数据',
        desc: '手动备份游戏数据'
    }]
}]

export const isSys = true

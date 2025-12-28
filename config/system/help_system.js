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
        title: '@用户 #nc农场',
        desc: '查看其他玩家的农场状态'
    }, {
        icon: 60,
        title: '#nc种植[作物][土地/全部]',
        desc: '种植作物，如 #nc种植小麦1 或 #nc种植小麦全部'
    }, {
        icon: 88,
        title: '#nc浇水[土地/全部]',
        desc: '给作物浇水，如 #nc浇水1 或 #nc浇水全部'
    }, {
        icon: 53,
        title: '#nc施肥[土地/全部][肥料]',
        desc: '给作物施肥，如 #nc施肥1 或 #nc施肥全部高级肥料'
    }, {
        icon: 56,
        title: '#nc除虫[土地/全部]',
        desc: '给作物除虫，如 #nc除虫1 或 #nc除虫全部'
    }, {
        icon: 78,
        title: '#nc收获',
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
        title: '#nc锁定[物品名]',
        desc: '锁定指定物品，防止误操作出售'
    }, {
        icon: 22,
        title: '#nc解锁[物品名]',
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
        title: '#nc购买[物品][数量]',
        desc: '购买指定物品，如 #nc购买小麦种子10'
    }, {
        icon: 14,
        title: '#nc出售[物品][数量]',
        desc: '出售指定物品，如 #nc出售小麦5'
    }, {
        icon: 85,
        title: '#nc出售全部',
        desc: '出售所有可出售的作物'
    }, {
        icon: 86,
        title: '#nc查看[物品]',
        desc: '查看指定物品的详细信息'
    }]
}, {
    group: '🏞️ 土地系统',
    list: [{
        icon: 20,
        title: '#nc土地扩张',
        desc: '扩张新的土地，增加种植面积'
    }, {
        icon: 23,
        title: '#nc土地升级[土地编号]',
        desc: '提升指定土地的品质等级'
    }]
}, {
    group: '🏦 土地买卖',
    list: [{
        icon: 25,
        title: '#nc出售土地 [价格] [分红率]',
        desc: '挂牌出售土地收益权，如 #nc出售土地 50000 35'
    }, {
        icon: 26,
        title: '#nc土地市场',
        desc: '查看土地市场挂牌列表'
    }, {
        icon: 27,
        title: '#nc购买土地[序号]',
        desc: '按序号购买土地'
    }, {
        icon: 28,
        title: '#nc我的挂牌',
        desc: '查看自己挂牌出售的土地'
    }, {
        icon: 29,
        title: '#nc取消出售[序号]',
        desc: '取消指定序号的挂牌'
    }, {
        icon: 30,
        title: '#nc我的持有',
        desc: '查看持有的土地收益权'
    }, {
        icon: 31,
        title: '#nc转售土地[序号]',
        desc: '将持有的土地收益权转售（5%手续费）'
    }, {
        icon: 32,
        title: '#nc取消转售[序号]',
        desc: '取消转售挂牌'
    }, {
        icon: 33,
        title: '#nc转售市场',
        desc: '查看转售市场挂牌列表'
    }, {
        icon: 34,
        title: '#nc购买转售[序号]',
        desc: '购买转售市场的土地'
    }, {
        icon: 35,
        title: '#nc我的售出',
        desc: '地主查看已售出的土地列表'
    }, {
        icon: 36,
        title: '#nc赎回土地[序号]',
        desc: '地主按原价赎回已售土地'
    }]
}, {
    group: '🛡️ 偷菜防御',
    list: [{
        icon: 37,
        title: '@用户 #nc偷菜',
        desc: '偷取其他玩家农场的成熟作物'
    }, {
        icon: 38,
        title: '#nc狗粮[类型]',
        desc: '使用狗粮激活农场防护，如 #nc狗粮普通'
    }]
}, {
    group: '⚙️ 管理功能',
    auth: 'master',
    list: [{
        icon: 40,
        title: '#nc管理重置玩家 @用户',
        desc: '重置指定玩家的游戏数据'
    }, {
        icon: 41,
        title: '#nc管理添加金币 @用户 [数量]',
        desc: '给指定玩家添加金币'
    }, {
        icon: 42,
        title: '#nc管理添加经验 @用户 [数量]',
        desc: '给指定玩家添加经验'
    }, {
        icon: 43,
        title: '#nc管理设置土地品质 @用户',
        desc: '设置指定玩家的土地品质'
    }, {
        icon: 44,
        title: '#nc管理统计',
        desc: '查看游戏经济分析报告'
    }, {
        icon: 46,
        title: '#nc管理备份',
        desc: '手动备份游戏数据'
    }]
}]

export const isSys = true

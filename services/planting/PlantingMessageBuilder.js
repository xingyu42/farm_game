/**
 * 消息构建工具类
 * 统一种植相关的消息构建逻辑
 */

class PlantingMessageBuilder {
  constructor() {
    this.icons = {
      success: '🎉',
      error: '❌',
      info: 'ℹ️',
      time: '⏰',
      fertilizer: '🧪'
    };
  }

  /**
   * 构建错误消息
   */
  buildErrorMessage(operation, error) {
    const errorMessage = error instanceof Error ? error.message : error;
    return {
      success: false,
      message: `${this.icons.error} ${errorMessage}`
    };
  }

  /**
   * 构建信息消息
   */
  buildInfoMessage(content) {
    return {
      success: true,
      message: `${this.icons.info} ${content}`
    };
  }

  /**
   * 构建种植成功响应
   */
  buildPlantingMessage(cropName, landId, harvestTime, options = {}) {
    return {
      success: true,
      data: {
        cropName,
        landId,
        harvestTime,
        expectedHarvestTime: this._formatTime(new Date(harvestTime)),
        ...options
      }
    };
  }

  /**
   * 构建收获成功响应
   */
  buildHarvestMessage(harvestedCrops, totalExp = 0, options = {}) {
    return {
      success: true,
      data: {
        harvestedCrops,
        totalExperience: totalExp,
        ...options
      }
    };
  }

  /**
   * 构建部分收获响应
   */
  buildPartialHarvestMessage(harvestedCrops, skippedCrops, totalExp = 0, inventoryInfo = {}, options = {}) {
    return {
      success: harvestedCrops.length > 0,
      data: {
        harvestedCrops,
        skippedCrops,
        totalExperience: totalExp,
        inventoryInfo,
        isPartialHarvest: true,
        ...options
      }
    };
  }

  /**
   * 构建护理成功消息
   */
  buildCareMessage(careType, cropName, landId, effectData = {}) {
    const careNames = { water: '浇水', fertilize: '施肥', pesticide: '除虫' };
    const careName = careNames[careType] || '护理';

    let message = `${this.icons.success} 成功为第${landId}块土地的${cropName}${careName}！`;

    if (effectData.timeReduced) {
      message += `\n${this.icons.time} 生长时间减少${Math.floor(effectData.timeReduced / 1000)}秒`;
    }

    if (effectData.fertilizerUsed) {
      const prefix = effectData.selectionType === '手动选择' ? '使用了指定的' : '自动使用了';
      message += `\n${this.icons.fertilizer} ${prefix}${effectData.fertilizerUsed}`;
    }

    return {
      success: true,
      message,
      data: { landId, cropName, careType, ...effectData }
    };
  }

  _formatTime(date) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 构建图片渲染用的操作结果
   */
  static buildRenderResult(result, operationType) {
    if (!result || !result.success) return null;

    const renderIcons = {
      water: 'ion:water',
      fertilize: 'lucide:flask-conical',
      pesticide: 'fa6-solid:bug',
      harvest: 'lucide:package-check',
      success: 'fa6-solid:check'
    };

    const titleMap = {
      water: '浇水完成',
      fertilize: '施肥完成',
      pesticide: '除虫完成'
    };

    const details = [];
    if (result.message) {
      const lines = result.message.split('\n').filter(line => !line.includes('成功'));
      details.push(...lines.filter(Boolean));
    }

    return {
      type: 'success',
      icon: renderIcons[operationType] || renderIcons.success,
      title: titleMap[operationType] || '操作完成',
      details: details.length > 0 ? details : ['操作已成功完成']
    };
  }

  /**
   * 构建收获结果的图片渲染数据
   */
  static buildHarvestRenderResult(result) {
    if (!result || !result.success) return null;

    if (!result.data) {
      return {
        type: 'info',
        icon: 'lucide:info',
        title: '暂无收获',
        details: ['当前没有成熟的作物']
      };
    }

    const harvestedCrops = result.data?.harvestedCrops || [];
    const skippedCrops = result.data?.skippedCrops || [];
    const isPartialHarvest = result.data?.isPartialHarvest;
    const inventoryInfo = result.data?.inventoryInfo || {};
    const levelUp = result.data?.levelUp;
    const unlockedItemNames = result.data?.unlockedItemNames || [];

    if (isPartialHarvest && skippedCrops.length > 0) {
      const details = [];

      if (harvestedCrops.length > 0) {
        details.push(`收获: ${harvestedCrops.length}块土地`);
        details.push('');
      }

      if (inventoryInfo.currentUsage !== undefined && inventoryInfo.capacity !== undefined) {
        details.push(`⚠️ 仓库已满 (${inventoryInfo.currentUsage}/${inventoryInfo.capacity})`);
      } else {
        details.push('⚠️ 仓库已满');
      }
      details.push('请清理或升级仓库后再收获');

      if (levelUp?.newLevel) {
        details.push('');
        details.push(`升级: Lv.${levelUp.oldLevel} → Lv.${levelUp.newLevel}`);
        if (unlockedItemNames.length > 0) {
          details.push(`解锁: ${unlockedItemNames.join('、')}`);
        }
      }

      return {
        type: 'warning',
        icon: 'lucide:alert-triangle',
        title: harvestedCrops.length > 0 ? '部分收获完成' : '仓库空间不足',
        details
      };
    }

    const details = [];
    if (harvestedCrops.length > 0) {
      const totalYield = harvestedCrops.reduce((sum, crop) => sum + (crop.yield || 0), 0);
      details.push(`土地: ${harvestedCrops.length}块`);
      details.push(`数量: ${totalYield}`);
    }

    if (levelUp?.newLevel) {
      details.push(`升级: Lv.${levelUp.oldLevel} → Lv.${levelUp.newLevel}`);
      if (unlockedItemNames.length > 0) {
        details.push(`解锁: ${unlockedItemNames.join('、')}`);
      }
    }

    return {
      type: 'success',
      icon: 'lucide:package-check',
      title: '收获完成',
      details: details.length > 0 ? details : ['所有成熟作物已收获']
    };
  }
}

export default PlantingMessageBuilder;

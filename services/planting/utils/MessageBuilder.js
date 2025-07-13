/**
 * 消息构建工具类
 * 统一种植相关的消息构建逻辑，保持项目消息格式一致性
 */

class MessageBuilder {
  constructor() {
    // 消息图标配置
    this.icons = {
      success: '🎉',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      plant: '🌱',
      harvest: '🎉',
      water: '💧',
      fertilizer: '🧪',
      pesticide: '🐛',
      experience: '✨',
      time: '⏰',
      land: '🏞️',
      crop: '🌾',
      health: '❤️',
      coins: '💰'
    };

    // 分隔线
    this.separator = '━━━━━━━━━━━━━━━━━━';
  }

  /**
   * 构建成功消息
   * @param {string} operation 操作类型
   * @param {Object} data 数据对象
   * @returns {Object} 标准响应格式
   */
  buildSuccessMessage(operation, data) {
    return {
      success: true,
      message: data.message || `${this.icons.success} 操作成功！`,
      data: data
    };
  }

  /**
   * 构建错误消息
   * @param {string} operation 操作类型
   * @param {string|Error} error 错误信息
   * @returns {Object} 标准响应格式
   */
  buildErrorMessage(operation, error) {
    const errorMessage = error instanceof Error ? error.message : error;
    return {
      success: false,
      message: `${this.icons.error} ${errorMessage}`
    };
  }

  /**
   * 构建种植成功消息
   * @param {string} cropName 作物名称
   * @param {number} landId 土地编号
   * @param {number} harvestTime 收获时间戳
   * @param {Object} options 额外选项
   * @returns {Object} 种植响应
   */
  buildPlantingMessage(cropName, landId, harvestTime, options = {}) {
    const expectedTime = this._formatTime(new Date(harvestTime));
    const message = `${this.icons.success} 成功在第${landId}块土地种植了${cropName}！\n${this.icons.time} 预计收获时间：${expectedTime}`;
    
    return {
      success: true,
      message: message,
      data: {
        cropName,
        landId,
        harvestTime,
        expectedHarvestTime: expectedTime,
        ...options
      }
    };
  }

  /**
   * 构建收获成功消息
   * @param {Array} harvestedCrops 收获的作物列表
   * @param {number} totalExp 总经验值
   * @param {Object} options 额外选项
   * @returns {Object} 收获响应
   */
  buildHarvestMessage(harvestedCrops, totalExp = 0, options = {}) {
    const messages = [`${this.icons.harvest} 收获成功！`];
    
    // 添加收获详情
    for (const crop of harvestedCrops) {
      messages.push(`${this.icons.land}[${crop.landId}] ${crop.cropName} x${crop.yield}`);
    }
    
    // 添加经验信息
    if (totalExp > 0) {
      messages.push(`${this.icons.experience} 获得经验: ${totalExp}`);
    }
    
    return {
      success: true,
      message: messages.join('\n'),
      data: {
        harvestedCrops,
        totalExperience: totalExp,
        ...options
      }
    };
  }

  /**
   * 构建护理成功消息
   * @param {string} careType 护理类型 (water, fertilizer, pesticide)
   * @param {string} cropName 作物名称
   * @param {number} landId 土地编号
   * @param {Object} effectData 效果数据
   * @returns {Object} 护理响应
   */
  buildCareMessage(careType, cropName, landId, effectData = {}) {
    const careIcons = {
      water: this.icons.water,
      fertilizer: this.icons.fertilizer,
      pesticide: this.icons.pesticide
    };

    const careNames = {
      water: '浇水',
      fertilizer: '施肥',
      pesticide: '除虫'
    };

    const icon = careIcons[careType] || this.icons.success;
    const careName = careNames[careType] || '护理';
    
    let message = `${this.icons.success} 成功为第${landId}块土地的${cropName}${careName}！`;
    
    // 添加具体效果信息
    if (effectData.health !== undefined) {
      message += `\n${this.icons.health} 健康度恢复到${effectData.health}%`;
    }
    
    if (effectData.timeReduced) {
      message += `\n${this.icons.time} 生长时间减少${Math.floor(effectData.timeReduced/1000)}秒`;
    }
    
    if (effectData.fertilizerUsed) {
      const selectionPrefix = effectData.selectionType === '手动选择' ? '使用了指定的' : '自动使用了';
      message += `\n${this.icons.fertilizer} ${selectionPrefix}${effectData.fertilizerUsed}`;
    }

    return {
      success: true,
      message: message,
      data: {
        landId,
        cropName,
        careType,
        ...effectData
      }
    };
  }

  /**
   * 构建农场状态消息
   * @param {Object} farmData 农场数据
   * @param {Array} landDetails 土地详情列表
   * @returns {string} 农场状态消息
   */
  buildFarmStatusMessage(farmData, landDetails = []) {
    const messages = [
      `${this.icons.crop} ${farmData.playerName || '玩家'} 的农场`,
      this.separator,
      `${this.icons.land} 土地: ${farmData.landCount}/24 块`,
      `${this.icons.coins} 金币: ${farmData.coins.toLocaleString()}`,
      `${this.icons.experience} 经验: ${farmData.experience}`,
      this.separator
    ];

    // 添加土地详情
    if (landDetails.length > 0) {
      messages.push('土地状态：');
      landDetails.forEach(land => {
        messages.push(land);
      });
    }

    return messages.join('\n');
  }

  /**
   * 构建验证失败消息
   * @param {string} reason 失败原因
   * @param {Object} suggestions 建议信息
   * @returns {Object} 验证失败响应
   */
  buildValidationErrorMessage(reason, suggestions = {}) {
    let message = `${this.icons.error} ${reason}`;
    
    if (suggestions.availableOptions && suggestions.availableOptions.length > 0) {
      message += `\n可用选项：${suggestions.availableOptions.join('、')}`;
    }
    
    if (suggestions.requirement) {
      message += `\n${this.icons.info} ${suggestions.requirement}`;
    }

    return {
      success: false,
      message: message,
      suggestions: suggestions
    };
  }

  /**
   * 构建批量操作结果消息
   * @param {string} operation 操作类型
   * @param {Array} results 操作结果列表
   * @returns {Object} 批量操作响应
   */
  buildBatchOperationMessage(operation, results) {
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    const messages = [
      `${this.icons.success} ${operation}完成！`,
      `成功: ${successCount}/${totalCount}`
    ];

    // 添加失败详情
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      messages.push('失败详情：');
      failures.forEach(failure => {
        messages.push(`${this.icons.error} ${failure.message}`);
      });
    }

    return {
      success: successCount > 0,
      message: messages.join('\n'),
      data: {
        operation,
        successCount,
        totalCount,
        results
      }
    };
  }

  /**
   * 格式化时间显示
   * @param {Date} date 日期对象
   * @returns {string} 格式化的时间
   * @private
   */
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
   * 获取操作图标
   * @param {string} operation 操作类型
   * @returns {string} 对应图标
   * @private
   */
  _getOperationIcon(operation) {
    const operationIcons = {
      plant: this.icons.plant,
      harvest: this.icons.harvest,
      water: this.icons.water,
      fertilize: this.icons.fertilizer,
      pesticide: this.icons.pesticide
    };
    
    return operationIcons[operation] || this.icons.success;
  }
}

export { MessageBuilder };

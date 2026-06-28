import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { apiClient } from '../api';

/**
 * 向量数据库重建相关的状态与逻辑。
 * 抽离自 Settings.vue / KnowledgeListPanel.vue，便于复用与维护。
 *
 * @param {Function} onRebuildComplete 重建完成后的回调（用于刷新知识列表等）
 */
export function useVectorRebuild(onRebuildComplete) {
  const rebuilding = ref(false);
  const rebuildPhase = ref('');
  const rebuildFileName = ref('');
  const rebuildPercent = ref(0);
  const rebuildChunks = ref(0);
  const rebuildError = ref('');
  const vectorStatus = ref({ hasData: true, lawCount: 0, caseCount: 0, totalCount: 0 });
  const vectorStatusChecked = ref(false);

  const rebuildPhaseLabel = computed(() => {
    const labels = {
      clearing: '正在清空现有数据...',
      clearing_done: '清空完成',
      law_start: '准备导入法条数据...',
      law: '正在导入法条数据',
      law_done: '法条导入完成',
      case_start: '准备导入案例数据...',
      case: '正在导入案例数据',
      case_done: '案例导入完成',
      complete: '重建完成',
      error: '重建失败',
    };
    return labels[rebuildPhase.value] || rebuildPhase.value;
  });

  const checkVectorStatus = async () => {
    try {
      const response = await api.getVectorStatus();
      vectorStatus.value = response.data;
      vectorStatusChecked.value = true;
    } catch {
      vectorStatusChecked.value = true;
    }
  };

  const rebuildVectorDatabase = async () => {
    try {
      await ElMessageBox.confirm(
        '将清空所有现有向量数据并重新生成。此过程可能需要几分钟，确定继续？',
        '重建向量数据库',
        { confirmButtonText: '确认重建', cancelButtonText: '取消', type: 'warning' },
      );
    } catch {
      return;
    }
    rebuilding.value = true;
    rebuildPhase.value = 'clearing';
    rebuildFileName.value = '';
    rebuildPercent.value = 0;
    rebuildChunks.value = 0;
    rebuildError.value = '';
    try {
      const baseURL = apiClient.defaults.baseURL || '';
      const token = apiClient.defaults.headers?.Authorization || '';
      const response = await fetch(`${baseURL}/knowledge/rebuild`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: token } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            rebuildPhase.value = data.phase;
            if (data.phase === 'law' || data.phase === 'case') {
              rebuildFileName.value = data.fileName || '';
              rebuildChunks.value = data.chunks || 0;
              const totalItems = data.total || 1;
              const current = data.current || 0;
              if (data.phase === 'law') {
                rebuildPercent.value = Math.round(5 + (current / totalItems) * 70);
              } else {
                rebuildPercent.value = Math.round(75 + (current / totalItems) * 25);
              }
            } else if (data.phase === 'clearing') {
              rebuildPercent.value = 2;
              rebuildFileName.value = '';
            } else if (data.phase === 'clearing_done' || data.phase === 'law_start') {
              rebuildPercent.value = 5;
            } else if (data.phase === 'law_done' || data.phase === 'case_start') {
              rebuildPercent.value = 75;
              rebuildFileName.value = '';
            } else if (data.phase === 'case_done') {
              rebuildPercent.value = 100;
              rebuildFileName.value = '';
            } else if (data.phase === 'complete') {
              rebuildPercent.value = 100;
              rebuildPhase.value = 'complete';
              const lawChunks = data.law?.chunks || 0;
              const caseChunks = data.case?.chunks || 0;
              ElMessage.success(`重建完成：清除 ${data.cleared || 0} 条，法条 ${lawChunks} 切片，案例 ${caseChunks} 切片。`);
            } else if (data.phase === 'error') {
              rebuildError.value = data.message || '重建失败';
              ElMessage.error(data.message || '向量数据库重建失败。');
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }
      if (typeof onRebuildComplete === 'function') {
        await onRebuildComplete();
      }
      await checkVectorStatus();
    } catch (error) {
      rebuildError.value = error.message || '向量数据库重建失败。';
      ElMessage.error('向量数据库重建失败。');
    } finally {
      rebuilding.value = false;
    }
  };

  return {
    rebuilding,
    rebuildPhase,
    rebuildPhaseLabel,
    rebuildFileName,
    rebuildPercent,
    rebuildChunks,
    rebuildError,
    vectorStatus,
    vectorStatusChecked,
    checkVectorStatus,
    rebuildVectorDatabase,
  };
}

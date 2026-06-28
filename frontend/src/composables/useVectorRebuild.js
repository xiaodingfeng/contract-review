import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { apiClient } from '../api';
import { getUserId } from '../user';

/**
 * 向量数据库重建相关的状态与逻辑。
 *
 * 重建语义:仅根据 PostgreSQL 已有数据(vector_documents)全量同步到 Milvus,
 * 不删除/清空已有数据,不重新解析文件;与启动时后台同步操作一致。
 *
 * @param {Function} onRebuildComplete 重建完成后的回调（用于刷新知识列表等）
 */
export function useVectorRebuild(onRebuildComplete) {
  const rebuilding = ref(false);
  const rebuildPhase = ref('');
  const rebuildPercent = ref(0);
  const rebuildSynced = ref(0);
  const rebuildTotal = ref(0);
  const rebuildError = ref('');
  const vectorStatus = ref({ hasData: true, lawCount: 0, caseCount: 0, totalCount: 0 });
  const vectorStatusChecked = ref(false);

  const rebuildPhaseLabel = computed(() => {
    const labels = {
      sync_start: '准备同步...',
      sync: '正在同步 PostgreSQL 数据到向量数据库',
      complete: '同步完成',
      error: '同步失败',
    };
    return labels[rebuildPhase.value] || '';
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
    if (rebuilding.value) return;
    rebuilding.value = true;
    rebuildPhase.value = 'sync_start';
    rebuildPercent.value = 0;
    rebuildSynced.value = 0;
    rebuildTotal.value = 0;
    rebuildError.value = '';

    try {
      // axios 不支持 ReadableStream,改用原生 fetch 调用 SSE 接口
      const url = `${apiClient.defaults.baseURL}/knowledge/rebuild`;
      const headers = { 'Content-Type': 'application/json' };
      const userId = getUserId();
      if (userId) headers['X-User-ID'] = String(userId);
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let lastEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            lastEvent = event;
            rebuildPhase.value = event.phase;
            if (event.phase === 'sync') {
              rebuildSynced.value = event.current || 0;
              rebuildTotal.value = event.total || 0;
              rebuildPercent.value = event.total > 0
                ? Math.min(100, Math.round((event.current / event.total) * 100))
                : 0;
            } else if (event.phase === 'complete') {
              rebuildSynced.value = event.synced ?? rebuildSynced.value;
              rebuildTotal.value = event.total ?? rebuildTotal.value;
              rebuildPercent.value = 100;
              if (event.skipped) {
                ElMessage.warning(event.message || '向量数据库同步跳过');
              } else {
                ElMessage.success(event.message || '向量数据库重建完成');
              }
            } else if (event.phase === 'error') {
              rebuildError.value = event.message || '同步失败';
              ElMessage.error(rebuildError.value);
            }
          } catch (parseError) {
            // 忽略单行解析错误
          }
        }
      }

      // 兜底:流结束但未收到 complete 事件
      if (rebuildPhase.value !== 'complete' && rebuildPhase.value !== 'error') {
        if (lastEvent && lastEvent.phase === 'complete') {
          // 已处理
        } else if (!rebuildError.value) {
          rebuildPhase.value = 'complete';
          rebuildPercent.value = 100;
          ElMessage.success('向量数据库重建完成');
        }
      }
      await checkVectorStatus();
      if (onRebuildComplete) await onRebuildComplete();
    } catch (error) {
      rebuildError.value = error.response?.data?.error || error.message || '向量数据库重建失败';
      rebuildPhase.value = 'error';
      ElMessage.error(rebuildError.value);
    } finally {
      rebuilding.value = false;
    }
  };

  return {
    rebuilding,
    rebuildPhase,
    rebuildPhaseLabel,
    rebuildPercent,
    rebuildSynced,
    rebuildTotal,
    rebuildError,
    vectorStatus,
    vectorStatusChecked,
    checkVectorStatus,
    rebuildVectorDatabase,
  };
}

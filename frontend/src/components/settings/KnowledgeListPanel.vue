<template>
  <section class="panel list-panel">
    <!-- 向量数据库为空时的提示:后台正在异步导入,可手动点击重建同步 -->
    <div v-if="vectorStatusChecked && !vectorStatus.hasData && !rebuilding" class="vector-empty-banner">
      <div class="flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        <div>
          <p class="font-semibold text-sm">向量数据库尚未同步</p>
          <p class="text-xs text-gray-500">服务启动时会自动后台导入 PostgreSQL 数据并同步到向量数据库；如需立即同步可点击"重建向量数据库"。</p>
        </div>
      </div>
    </div>

    <!-- 重建进度面板 -->
    <div v-if="rebuilding" class="rebuild-progress-panel">
      <div class="flex items-center justify-between mb-2">
        <span class="font-semibold text-sm">{{ rebuildPhaseLabel }}</span>
        <span class="text-xs text-gray-500">{{ rebuildPercent }}%</span>
      </div>
      <el-progress :percentage="rebuildPercent" :stroke-width="8" :status="rebuildError ? 'exception' : ''" />
      <div v-if="rebuildTotal > 0" class="mt-2 text-xs text-gray-600">
        已同步 {{ rebuildSynced }} / {{ rebuildTotal }} 条向量数据
      </div>
      <div v-if="rebuildError" class="mt-2 text-xs text-red-500">{{ rebuildError }}</div>
    </div>

    <div class="panel-title">
      <div>
        <h2>知识列表</h2>
        <p>分页查看知识切片，用于定位和删除失效文档。</p>
      </div>
      <div class="flex gap-2">
        <button class="primary-button" @click="loadKnowledge">刷新</button>
        <button class="secondary-button" :disabled="rebuilding" @click="rebuildVectorDatabase">
          {{ rebuilding ? '重建中...' : '重建向量数据库' }}
        </button>
      </div>
    </div>

    <div class="toolbar">
      <el-input v-model="searchQuery" placeholder="搜索标题、条号、来源或正文" @keyup.enter="reloadFirstPage" />
      <el-select v-model="sourceType" placeholder="全部类型" clearable @change="reloadFirstPage">
        <el-option label="法律条文" value="law" />
        <el-option label="裁判文书" value="case" />
        <el-option label="审查规则" value="rule" />
        <el-option label="审查知识" value="guide" />
        <el-option label="行业标准条款" value="standard_clause" />
      </el-select>
      <el-select v-model="lawFilter" placeholder="法律时效" clearable @change="reloadFirstPage">
        <el-option label="现行有效" value="现行" />
        <el-option label="已修订" value="已修订" />
        <el-option label="已废止" value="已废止" />
      </el-select>
      <button class="secondary-button" @click="reloadFirstPage">查询</button>
      <button class="danger-button" :disabled="!sourceType" @click="deleteByType">删除当前类型</button>
    </div>

    <div class="knowledge-list">
      <p v-if="loading" class="muted">正在加载...</p>
      <p v-else-if="items.length === 0" class="muted">没有匹配的知识。</p>
      <article v-for="item in items" :key="item.id || item.source_id" class="knowledge-item">
        <header>
          <div>
            <h3 :title="item.title">{{ item.title }}</h3>
            <p :title="item.source_name || item.category || '未标注来源'">{{ item.source_name || item.category || '未标注来源' }}</p>
          </div>
          <div class="item-meta">
            <el-tag v-if="item.law_status && item.law_status !== '现行'" :type="lawStatusTagType(item.law_status)" size="small">{{ item.law_status }}</el-tag>
            <span :title="`${sourceLabel(item.source_type)}${item.clause_id ? ` / ${item.clause_id}` : ''}`">
              {{ sourceLabel(item.source_type) }}{{ item.clause_id ? ` / ${item.clause_id}` : '' }}
            </span>
          </div>
        </header>
        <p class="content" :title="item.content">{{ item.content }}</p>
        <footer>
          <small :title="item.source_id">{{ item.source_id }}</small>
          <div class="item-actions">
            <button class="text-button" @click="showKnowledgeDetail(item)">查看详情</button>
            <button class="text-danger" @click="deleteOne(item)">删除</button>
          </div>
        </footer>
      </article>
    </div>

    <div class="pager">
      <button :disabled="page === 1" @click="changePage(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
      <button :disabled="page === totalPages" @click="changePage(page + 1)">下一页</button>
    </div>

    <!-- 知识详情对话框 -->
    <el-dialog v-model="detailVisible" title="知识详情" width="min(760px, calc(100vw - 32px))" class="knowledge-detail-dialog" append-to-body>
      <div v-if="selectedKnowledgeDetail" class="detail-body">
        <div class="detail-grid">
          <div><label>标题</label><p>{{ selectedKnowledgeDetail.title || '-' }}</p></div>
          <div><label>类型</label><p>{{ sourceLabel(selectedKnowledgeDetail.source_type) }}</p></div>
          <div><label>条号</label><p>{{ selectedKnowledgeDetail.clause_id || '-' }}</p></div>
          <div><label>来源</label><p>{{ selectedKnowledgeDetail.source_name || selectedKnowledgeDetail.category || '-' }}</p></div>
        </div>
        <div class="detail-field">
          <label>Source ID</label>
          <p>{{ selectedKnowledgeDetail.source_id || '-' }}</p>
        </div>
        <div class="detail-field">
          <label>正文</label>
          <pre>{{ selectedKnowledgeDetail.content || '-' }}</pre>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { ElDialog, ElInput, ElMessage, ElMessageBox, ElOption, ElProgress, ElSelect, ElTag } from 'element-plus';
import api from '../../api';
import { sourceLabel, lawStatusTagType } from '../../composables/useSettingsShared';
import { useVectorRebuild } from '../../composables/useVectorRebuild';

export default {
  name: 'KnowledgeListPanel',
  components: { ElDialog, ElInput, ElOption, ElProgress, ElSelect, ElTag },
  setup() {
    const searchQuery = ref('');
    const sourceType = ref('');
    const lawFilter = ref('');
    const page = ref(1);
    const pageSize = ref(8);
    const total = ref(0);
    const items = ref([]);
    const loading = ref(false);
    const detailVisible = ref(false);
    const selectedKnowledgeDetail = ref(null);

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

    const loadKnowledge = async () => {
      loading.value = true;
      try {
        const response = await api.listKnowledge({
          page: page.value,
          pageSize: pageSize.value,
          q: searchQuery.value,
          type: sourceType.value,
          law_status: lawFilter.value,
        });
        items.value = response.data.items;
        total.value = response.data.total;
      } catch {
        ElMessage.error('知识库加载失败，请检查后端服务。');
      } finally {
        loading.value = false;
      }
    };

    const reloadFirstPage = async () => {
      page.value = 1;
      await loadKnowledge();
    };

    const changePage = async (nextPage) => {
      page.value = Math.min(totalPages.value, Math.max(1, nextPage));
      await loadKnowledge();
    };

    const showKnowledgeDetail = (item) => {
      selectedKnowledgeDetail.value = item;
      detailVisible.value = true;
    };

    const deleteOne = async (item) => {
      try {
        await ElMessageBox.confirm('删除后会影响后续审查和问答引用，确认删除？', '确认删除', { type: 'warning' });
        const response = item.id
          ? await api.deleteKnowledgeById(item.id)
          : await api.deleteKnowledge({ source_ids: [item.source_id] });
        ElMessage.success(`已删除 ${response.data.deleted} 条知识。`);
        await loadKnowledge();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    const deleteByType = async () => {
      try {
        await ElMessageBox.confirm(`确认删除所有"${sourceLabel(sourceType.value)}"？`, '按类型删除', { type: 'warning' });
        const response = await api.deleteKnowledge({ source_type: sourceType.value });
        ElMessage.success(`已删除 ${response.data.deleted} 条知识。`);
        await reloadFirstPage();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    // 重建向量数据库:仅根据 PostgreSQL 已有数据同步到 Milvus,不删除/清空已有数据,
    // 与启动时后台同步操作一致;重建完成后刷新知识列表。
    const {
      rebuilding, rebuildPhase, rebuildPhaseLabel, rebuildPercent,
      rebuildSynced, rebuildTotal, rebuildError,
      vectorStatus, vectorStatusChecked,
      checkVectorStatus, rebuildVectorDatabase,
    } = useVectorRebuild(loadKnowledge);

    onMounted(() => {
      loadKnowledge();
      checkVectorStatus();
    });

    return {
      searchQuery, sourceType, lawFilter,
      page, total, totalPages, items, loading,
      detailVisible, selectedKnowledgeDetail,
      rebuilding, rebuildPhase, rebuildPhaseLabel, rebuildPercent,
      rebuildSynced, rebuildTotal, rebuildError,
      vectorStatus, vectorStatusChecked,
      sourceLabel, lawStatusTagType,
      loadKnowledge, reloadFirstPage, changePage,
      rebuildVectorDatabase,
      showKnowledgeDetail, deleteOne, deleteByType,
    };
  },
};
</script>

<style scoped>
.panel {
  margin-top: 10px;
  border-radius: 3px;
  padding: 16px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px var(--za-line), 0 10px 28px rgba(23, 53, 51, .04);
}
.vector-empty-banner {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.rebuild-progress-panel {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}
.panel-title h2 {
  margin: 0;
  color: var(--za-ink);
  font-family: "Songti SC", "STSong", serif;
  font-size: 18px;
  letter-spacing: .04em;
}
.panel-title p,
.muted {
  margin: 4px 0 0;
  color: var(--za-muted);
  line-height: 1.45;
}
button {
  border: 0;
  border-radius: 3px;
  font-weight: 800;
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.primary-button,
.secondary-button,
.danger-button,
.pager button {
  min-height: 32px;
  padding: 0 10px;
  white-space: nowrap;
  font-size: 12px;
}
.primary-button {
  background: var(--za-teal);
  color: #ffffff;
}
.primary-button:hover { background: var(--za-teal-deep); }
.secondary-button,
.pager button {
  background: #ffffff;
  color: var(--za-teal-deep);
  box-shadow: inset 0 0 0 1px var(--za-line);
}
.danger-button {
  background: #ef4444;
  color: #ffffff;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--za-line);
  background: #f8faf7;
}
.toolbar .el-input { flex: 1; }
.toolbar .el-select { width: 150px; }
.knowledge-list {
  margin-top: 10px;
  display: grid;
  gap: 6px;
  min-width: 0;
}
.knowledge-item {
  position: relative;
  border-radius: 3px;
  padding: 11px 12px 10px 15px;
  background: #fbfcfa;
  box-shadow: inset 0 0 0 1px var(--za-line);
  min-width: 0;
  overflow: hidden;
}
.knowledge-item::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: linear-gradient(var(--za-teal), var(--za-gold));
}
.knowledge-item header,
.knowledge-item footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.knowledge-item header > div,
.knowledge-item footer > small {
  min-width: 0;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.knowledge-item h3 {
  margin: 0;
  color: var(--za-ink);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-item header p,
.knowledge-item small {
  margin: 3px 0 0;
  color: var(--za-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-item header span {
  flex-shrink: 0;
  max-width: 42%;
  border-radius: 2px;
  padding: 3px 7px;
  background: #ffffff;
  color: #80662d;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px #e7d8b6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content {
  display: -webkit-box;
  margin: 7px 0;
  line-height: 1.55;
  color: #465a57;
  max-width: 100%;
  white-space: normal;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}
.text-button,
.text-danger {
  background: transparent;
  padding: 0;
  font-size: 12px;
  line-height: 1.2;
}
.text-button {
  color: var(--za-teal-deep);
  position: relative;
}
.text-danger {
  color: #ef4444;
}
.text-button::after {
  content: "";
  position: absolute;
  right: -9px;
  top: 2px;
  width: 1px;
  height: 12px;
  background: #d4d4d4;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 7px;
  color: #666666;
  font-size: 12px;
}
.detail-body {
  display: grid;
  gap: 10px;
  color: #111111;
  font-size: 13px;
  max-width: 100%;
  overflow: hidden;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
}
.detail-body label {
  display: block;
  margin-bottom: 4px;
  color: #666666;
  font-size: 12px;
  font-weight: 800;
}
.detail-grid > div,
.detail-field {
  min-width: 0;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}
.detail-body p,
.detail-body pre {
  margin: 0;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
}
.detail-body pre {
  max-height: 340px;
  overflow: auto;
  font-family: inherit;
  border-radius: 8px;
  padding: 10px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #eeeeee;
}
@media (max-width: 780px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .toolbar .el-select {
    width: 100%;
  }
}
</style>

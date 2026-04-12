<template>
  <main class="settings-page">
    <section class="settings-head">
      <p class="eyebrow">知识库</p>
      <h1>管理审查依据</h1>
      <p>检索、导入和删除法律条文、裁判文书、审查规则。删除失效依据后，后续审查会使用新的知识库结果。</p>
    </section>

    <section class="panel list-panel">
      <div class="panel-title">
        <div>
          <h2>知识列表</h2>
          <p>分页查看知识切片，用于定位和删除失效文档。</p>
        </div>
        <button class="primary-button" @click="loadKnowledge">刷新</button>
      </div>

      <div class="toolbar">
        <el-input v-model="searchQuery" placeholder="搜索标题、条号、来源或正文" @keyup.enter="reloadFirstPage" />
        <el-select v-model="sourceType" placeholder="全部类型" clearable @change="reloadFirstPage">
          <el-option label="法律条文" value="law" />
          <el-option label="裁判文书" value="case" />
          <el-option label="审查规则" value="rule" />
          <el-option label="审查知识" value="guide" />
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
            <span :title="`${sourceLabel(item.source_type)}${item.clause_id ? ` / ${item.clause_id}` : ''}`">
              {{ sourceLabel(item.source_type) }}{{ item.clause_id ? ` / ${item.clause_id}` : '' }}
            </span>
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
    </section>

    <section class="panel retrieval-panel">
      <div class="panel-title">
        <div>
          <h2>知识检索模拟</h2>
          <p>模拟合同审查和智能问答使用知识库时的向量数据库检索、向量模型检索和重排序检索。</p>
        </div>
        <button class="primary-button" :disabled="retrievalLoading" @click="runKnowledgeRetrieval">
          {{ retrievalLoading ? '检索中...' : '模拟检索' }}
        </button>
      </div>

      <div class="retrieval-toolbar">
        <el-input v-model="retrievalQuery" placeholder="输入合同条款、审查问题或问答问题" @keyup.enter="runKnowledgeRetrieval" />
        <el-select v-model="retrievalScenario" placeholder="应用场景">
          <el-option label="合同审查" value="contract_review" />
          <el-option label="智能问答" value="qa" />
        </el-select>
        <el-select v-model="retrievalMode" placeholder="检索方式">
          <el-option label="向量数据库检索" value="vector_db" />
          <el-option label="向量模型检索" value="vector_model" />
          <el-option label="重排序检索" value="rerank" />
        </el-select>
        <el-select v-model="retrievalSourceType" placeholder="全部类型" clearable>
          <el-option label="法律条文" value="law" />
          <el-option label="裁判文书" value="case" />
          <el-option label="审查规则" value="rule" />
          <el-option label="审查知识" value="guide" />
        </el-select>
      </div>

      <div class="retrieval-summary">
        <span>{{ retrievalModeLabel }}</span>
        <span>{{ retrievalScenarioLabel }}</span>
        <span>Top {{ retrievalLimit }}</span>
      </div>

      <div class="knowledge-list retrieval-list">
        <p v-if="retrievalLoading" class="muted">正在模拟知识检索...</p>
        <p v-else-if="retrievalResults.length === 0" class="muted">输入检索内容后，可查看带相似度的知识命中结果。</p>
        <article v-for="item in retrievalResults" :key="`retrieval-${item.id || item.source_id}`" class="knowledge-item">
          <header>
            <div>
              <h3 :title="item.title">{{ item.title }}</h3>
              <p :title="item.source_name || item.category || '未标注来源'">{{ item.source_name || item.category || '未标注来源' }}</p>
            </div>
            <span :title="`${sourceLabel(item.source_type)}${item.clause_id ? ` / ${item.clause_id}` : ''}`">
              {{ sourceLabel(item.source_type) }}{{ item.clause_id ? ` / ${item.clause_id}` : '' }}
            </span>
          </header>
          <p class="content" :title="item.content">{{ item.content }}</p>
          <footer>
            <small :title="item.source_id">{{ item.source_id }}</small>
            <div class="retrieval-actions">
              <strong>相似度 {{ similarityPercent(item) }}</strong>
              <button class="text-button" @click="showKnowledgeDetail(item)">查看详情</button>
            </div>
          </footer>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>批量导入</h2>
          <p>支持 TXT、PDF、DOCX、Markdown。法律法规 Markdown 请按模板填写。</p>
        </div>
        <div class="template-actions">
          <button class="secondary-button" @click="downloadTemplate('law')">下载法律法规模板</button>
          <button class="secondary-button" @click="downloadTemplate('case')">下载裁判文书模板</button>
        </div>
      </div>

      <div class="batch-grid">
        <el-select v-model="batchSourceType" placeholder="来源类型">
          <el-option label="法律条文" value="law" />
          <el-option label="裁判文书" value="case" />
          <el-option label="审查规则" value="rule" />
          <el-option label="审查知识" value="guide" />
        </el-select>
        <el-input v-model="batchCategory" placeholder="分类，例如：劳动争议" />
        <el-input v-model="batchSourceUrl" placeholder="来源链接，可选" />
      </div>

      <el-upload
        class="upload-zone"
        drag
        multiple
        action=""
        :auto-upload="false"
        :on-change="handleBatchFileChange"
        :on-remove="handleBatchFileRemove"
      >
        <div class="upload-copy">拖拽文件到这里，或点击选择文件</div>
      </el-upload>

      <div class="batch-footer">
        <p>已选择 {{ batchFiles.length }} 个文件</p>
        <button class="primary-button" :disabled="batchImporting || batchFiles.length === 0" @click="batchImportKnowledge">
          {{ batchImporting ? '导入中...' : '批量导入并向量化' }}
        </button>
      </div>
      <div v-if="lastImportStats" class="stats">
        <span>文档 {{ lastImportStats.imported }}</span>
        <span>切片 {{ lastImportStats.chunks }}</span>
        <span>去重 {{ lastImportStats.deduped }}</span>
        <span>存储 {{ lastImportStats.vectorStore }}</span>
      </div>
    </section>

    <el-dialog v-model="detailVisible" title="知识详情" width="min(760px, calc(100vw - 32px))" class="knowledge-detail-dialog">
      <div v-if="selectedKnowledgeDetail" class="detail-body">
        <div class="detail-grid">
          <div>
            <label>标题</label>
            <p>{{ selectedKnowledgeDetail.title || '-' }}</p>
          </div>
          <div>
            <label>类型</label>
            <p>{{ sourceLabel(selectedKnowledgeDetail.source_type) }}</p>
          </div>
          <div>
            <label>条号</label>
            <p>{{ selectedKnowledgeDetail.clause_id || '-' }}</p>
          </div>
          <div>
            <label>来源</label>
            <p>{{ selectedKnowledgeDetail.source_name || selectedKnowledgeDetail.category || '-' }}</p>
          </div>
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
  </main>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { ElDialog, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElUpload } from 'element-plus';
import api from '../api';

export default {
  name: 'SettingsView',
  components: { ElDialog, ElInput, ElOption, ElSelect, ElUpload },
  setup() {
    const searchQuery = ref('');
    const sourceType = ref('');
    const page = ref(1);
    const pageSize = ref(8);
    const total = ref(0);
    const items = ref([]);
    const loading = ref(false);
    const batchFiles = ref([]);
    const batchSourceType = ref('law');
    const batchCategory = ref('');
    const batchSourceUrl = ref('');
    const batchImporting = ref(false);
    const lastImportStats = ref(null);
    const detailVisible = ref(false);
    const selectedKnowledgeDetail = ref(null);
    const retrievalQuery = ref('试用期最长可以约定多久？');
    const retrievalScenario = ref('contract_review');
    const retrievalMode = ref('vector_db');
    const retrievalSourceType = ref('');
    const retrievalLimit = ref(6);
    const retrievalResults = ref([]);
    const retrievalLoading = ref(false);

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
    const retrievalModeLabel = computed(() => ({
      vector_db: '向量数据库检索',
      vector_model: '向量模型检索',
      rerank: '重排序检索',
    }[retrievalMode.value]));
    const retrievalScenarioLabel = computed(() => ({
      contract_review: '合同审查知识检索',
      qa: '智能问答知识检索',
    }[retrievalScenario.value]));
    const sourceLabel = (type) => ({
      law: '法律条文',
      case: '裁判文书',
      rule: '审查规则',
      guide: '审查知识',
    }[type] || type || '知识');

    const loadKnowledge = async () => {
      loading.value = true;
      try {
        const response = await api.listKnowledge({
          page: page.value,
          pageSize: pageSize.value,
          q: searchQuery.value,
          type: sourceType.value,
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

    const normalizeScore = (score) => {
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore)) return 0;
      if (numericScore <= 1) return Math.max(0, numericScore);
      return numericScore / (numericScore + 1);
    };

    const similarityPercent = (item) => `${Math.round(normalizeScore(item.similarity ?? item.score) * 100)}%`;

    const tokenizeForMock = (text) => String(text || '')
      .toLowerCase()
      .match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) || [];

    const stableNoise = (value) => {
      const raw = String(value || '');
      let hash = 0;
      for (let index = 0; index < raw.length; index += 1) {
        hash = (hash * 31 + raw.charCodeAt(index)) % 1000;
      }
      return hash / 1000;
    };

    const scoreMockVectorModelResult = (item, query) => {
      const queryTokens = new Set(tokenizeForMock(query));
      const text = `${item.title || ''}${item.category || ''}${item.clause_id || ''}${item.source_name || ''}${item.content || ''}`;
      const textTokens = new Set(tokenizeForMock(text));
      const overlap = [...queryTokens].filter((token) => textTokens.has(token)).length;
      const overlapScore = queryTokens.size ? overlap / queryTokens.size : 0;
      const exactScore = text.includes(query) ? 0.18 : 0;
      const sourceBoost = retrievalScenario.value === 'contract_review' && ['law', 'rule'].includes(item.source_type) ? 0.08 : 0;
      const qaBoost = retrievalScenario.value === 'qa' && ['law', 'case', 'guide'].includes(item.source_type) ? 0.06 : 0;
      return Math.min(0.98, 0.45 + overlapScore * 0.34 + exactScore + sourceBoost + qaBoost + stableNoise(item.source_id) * 0.08);
    };

    const runMockVectorModelRetrieval = async (query) => {
      const response = await api.listKnowledge({
        page: 1,
        pageSize: 80,
        type: retrievalSourceType.value,
      });
      return (response.data.items || [])
        .map((item) => ({
          ...item,
          retrieval_engine: 'mock-vector-model',
          similarity: scoreMockVectorModelResult(item, query),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, retrievalLimit.value);
    };

    const runKnowledgeRetrieval = async () => {
      const query = retrievalQuery.value.trim();
      if (!query) {
        ElMessage.warning('请输入检索内容。');
        return;
      }
      retrievalLoading.value = true;
      try {
        if (retrievalMode.value === 'vector_model') {
          retrievalResults.value = await runMockVectorModelRetrieval(query);
          return;
        }
        const response = await api.searchKnowledge(query, {
          limit: retrievalMode.value === 'rerank' ? retrievalLimit.value : retrievalLimit.value * 2,
          types: retrievalSourceType.value,
          rerank: retrievalMode.value === 'rerank',
        });
        retrievalResults.value = (response.data || [])
          .slice(0, retrievalLimit.value)
          .map((item) => ({
            ...item,
            retrieval_engine: retrievalMode.value === 'rerank' ? 'vector-rerank' : 'vector-db',
            similarity: normalizeScore(item.score),
          }));
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '模拟检索失败，请检查后端服务。');
      } finally {
        retrievalLoading.value = false;
      }
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
        await ElMessageBox.confirm(`确认删除所有“${sourceLabel(sourceType.value)}”？`, '按类型删除', { type: 'warning' });
        const response = await api.deleteKnowledge({ source_type: sourceType.value });
        ElMessage.success(`已删除 ${response.data.deleted} 条知识。`);
        await reloadFirstPage();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    const downloadTemplate = async (type = 'law') => {
      try {
        const response = await api.downloadKnowledgeTemplate(type);
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = type === 'case' ? '裁判文书模版.json' : '法律法规模版.md';
        link.click();
        URL.revokeObjectURL(url);
      } catch {
        ElMessage.error('模板下载失败。');
      }
    };

    const handleBatchFileChange = (uploadFile, uploadFiles) => {
      batchFiles.value = uploadFiles.map((item) => item.raw).filter(Boolean);
    };

    const handleBatchFileRemove = (uploadFile, uploadFiles) => {
      batchFiles.value = uploadFiles.map((item) => item.raw).filter(Boolean);
    };

    const batchImportKnowledge = async () => {
      if (batchFiles.value.length === 0) return;
      batchImporting.value = true;
      try {
        const formData = new FormData();
        batchFiles.value.forEach((file) => formData.append('files', file));
        formData.append('source_type', batchSourceType.value);
        formData.append('category', batchCategory.value);
        formData.append('source_url', batchSourceUrl.value);
        const response = await api.batchImportKnowledge(formData);
        lastImportStats.value = response.data;
        ElMessage.success(`批量导入完成：${response.data.imported} 个文档，${response.data.chunks} 个切片。`);
        batchFiles.value = [];
        await reloadFirstPage();
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '批量导入失败。');
      } finally {
        batchImporting.value = false;
      }
    };

    onMounted(loadKnowledge);

    return {
      searchQuery,
      sourceType,
      page,
      total,
      totalPages,
      items,
      loading,
      batchFiles,
      batchSourceType,
      batchCategory,
      batchSourceUrl,
      batchImporting,
      lastImportStats,
      detailVisible,
      selectedKnowledgeDetail,
      retrievalQuery,
      retrievalScenario,
      retrievalMode,
      retrievalSourceType,
      retrievalLimit,
      retrievalResults,
      retrievalLoading,
      retrievalModeLabel,
      retrievalScenarioLabel,
      sourceLabel,
      similarityPercent,
      loadKnowledge,
      reloadFirstPage,
      changePage,
      showKnowledgeDetail,
      runKnowledgeRetrieval,
      deleteOne,
      deleteByType,
      downloadTemplate,
      handleBatchFileChange,
      handleBatchFileRemove,
      batchImportKnowledge,
    };
  },
};
</script>

<style scoped>
.settings-page {
  max-width: 1160px;
  margin: 0 auto;
  padding: 12px 16px 24px;
  color: #111111;
  font-size: 13px;
}

.settings-head {
  margin-bottom: 8px;
}

.eyebrow {
  margin: 0 0 4px;
  color: #666666;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.14;
  letter-spacing: 0;
}

.settings-head p:not(.eyebrow),
.panel-title p,
.batch-footer p,
.muted {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
}

.panel {
  margin-top: 8px;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04);
}

.panel-title,
.toolbar,
.batch-footer,
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}

.panel-title h2 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0;
}

.template-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar {
  margin-top: 8px;
}

.toolbar .el-input {
  flex: 1;
}

.toolbar .el-select {
  width: 150px;
}

.retrieval-toolbar {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px 170px 150px;
  gap: 9px;
}

.retrieval-summary {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.retrieval-summary span,
.retrieval-actions strong {
  border-radius: 999px;
  padding: 3px 7px;
  background: #f5f5f5;
  color: #111111;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.retrieval-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}

.retrieval-actions strong {
  font-weight: 800;
  white-space: nowrap;
}

button {
  border: 0;
  border-radius: 8px;
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
  background: #111111;
  color: #ffffff;
}

.secondary-button,
.pager button {
  background: #ffffff;
  color: #111111;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.danger-button {
  background: #ef4444;
  color: #ffffff;
}

.knowledge-list {
  margin-top: 8px;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.knowledge-item {
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  min-width: 0;
  overflow: hidden;
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

.knowledge-item h3 {
  margin: 0;
  font-size: 13px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-item header p,
.knowledge-item small {
  margin: 3px 0 0;
  color: #666666;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-item header span {
  flex-shrink: 0;
  max-width: 42%;
  border-radius: 999px;
  padding: 3px 7px;
  background: #ffffff;
  color: #111111;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content {
  margin: 5px 0;
  line-height: 1.45;
  color: #333333;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  color: #111111;
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
  justify-content: flex-end;
  margin-top: 7px;
  color: #666666;
  font-size: 12px;
}

.batch-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr);
  gap: 9px;
}

.upload-zone {
  margin-top: 8px;
}

.upload-copy {
  padding: 14px;
  color: #666666;
}

.stats {
  margin-top: 7px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stats span {
  border-radius: 8px;
  padding: 7px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
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
  .settings-page {
    padding: 14px;
  }

  .panel-title,
  .toolbar,
  .batch-footer,
  .knowledge-item header,
  .knowledge-item footer,
  .pager {
    flex-direction: column;
    align-items: stretch;
  }

  .item-actions {
    justify-content: flex-end;
  }

  .toolbar .el-select,
  .retrieval-toolbar,
  .batch-grid,
  .detail-grid {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .retrieval-actions {
    justify-content: flex-end;
  }

  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

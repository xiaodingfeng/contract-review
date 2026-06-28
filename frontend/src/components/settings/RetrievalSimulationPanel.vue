<template>
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

    <!-- 知识详情对话框 -->
    <el-dialog v-model="detailVisible" title="知识详情" width="min(760px, calc(100vw - 32px))" class="knowledge-detail-dialog" append-to-body>
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
  </section>
</template>

<script>
import { computed, ref } from 'vue';
import { ElDialog, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus';
import api from '../../api';
import { sourceLabel, similarityPercent, normalizeScore } from '../../composables/useSettingsShared';

export default {
  name: 'RetrievalSimulationPanel',
  components: { ElDialog, ElInput, ElOption, ElSelect },
  setup() {
    const retrievalQuery = ref('试用期最长可以约定多久？');
    const retrievalScenario = ref('contract_review');
    const retrievalMode = ref('vector_db');
    const retrievalSourceType = ref('');
    const retrievalLimit = ref(6);
    const retrievalResults = ref([]);
    const retrievalLoading = ref(false);
    const detailVisible = ref(false);
    const selectedKnowledgeDetail = ref(null);

    const retrievalModeLabel = computed(() => ({
      vector_db: '向量数据库检索',
      rerank: '重排序检索',
    }[retrievalMode.value]));

    const retrievalScenarioLabel = computed(() => ({
      contract_review: '合同审查知识检索',
      qa: '智能问答知识检索',
    }[retrievalScenario.value]));

    const showKnowledgeDetail = (item) => {
      selectedKnowledgeDetail.value = item;
      detailVisible.value = true;
    };

    // 两种检索方式统一走后端 /api/knowledge/search：
    // - vector_db：向量召回 + 关键词融合，rerank=false
    // - rerank：在向量召回之上再用 reranker 模型重排，rerank=true
    const runKnowledgeRetrieval = async () => {
      const query = retrievalQuery.value.trim();
      if (!query) {
        ElMessage.warning('请输入检索内容。');
        return;
      }
      retrievalLoading.value = true;
      try {
        const useRerank = retrievalMode.value === 'rerank';
        const response = await api.searchKnowledge(query, {
          limit: useRerank ? retrievalLimit.value : retrievalLimit.value * 2,
          types: retrievalSourceType.value,
          rerank: useRerank,
        });
        retrievalResults.value = (response.data || [])
          .slice(0, retrievalLimit.value)
          .map((item) => ({
            ...item,
            retrieval_engine: useRerank ? 'vector-rerank' : 'vector-embedding',
            similarity: normalizeScore(item.score),
          }));
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '模拟检索失败，请检查后端服务。');
      } finally {
        retrievalLoading.value = false;
      }
    };

    return {
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
      runKnowledgeRetrieval,
      showKnowledgeDetail,
      detailVisible,
      selectedKnowledgeDetail,
    };
  },
};
</script>

<style scoped>
.panel {
  margin-top: 8px;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04);
}

.panel-title {
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

.panel-title p,
.muted {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
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

.primary-button {
  min-height: 32px;
  padding: 0 10px;
  white-space: nowrap;
  font-size: 12px;
  background: #111111;
  color: #ffffff;
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

.text-button {
  background: transparent;
  padding: 0;
  font-size: 12px;
  line-height: 1.2;
  color: #111111;
  position: relative;
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
  .retrieval-toolbar {
    grid-template-columns: 1fr;
  }

  .retrieval-actions {
    justify-content: flex-end;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<template>
  <main class="home-page">
    <section class="hero-section">
      <img
        class="hero-image"
        src="https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1600&q=80"
        alt="合同审查工作台"
      />
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <p class="eyebrow">合同审查工作台</p>
        <h1>把合同风险看清楚，把修改意见落到文档里。</h1>
        <p class="hero-copy">上传合同后，按步骤确认范围、查看结论，并在同一页面完成修改建议采纳。</p>
        <button class="primary-button" @click="startNewReview">开始审查</button>
      </div>
    </section>

    <section class="content-grid">
      <div class="workflow-panel">
        <div class="section-head">
          <p class="eyebrow">审查步骤</p>
          <h2>四步完成审查</h2>
        </div>
        <div class="workflow-list">
          <article v-for="item in workflow" :key="item.title" class="workflow-item" :style="{ '--accent': item.color }">
            <span>{{ item.step }}</span>
            <div>
              <h3>{{ item.title }}</h3>
              <p>{{ item.copy }}</p>
            </div>
          </article>
        </div>
      </div>

      <div class="history-panel">
        <div class="section-head history-head">
          <div>
            <p class="eyebrow">审查记录</p>
            <h2>最近处理的合同</h2>
          </div>
          <button class="secondary-button" @click="fetchHistory">刷新</button>
        </div>

        <!-- 搜索与筛选 -->
        <div v-if="history.length > 0" class="history-filters">
          <input
            v-model="searchKeyword"
            class="history-search-input"
            type="text"
            placeholder="按文件名搜索..."
          />
          <select v-model="statusFilter" class="history-filter-select">
            <option value="">全部状态</option>
            <option value="Reviewed">已完成</option>
            <option value="Uploaded">已上传</option>
            <option value="PreAnalyzed">待确认</option>
          </select>
          <select v-model="typeFilter" class="history-filter-select">
            <option value="">全部类型</option>
            <option v-for="t in availableContractTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>

        <div v-if="loading" class="empty-block">正在加载审查记录...</div>
        <div v-else-if="error" class="empty-block danger">{{ error }}</div>
        <div v-else-if="history.length === 0" class="empty-block">
          <h3>暂无审查记录</h3>
          <p>开始审查后，记录会显示在这里。</p>
        </div>
        <div v-else-if="filteredHistory.length === 0" class="empty-block">
          <h3>未匹配到记录</h3>
          <p>请调整搜索关键词或筛选条件。</p>
        </div>
        <HistoryTable
          v-else
          :items="pagedHistory"
          :page="historyPage"
          :total-pages="totalHistoryPages"
          @view="viewReport"
          @delete="deleteReport"
          @update:page="historyPage = $event"
        />
      </div>
    </section>

    <GroupReportModal
      :visible="groupReportVisible"
      :loading="groupReportLoading"
      :report="groupReport"
      @close="closeGroupReport"
    />
  </main>
</template>

<script>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';
import GroupReportModal from '../components/GroupReportModal.vue';
import HistoryTable from '../components/HistoryTable.vue';
import { useHomeHistory, formatDate, statusText } from '../composables/useHomeHistory';

export default {
  name: 'HomeView',
  components: { GroupReportModal, HistoryTable },
  setup() {
    const router = useRouter();
    const groupReportVisible = ref(false);
    const groupReportLoading = ref(false);
    const groupReport = ref(null);

    const {
      history, loading, error, historyPage,
      searchKeyword, statusFilter, typeFilter,
      availableContractTypes, filteredHistory, totalHistoryPages, pagedHistory,
      fetchHistory, deleteReport,
    } = useHomeHistory();

    const viewReport = async (item) => {
      if (item.record_type !== 'group') {
        router.push({ path: '/review', query: { contract_id: item.id } });
        return;
      }
      groupReportVisible.value = true;
      groupReportLoading.value = true;
      groupReport.value = null;
      try {
        const response = await api.getContractGroup(item.id);
        groupReport.value = response.data;
      } catch (err) {
        ElMessage.error('加载关联合同分析报告失败。');
        groupReportVisible.value = false;
      } finally {
        groupReportLoading.value = false;
      }
    };

    const closeGroupReport = () => {
      groupReportVisible.value = false;
      groupReport.value = null;
    };

    const startNewReview = () => {
      localStorage.removeItem('review_session');
      router.push({ path: '/review' });
    };

    const workflow = [
      { step: '01', title: '上传合同', color: '#3b82f6', copy: '选择文件，进入在线预览。' },
      { step: '02', title: '确认范围', color: '#ec4899', copy: '确认立场、重点和目标。' },
      { step: '03', title: '查看结果', color: '#ef4444', copy: '集中查看风险和建议。' },
      { step: '04', title: '采纳修改', color: '#111111', copy: '把修改同步到文档。' },
    ];

    return {
      workflow,
      history, loading, error, historyPage,
      groupReportVisible, groupReportLoading, groupReport,
      totalHistoryPages, pagedHistory,
      fetchHistory, formatDate, statusText,
      viewReport, closeGroupReport, deleteReport, startNewReview,
      searchKeyword, statusFilter, typeFilter,
      availableContractTypes, filteredHistory,
    };
  },
};
</script>

<style scoped>
.home-page {
  height: calc(100vh - 56px);
  overflow: hidden;
  background: #ffffff;
  color: #111111;
  font-size: 13px;
}

.hero-section {
  position: relative;
  width: calc(100% - 36px);
  max-width: 1180px;
  height: 196px;
  margin: 12px auto 0;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.34), rgba(0, 0, 0, 0.04));
}

.hero-content {
  position: relative;
  z-index: 1;
  max-width: 760px;
  padding: 22px 28px;
  color: #ffffff;
}

.eyebrow {
  margin: 0 0 5px;
  color: inherit;
  opacity: 0.66;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

h1, h2, h3, p {
  letter-spacing: 0;
}

h1 {
  margin: 0;
  font-size: clamp(26px, 3.4vw, 40px);
  line-height: 1.08;
  font-weight: 850;
}

.hero-copy {
  max-width: 620px;
  margin: 8px 0 14px;
  color: rgba(255, 255, 255, 0.84);
  font-size: 14px;
  line-height: 1.55;
}

button {
  border: 0;
  border-radius: 8px;
  font-weight: 800;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.primary-button,
.secondary-button {
  min-height: 34px;
  padding: 0 13px;
}

.primary-button {
  background: #ffffff;
  color: #111111;
}

.secondary-button {
  background: #ffffff;
  color: #111111;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.content-grid {
  height: calc(100vh - 288px);
  max-width: 1180px;
  margin: 12px auto 0;
  padding: 0 18px 12px;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 12px;
}

.workflow-panel,
.history-panel {
  min-height: 0;
  border-radius: 8px;
  padding: 14px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04);
}

.section-head {
  margin-bottom: 10px;
}

.section-head h2 {
  margin: 0;
  font-size: 19px;
  line-height: 1.24;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
}

.workflow-list {
  display: grid;
  gap: 8px;
}

.workflow-item {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.workflow-item span {
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}

.workflow-item h3 {
  margin: 0 0 3px;
  font-size: 14px;
  line-height: 1.25;
}

.workflow-item p,
.empty-block {
  margin: 0;
  color: #666666;
  line-height: 1.45;
}

.empty-block {
  padding: 26px;
  text-align: center;
  background: #fafafa;
  border-radius: 8px;
}

.empty-block h3 {
  margin: 0 0 5px;
  color: #111111;
  font-size: 16px;
}

.empty-block.danger {
  color: #ef4444;
}

.history-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.history-search-input,
.history-filter-select {
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.history-search-input {
  flex: 1;
  min-width: 160px;
}

.history-search-input:focus,
.history-filter-select:focus {
  border-color: #3b82f6;
}

.history-filter-select {
  cursor: pointer;
}

@media (max-width: 900px) {
  .home-page {
    height: auto;
    overflow: visible;
  }

  .content-grid {
    height: auto;
    grid-template-columns: 1fr;
  }

  .hero-section {
    width: calc(100% - 28px);
  }
}
</style>

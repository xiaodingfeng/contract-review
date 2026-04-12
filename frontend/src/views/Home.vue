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

        <div v-if="loading" class="empty-block">正在加载审查记录...</div>
        <div v-else-if="error" class="empty-block danger">{{ error }}</div>
        <div v-else-if="history.length === 0" class="empty-block">
          <h3>暂无审查记录</h3>
          <p>开始审查后，记录会显示在这里。</p>
        </div>
        <div v-else class="table-wrap">
          <table class="record-table">
            <thead>
              <tr>
                <th>文件</th>
                <th>时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedHistory" :key="item.id">
                <td class="file-cell" :title="item.original_filename">{{ item.original_filename }}</td>
                <td>{{ formatDate(item.created_at) }}</td>
                <td><span :class="['status-pill', item.status]">{{ statusText(item.status) }}</span></td>
                <td>
                  <div class="row-actions">
                    <button class="text-button" @click="viewReport(item.id)">查看</button>
                    <el-popconfirm title="确认删除这份审查记录？" @confirm="deleteReport(item.id)">
                      <template #reference>
                        <button class="text-button danger">删除</button>
                      </template>
                    </el-popconfirm>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="pager">
            <button :disabled="historyPage === 1" @click="historyPage -= 1">上一页</button>
            <span>第 {{ historyPage }} / {{ totalHistoryPages }} 页</span>
            <button :disabled="historyPage === totalHistoryPages" @click="historyPage += 1">下一页</button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElPopconfirm } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';

export default {
  name: 'HomeView',
  components: { ElPopconfirm },
  setup() {
    const history = ref([]);
    const loading = ref(true);
    const error = ref(null);
    const historyPage = ref(1);
    const historyPageSize = 5;
    const router = useRouter();

    const workflow = [
      { step: '01', title: '上传合同', color: '#3b82f6', copy: '选择文件，进入在线预览。' },
      { step: '02', title: '确认范围', color: '#ec4899', copy: '确认立场、重点和目标。' },
      { step: '03', title: '查看结果', color: '#ef4444', copy: '集中查看风险和建议。' },
      { step: '04', title: '采纳修改', color: '#111111', copy: '把修改同步到文档。' },
    ];

    const totalHistoryPages = computed(() => Math.max(1, Math.ceil(history.value.length / historyPageSize)));
    const pagedHistory = computed(() => {
      const start = (historyPage.value - 1) * historyPageSize;
      return history.value.slice(start, start + historyPageSize);
    });

    const fetchHistory = async () => {
      loading.value = true;
      error.value = null;
      try {
        if (!getUserId()) {
          error.value = '无法获取用户身份，请刷新页面重试。';
          return;
        }
        const response = await api.getUserHistory(getUserId());
        history.value = response.data;
        historyPage.value = Math.min(historyPage.value, totalHistoryPages.value);
      } catch (err) {
        error.value = '加载审查记录失败，请稍后重试。';
        console.error(err);
      } finally {
        loading.value = false;
      }
    };

    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      return new Date(dateString).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const statusText = (status) => ({
      Reviewed: '已完成',
      Uploaded: '已上传',
      PreAnalyzed: '待确认',
    }[status] || status || '处理中');

    const viewReport = (contractId) => {
      router.push({ path: '/review', query: { contract_id: contractId } });
    };

    const deleteReport = async (contractId) => {
      try {
        await api.deleteContract(contractId);
        await fetchHistory();
      } catch {
        ElMessage.error('删除失败');
      }
    };

    const startNewReview = () => {
      localStorage.removeItem('review_session');
      router.push({ path: '/review' });
    };

    onMounted(fetchHistory);

    return {
      workflow,
      history,
      loading,
      error,
      historyPage,
      totalHistoryPages,
      pagedHistory,
      fetchHistory,
      formatDate,
      statusText,
      viewReport,
      deleteReport,
      startNewReview,
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

h1,
h2,
h3,
p {
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

.table-wrap {
  min-height: 0;
}

.record-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.record-table th,
.record-table td {
  height: 42px;
  padding: 8px 10px;
  border-bottom: 1px solid #eeeeee;
  text-align: left;
  vertical-align: middle;
  font-size: 12px;
}

.record-table th {
  color: #666666;
  font-weight: 800;
  background: #fafafa;
}

.record-table th:nth-child(1),
.record-table td:nth-child(1) {
  width: 44%;
}

.record-table th:nth-child(2),
.record-table td:nth-child(2) {
  width: 22%;
}

.record-table th:nth-child(3),
.record-table td:nth-child(3) {
  width: 14%;
}

.record-table th:nth-child(4),
.record-table td:nth-child(4) {
  width: 20%;
}

.file-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.status-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 4px 8px;
  background: #f5f5f5;
  color: #333333;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.status-pill.Reviewed {
  background: #dcfce7;
  color: #166534;
}

.status-pill.Uploaded,
.status-pill.PreAnalyzed {
  background: #dbeafe;
  color: #1d4ed8;
}

.row-actions,
.pager {
  display: flex;
  align-items: center;
  gap: 7px;
}

.text-button,
.pager button {
  background: #ffffff;
  color: #111111;
  padding: 6px 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.text-button.danger {
  color: #ef4444;
}

.pager {
  justify-content: flex-end;
  margin-top: 9px;
  color: #666666;
  font-size: 12px;
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

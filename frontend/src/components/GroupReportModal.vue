<template>
  <div v-if="visible" class="report-modal">
    <div class="report-modal__panel">
      <header class="report-modal__header">
        <div>
          <p class="eyebrow">多合同关联分析</p>
          <h2>{{ report?.name || '关联合同分析报告' }}</h2>
        </div>
        <button class="text-button" @click="$emit('close')">关闭</button>
      </header>
      <div v-if="loading" class="empty-block">正在加载分析报告...</div>
      <div v-else-if="report" class="group-report">
        <section>
          <h3>关联文件</h3>
          <div class="group-report__files">
            <span v-for="contract in report.contracts" :key="contract.id">{{ contract.original_filename }}</span>
          </div>
        </section>
        <section v-if="report.result?.summary">
          <h3>整体结论</h3>
          <p>{{ report.result.summary }}</p>
        </section>
        <section v-if="report.result?.conflicts?.length">
          <h3>条款冲突与矛盾</h3>
          <article v-for="(item, index) in report.result.conflicts" :key="'modal-conflict-' + index" class="group-report__item">
            <h4>{{ item.title || `冲突点 ${index + 1}` }}</h4>
            <p>{{ item.description }}</p>
            <p v-if="item.contract_refs?.length">涉及文件：{{ item.contract_refs.join('、') }}</p>
            <p v-if="item.suggestion">处理建议：{{ item.suggestion }}</p>
          </article>
        </section>
        <section v-if="report.result?.shared_risks?.length">
          <h3>跨合同共同风险</h3>
          <ul>
            <li v-for="(risk, index) in report.result.shared_risks" :key="'modal-risk-' + index">{{ risk }}</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'GroupReportModal',
  props: {
    visible: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    report: { type: Object, default: null },
  },
  emits: ['close'],
};
</script>

<style scoped>
.report-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.38);
  padding: 18px;
}

.report-modal__panel {
  width: min(860px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}

.report-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 12px;
}

.report-modal__header h2 {
  margin: 0;
  font-size: 20px;
}

.eyebrow {
  margin: 0 0 5px;
  opacity: 0.66;
  font-size: 11px;
  font-weight: 800;
}

.text-button {
  border: 0;
  border-radius: 8px;
  background: #ffffff;
  color: #111111;
  padding: 6px 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  font-weight: 800;
  cursor: pointer;
}

.empty-block {
  padding: 26px;
  text-align: center;
  background: #fafafa;
  border-radius: 8px;
  margin: 0;
  color: #666666;
  line-height: 1.45;
}

.group-report {
  display: grid;
  gap: 16px;
  padding-top: 14px;
}

.group-report h3 {
  margin: 0 0 8px;
  color: #111827;
  font-size: 15px;
}

.group-report h4 {
  margin: 0 0 6px;
  color: #111827;
  font-size: 13px;
}

.group-report p,
.group-report li {
  margin: 4px 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.group-report__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group-report__files span {
  border-radius: 8px;
  background: #f1f5f9;
  color: #334155;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 700;
}

.group-report__item {
  border-left: 3px solid #2563eb;
  border-radius: 6px;
  background: #f8fafc;
  padding: 10px 12px;
}
</style>

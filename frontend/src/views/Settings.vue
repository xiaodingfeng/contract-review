<template>
  <main class="settings-page">
    <section class="settings-head">
      <p class="eyebrow">KNOWLEDGE GOVERNANCE</p>
      <h1>管理审查依据</h1>
      <p>检索、导入和删除法律条文、裁判文书、审查规则。删除失效依据后，后续审查会使用新的知识库结果。</p>
      <div class="basis-map" aria-label="知识库类型">
        <span>合同范本</span><span>法律法规</span><span>司法案例</span><span>审查要点</span>
      </div>
    </section>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="知识库管理" name="knowledge">
        <KnowledgeListPanel ref="knowledgeListRef" />
        <RetrievalSimulationPanel />
        <BatchImportPanel @imported="handleImported" />
        <LawVersionPanel />
      </el-tab-pane>

      <el-tab-pane label="审查模板管理" name="review-templates">
        <ReviewTemplatesTab />
      </el-tab-pane>

      <el-tab-pane label="标准条款库" name="standard-clauses">
        <StandardClausesTab />
      </el-tab-pane>
    </el-tabs>
  </main>
</template>

<script>
import { ref } from 'vue';
import { ElTabPane, ElTabs } from 'element-plus';
import KnowledgeListPanel from '../components/settings/KnowledgeListPanel.vue';
import RetrievalSimulationPanel from '../components/settings/RetrievalSimulationPanel.vue';
import BatchImportPanel from '../components/settings/BatchImportPanel.vue';
import LawVersionPanel from '../components/settings/LawVersionPanel.vue';
import ReviewTemplatesTab from '../components/settings/ReviewTemplatesTab.vue';
import StandardClausesTab from '../components/settings/StandardClausesTab.vue';

export default {
  name: 'SettingsView',
  components: {
    ElTabPane,
    ElTabs,
    KnowledgeListPanel,
    RetrievalSimulationPanel,
    BatchImportPanel,
    LawVersionPanel,
    ReviewTemplatesTab,
    StandardClausesTab,
  },
  setup() {
    const activeTab = ref('knowledge');
    const knowledgeListRef = ref(null);

    // 批量导入完成后刷新知识列表
    const handleImported = () => {
      if (knowledgeListRef.value) {
        // 调用子组件暴露的 reloadFirstPage（通过 ref 访问 setup 返回的方法）
        knowledgeListRef.value.reloadFirstPage?.();
      }
    };

    return {
      activeTab,
      knowledgeListRef,
      handleImported,
    };
  },
};
</script>

<style scoped>
.settings-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 18px 18px 30px;
  color: var(--za-ink);
  font-size: 13px;
}

.settings-head {
  position: relative;
  margin-bottom: 12px;
  padding: 20px 22px 16px;
  border: 1px solid var(--za-line);
  border-top: 3px solid var(--za-teal);
  background: linear-gradient(105deg, #fff 0%, #fff 67%, #f4ead2 140%);
  box-shadow: 0 10px 30px rgba(23, 53, 51, .04);
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--za-gold-ink);
  font-family: Georgia, serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .18em;
}

h1 {
  margin: 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: 27px;
  line-height: 1.14;
  letter-spacing: .06em;
}

.settings-head p {
  margin: 4px 0 0;
  color: var(--za-muted);
  line-height: 1.45;
}

.basis-map {
  display: flex;
  gap: 7px;
  margin-top: 13px;
  flex-wrap: wrap;
}

.basis-map span {
  padding: 5px 9px;
  border: 1px solid #d7e7e3;
  color: var(--za-teal-deep);
  background: #f5faf8;
  font-size: 10px;
}

.basis-map span::before {
  content: '·';
  margin-right: 5px;
  color: var(--za-gold);
  font-weight: 900;
}

.settings-tabs {
  margin-top: 10px;
  padding: 0 4px;
}

.settings-tabs :deep(.el-tabs__item) {
  height: 44px;
  color: #516663;
  font-weight: 600;
}

.settings-tabs :deep(.el-tabs__item.is-active) {
  color: var(--za-teal);
}

.settings-tabs :deep(.el-tabs__active-bar) {
  height: 3px;
  background: var(--za-gold);
}

@media (max-width: 780px) {
  .settings-page {
    padding: 14px;
  }
}
</style>

<template>
  <main class="settings-page">
    <section class="settings-head">
      <p class="eyebrow">知识库</p>
      <h1>管理审查依据</h1>
      <p>检索、导入和删除法律条文、裁判文书、审查规则。删除失效依据后，后续审查会使用新的知识库结果。</p>
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

.settings-head p {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
}

.settings-tabs {
  margin-top: 8px;
}

@media (max-width: 780px) {
  .settings-page {
    padding: 14px;
  }
}
</style>

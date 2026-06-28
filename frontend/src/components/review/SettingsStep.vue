<template>
  <div class="confirm-step w-full max-w-5xl mx-auto py-8">
    <div v-if="preAnalysisData.contract_type">
      <div class="text-center mb-10">
        <p class="text-lg text-text-main">文件 <span class="font-semibold text-primary">{{ contract.original_filename }}</span> 已上传成功。</p>
        <div class="mt-2 flex items-center justify-center gap-2">
          <p class="text-md text-text-light">AI初步识别该合同为：</p>
          <el-input
            v-model="preAnalysisData.contract_type"
            class="contract-type-edit"
            size="small"
            style="width: 240px;"
            placeholder="可修改合同类型"
          />
        </div>
        <button @click="showContractPreview = !showContractPreview" class="mt-3 text-sm font-medium text-primary hover:text-primary-dark inline-flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform" :class="{ 'rotate-180': showContractPreview }" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          {{ showContractPreview ? '收起合同预览' : '查看合同预览' }}
          <span v-if="preAnalysisData.text_stats" class="text-xs text-text-light font-normal">（{{ preAnalysisData.text_stats.charCount }} 字）</span>
        </button>
        <div v-if="showContractPreview" class="mt-3 mx-auto max-w-3xl text-left bg-white border border-border-color rounded-lg p-4 max-h-60 overflow-y-auto">
          <p class="text-sm text-text-main leading-relaxed whitespace-pre-line">{{ contractPreviewText }}</p>
          <p v-if="preAnalysisData.text_stats && preAnalysisData.text_stats.charCount > 200" class="mt-2 pt-2 border-t border-border-color text-xs text-text-light text-center">仅展示前 200 字，完整内容将在审查后显示</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-lg font-semibold text-text-dark">1. 选择您的审查立场</h3>
          <p class="text-sm text-text-light mt-1">AI将基于您的立场进行侧重分析。</p>
          <div class="mt-4">
            <el-select v-model="perspective" placeholder="请选择您的立场" class="w-full" filterable allow-create>
              <el-option
                v-for="party in allPotentialParties"
                :key="party"
                :label="party"
                :value="party"
              ></el-option>
            </el-select>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow-md p-6 flex flex-col justify-between">
          <div>
            <h3 class="text-lg font-semibold text-text-dark">2. 确认审查范围</h3>
            <p class="text-sm text-text-light mt-1">默认已全选AI建议的审查点。</p>
            <div class="mt-4">
              <label class="block text-sm font-medium text-text-main mb-1">审查模板</label>
              <el-select v-model="selectedTemplateId" placeholder="选择审查模板" class="w-full" @change="handleTemplateChange">
                <el-option
                  v-for="template in reviewTemplates"
                  :key="template.id"
                  :label="template.name"
                  :value="template.id"
                />
              </el-select>
            </div>
          </div>
          <div class="mt-6 flex justify-end space-x-3">
            <button @click="goBackToUpload" class="px-4 py-2 text-sm font-medium text-text-main bg-white border border-border-color rounded-md hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary">
              重新上传
            </button>
            <button @click="startAnalysis" :disabled="!perspective" class="px-6 py-2 text-sm font-medium text-white bg-primary border border-transparent rounded-md shadow-sm hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed">
              开始分析
            </button>
          </div>
        </div>
      </div>

      <div class="review-options-panel bg-white rounded-lg shadow-md p-6 mt-8">
        <h3 class="text-lg font-semibold text-text-dark mb-4">审查点及核心目的</h3>
        <div class="mb-6">
          <h4 class="text-md font-medium text-text-dark mb-2">审查点选择 (可多选)</h4>
          <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group flex flex-wrap gap-3">
            <el-checkbox
              v-for="point in allSuggestedReviewPoints"
              :key="point"
              :label="point"
              :value="point"
              border
            ></el-checkbox>
          </el-checkbox-group>
        </div>
        <div>
          <h4 class="text-md font-medium text-text-dark mb-2">审查核心目的 (可自定义)</h4>
          <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row flex items-center mb-2">
            <el-autocomplete
              v-model="purpose.value"
              :fetch-suggestions="querySearchCorePurposes"
              placeholder="搜索或输入新目的"
              class="w-full"
              trigger-on-focus
            ></el-autocomplete>
            <button @click="removePurpose(index)" class="ml-2 text-gray-400 hover:text-danger">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          </div>
          <button @click="addPurpose" class="mt-2 text-sm font-medium text-primary hover:text-primary-dark flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            添加目的
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';
import { ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete } from 'element-plus';

export default {
  name: 'SettingsStep',
  components: { ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete },
  setup() {
    const review = inject('review');
    const {
      contract, preAnalysisData, perspective, showContractPreview,
      contractPreviewText, allPotentialParties, reviewTemplates,
      selectedTemplateId, selectedReviewPoints, allSuggestedReviewPoints,
      customPurposes, querySearchCorePurposes, goBackToUpload,
      startAnalysis, addPurpose, removePurpose, handleTemplateChange,
    } = review;

    return {
      contract, preAnalysisData, perspective, showContractPreview,
      contractPreviewText, allPotentialParties, reviewTemplates,
      selectedTemplateId, selectedReviewPoints, allSuggestedReviewPoints,
      customPurposes, querySearchCorePurposes, goBackToUpload,
      startAnalysis, addPurpose, removePurpose, handleTemplateChange,
    };
  },
};
</script>

<style scoped>
.confirm-step {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  padding-left: 8px;
  padding-right: 8px;
  padding-bottom: 28px !important;
}

.review-options-panel {
  overflow: visible;
}

.review-points-group {
  max-height: none;
  overflow: visible;
  align-items: flex-start;
}

.purpose-row {
  min-width: 0;
}

.purpose-row :deep(.el-autocomplete) {
  min-width: 0;
}
</style>

<template>
  <div class="flex-grow overflow-y-auto flex flex-col items-center py-8 px-4 text-center">
    <h1 class="text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">智能合同审查</h1>
    <p class="mt-3 text-base leading-7 text-text-light">上传您的合同文档，AI 将为您深度分析、识别风险、守护权益。</p>

    <div class="mt-10 w-full max-w-2xl">
      <el-upload
        class="upload-dragger"
        drag
        action=""
        :http-request="({ file }) => uploadAndGo(file)"
        :before-upload="handleBeforeUpload"
        :show-file-list="false"
      >
        <div class="flex flex-col items-center justify-center p-10">
          <svg class="mx-auto h-12 w-12 text-text-light" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <div class="mt-4 flex text-sm leading-6 text-gray-600">
            <span class="font-semibold text-primary">点击上传</span>
            <p class="pl-1">或将文件拖到此处</p>
          </div>
          <p class="text-xs leading-5 text-gray-500">支持 .docx 和 .pdf 格式（PDF 需为可复制的文字版，不支持扫描件）</p>
        </div>
      </el-upload>
    </div>

    <div class="linked-analysis-panel mt-8 w-full max-w-2xl text-left">
      <div>
        <p class="text-sm font-semibold text-primary">多合同关联分析</p>
        <h2 class="mt-1 text-xl font-semibold text-text-dark">同时审查主合同、附件和补充协议</h2>
        <p class="mt-2 text-sm text-text-light">选择至少 2 份 DOCX 或 PDF 文件，系统会识别条款冲突、重复约定、遗漏和前后矛盾。</p>
      </div>
      <div class="linked-analysis-panel__picker">
        <input
          ref="linkedFileInput"
          type="file"
          multiple
          accept=".docx,.pdf"
          @change="handleLinkedFilesChange"
          class="linked-analysis-panel__native-input"
        />
        <button type="button" class="linked-analysis-panel__file-button" @click="openLinkedFilePicker">
          选择关联合同文件
        </button>
        <span class="linked-analysis-panel__count">已选择 {{ linkedGroupFiles.length }} 份</span>
        <button
          @click="startLinkedContractAnalysis"
          :disabled="linkedAnalysisLoading || linkedGroupFiles.length < 2"
          class="linked-analysis-panel__button"
        >
          {{ linkedAnalysisLoading ? '正在分析关联合同...' : '开始多合同关联分析' }}
        </button>
      </div>
      <div v-if="linkedGroupFiles.length" class="linked-analysis-panel__files">
        <div
          v-for="(file, index) in linkedGroupFiles"
          :key="file.name + file.size + '-' + index"
          class="linked-analysis-panel__file-chip"
        >
          <span class="linked-analysis-panel__file-name" :title="file.name">{{ file.name }}</span>
          <button
            type="button"
            class="linked-analysis-panel__file-remove"
            :disabled="linkedAnalysisLoading"
            @click="removeLinkedFile(index)"
            aria-label="移除该文件"
          >×</button>
        </div>
      </div>
      <div v-if="linkedAnalysisProgress.length" class="linked-analysis-panel__progress">
        <div v-for="item in linkedAnalysisProgress" :key="item.key" class="linked-analysis-panel__progress-row">
          <span :class="['linked-analysis-panel__progress-dot', `linked-analysis-panel__progress-dot--${item.status}`]"></span>
          <div>
            <strong>{{ item.label }}</strong>
            <p>{{ item.message }}</p>
          </div>
        </div>
      </div>
      <div v-if="linkedAnalysisResult" class="linked-analysis-result">
        <h3>关联分析结果</h3>
        <p v-if="linkedAnalysisResult.summary" class="linked-analysis-result__summary">{{ linkedAnalysisResult.summary }}</p>
        <div v-if="linkedAnalysisResult.conflicts?.length" class="linked-analysis-result__section">
          <h4>条款冲突与矛盾</h4>
          <div v-for="(item, index) in linkedAnalysisResult.conflicts" :key="'conflict-' + index" class="linked-analysis-result__item">
            <strong>{{ item.title || `冲突点 ${index + 1}` }}</strong>
            <p>{{ item.description }}</p>
            <p v-if="item.contract_refs?.length">涉及文件：{{ item.contract_refs.join('、') }}</p>
            <p v-if="item.suggestion">处理建议：{{ item.suggestion }}</p>
          </div>
        </div>
        <div v-if="linkedAnalysisResult.shared_risks?.length" class="linked-analysis-result__section">
          <h4>跨合同共同风险</h4>
          <ul>
            <li v-for="(risk, index) in linkedAnalysisResult.shared_risks" :key="'shared-risk-' + index">{{ risk }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject, onMounted } from 'vue';
import { ElUpload } from 'element-plus';

export default {
  name: 'UploadStep',
  components: { ElUpload },
  setup() {
    const review = inject('review');
    const {
      uploadAndGo, handleBeforeUpload, linkedGroupFiles,
      linkedAnalysisLoading, linkedAnalysisResult, linkedAnalysisProgress,
      linkedFileInput, openLinkedFilePicker, handleLinkedFilesChange,
      removeLinkedFile, startLinkedContractAnalysis,
    } = review;

    return {
      uploadAndGo, handleBeforeUpload, linkedGroupFiles,
      linkedAnalysisLoading, linkedAnalysisResult, linkedAnalysisProgress,
      linkedFileInput, openLinkedFilePicker, handleLinkedFilesChange,
      removeLinkedFile, startLinkedContractAnalysis,
    };
  },
};
</script>

<style scoped>
.upload-dragger :deep(.el-upload-dragger) {
  @apply bg-bg-subtle border-2 border-dashed border-border-color rounded-lg transition-colors duration-200 ease-in-out;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 132px;
  width: 100%;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  @apply border-primary;
}
</style>

<style>
.linked-analysis-panel {
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  padding: 20px;
  margin-bottom: 32px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}
.linked-analysis-panel__picker {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}
.linked-analysis-panel__native-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.linked-analysis-panel__file-button {
  flex: 0 0 auto;
  border: 1px solid #2563eb;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.linked-analysis-panel__file-button:hover {
  background: #dbeafe;
  border-color: #1d4ed8;
}
.linked-analysis-panel__count {
  flex: 1;
  min-width: 0;
  color: #64748b;
  font-size: 12px;
}
.linked-analysis-panel__button {
  flex: 0 0 auto;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.2s ease, opacity 0.2s ease;
}
.linked-analysis-panel__button:hover:not(:disabled) {
  background: #1d4ed8;
}
.linked-analysis-panel__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.linked-analysis-panel__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.linked-analysis-panel__file-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: 8px;
  background: #e0f2fe;
  color: #075985;
  padding: 5px 6px 5px 10px;
  font-size: 11px;
  font-weight: 600;
}
.linked-analysis-panel__file-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.linked-analysis-panel__file-remove {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  line-height: 16px;
  text-align: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #075985;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.linked-analysis-panel__file-remove:hover:not(:disabled) {
  background: #075985;
  color: #fff;
}
.linked-analysis-panel__file-remove:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.linked-analysis-panel__progress {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}
.linked-analysis-panel__progress-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.linked-analysis-panel__progress-row strong {
  display: block;
  color: #111827;
  font-size: 12px;
}
.linked-analysis-panel__progress-row p {
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}
.linked-analysis-panel__progress-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  margin-top: 4px;
  border-radius: 999px;
  background: #94a3b8;
}
.linked-analysis-panel__progress-dot--running {
  background: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}
.linked-analysis-panel__progress-dot--done {
  background: #16a34a;
}
.linked-analysis-panel__progress-dot--failed {
  background: #dc2626;
}
.linked-analysis-result {
  margin-top: 16px;
  border-top: 1px solid #e5e7eb;
  padding-top: 14px;
}
.linked-analysis-result h3,
.linked-analysis-result h4 {
  color: #111827;
  font-weight: 700;
}
.linked-analysis-result h3 {
  font-size: 15px;
}
.linked-analysis-result h4 {
  margin-top: 12px;
  font-size: 13px;
}
.linked-analysis-result__summary {
  margin-top: 8px;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}
.linked-analysis-result__item {
  margin-top: 8px;
  border-left: 3px solid #2563eb;
  background: #fff;
  padding: 10px 12px;
  border-radius: 6px;
}
.linked-analysis-result__item p,
.linked-analysis-result li {
  margin-top: 4px;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
}
.linked-analysis-result ul {
  margin-top: 6px;
  padding-left: 18px;
}
@media (max-width: 640px) {
  .linked-analysis-panel__picker {
    align-items: stretch;
    flex-direction: column;
  }
  .linked-analysis-panel__button {
    width: 100%;
  }
}
</style>

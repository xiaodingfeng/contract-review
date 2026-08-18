<template>
  <div class="flex-grow min-h-0 flex gap-4">
    <!-- Left Side: OnlyOffice Editor -->
    <div class="basis-0 flex-[3] min-w-0 bg-white rounded-lg shadow-md overflow-hidden h-full flex flex-col">
      <div class="px-3 py-2 border-b border-border-color bg-bg-subtle flex items-center justify-between gap-3">
        <div class="text-sm text-text-main">
          左侧为合同实时预览与编辑区。可选中文本后进行专项审查。
        </div>
        <button @click="prepareFocusedReviewFromSelection" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">
          读取选中文本审查
        </button>
      </div>
      <DocumentEditor
        v-if="contract.editorConfig"
        id="docEditorComponent"
        ref="docEditorComponent"
        class="flex-grow min-h-0"
        :documentServerUrl="onlyOfficeUrl"
        :config="contract.editorConfig"
        :events_onDocumentReady="onDocumentReady"
        :events_onDocumentStateChange="onDocumentStateChange"
      />
      <div v-if="selectedSuggestionPreview" class="border-t border-border-color bg-white p-3 max-h-44 overflow-y-auto">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-text-dark">最近采纳预览</p>
          <span class="text-xs text-green-700">{{ selectedSuggestionPreview.status }}</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p class="text-gray-500 font-medium">采纳前原文</p>
            <p class="mt-1 p-2 bg-red-50 text-red-800 border border-red-100 rounded whitespace-pre-line">{{ selectedSuggestionPreview.before }}</p>
          </div>
          <div>
            <p class="text-gray-500 font-medium">采纳后文本</p>
            <p class="mt-1 p-2 bg-green-50 text-green-800 border border-green-100 rounded whitespace-pre-line">{{ selectedSuggestionPreview.after }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Side: AI Review Panel -->
    <div class="basis-0 flex-[2] min-w-0 bg-white rounded-lg shadow-md flex flex-col h-full">
      <!-- Panel Header -->
      <div class="p-3 border-b border-border-color flex flex-col gap-3 flex-shrink-0">
        <div class="flex items-center">
          <h3 class="text-lg font-semibold text-text-dark">AI 审查报告</h3>
          <div class="ml-4 flex items-center">
            <span class="text-xs text-text-light mr-1">大白话模式</span>
            <el-switch v-model="showPlainLanguage" size="small"></el-switch>
          </div>
        </div>
        <div class="flex items-center flex-wrap gap-x-3 gap-y-2">
          <button @click="exportReport('html')" class="text-sm font-medium text-primary hover:text-primary-dark whitespace-nowrap">导出HTML</button>
          <button @click="exportReport('word')" class="text-sm font-medium text-primary hover:text-primary-dark whitespace-nowrap">导出Word</button>
          <button @click="downloadPdfAnnotations" class="text-sm font-medium text-primary hover:text-primary-dark whitespace-nowrap">PDF批注</button>
          <template v-if="cameFromHistory">
            <button @click="goBackToUpload" class="text-sm font-medium text-primary hover:text-primary-dark">重新上传</button>
            <button @click="goBackSmart" class="text-sm font-medium text-primary hover:text-primary-dark">返回历史</button>
          </template>
          <template v-else>
            <button @click="goBackSmart" class="text-sm font-medium text-primary hover:text-primary-dark">返回上一步</button>
          </template>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="px-4 border-b border-border-color flex-shrink-0">
        <nav class="-mb-px grid grid-cols-4 gap-2">
          <button @click="activeAiTab = 'summary'" :class="[activeAiTab === 'summary' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">总览</button>
          <button @click="activeAiTab = 'suggestions'" :class="[activeAiTab === 'suggestions' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">修改</button>
          <button @click="activeAiTab = 'knowledge'" :class="[activeAiTab === 'knowledge' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">依据</button>
          <button @click="activeAiTab = 'workspace'" :class="[activeAiTab === 'workspace' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">工作台</button>
        </nav>
      </div>

      <!-- Tab Content -->
      <div class="p-3 overflow-y-auto flex-grow">
        <ZhongAnReviewReport v-if="activeAiTab === 'summary'" />
        <ReviewSuggestionsTab v-if="activeAiTab === 'suggestions'" />
        <!-- Relevant Laws (Knowledge tab) -->
        <div v-if="activeAiTab === 'knowledge'">
          <div v-if="reviewData.relevant_laws && reviewData.relevant_laws.length > 0" class="space-y-4">
            <div v-for="(item, index) in reviewData.relevant_laws" :key="'law-' + index" :class="['p-4 rounded-md border', isLawOutdated(item) ? 'bg-red-50 border-red-200 border-l-4 border-l-red-500' : 'bg-blue-50 border-blue-100']">
              <div class="flex justify-between gap-3">
                <p class="font-bold text-blue-900">【{{ item.law }}】{{ item.clause }}</p>
                <el-tag v-if="isLawOutdated(item)" type="danger" size="small">{{ item.law_status === '已废止' ? '已废止' : '已修订' }}</el-tag>
                <el-tag v-else type="success" size="small">现行</el-tag>
              </div>
              <p class="mt-2 text-sm text-blue-900 leading-6">{{ item.content }}</p>
              <p v-if="isLawOutdated(item)" class="mt-2 text-xs text-red-700">{{ item.updateNotice || '该条文已被修订，仅作历史参考' }}</p>
            </div>
          </div>
          <div v-else class="text-center text-text-light py-8">未命中相关法条</div>
        </div>
        <ReviewWorkspaceTab v-if="activeAiTab === 'workspace'" />
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';
import { ElSwitch, ElTag } from 'element-plus';
import { DocumentEditor } from '@onlyoffice/document-editor-vue';
import ZhongAnReviewReport from './ZhongAnReviewReport.vue';
import ReviewSuggestionsTab from './ReviewSuggestionsTab.vue';
import ReviewWorkspaceTab from './ReviewWorkspaceTab.vue';

export default {
  name: 'ReviewStep',
  components: {
    DocumentEditor, ElSwitch, ElTag,
    ZhongAnReviewReport, ReviewSuggestionsTab, ReviewWorkspaceTab,
  },
  setup() {
    const review = inject('review');
    const {
      contract, onlyOfficeUrl, onDocumentReady, onDocumentStateChange,
      docEditorComponent, selectedSuggestionPreview,
      prepareFocusedReviewFromSelection,
      showPlainLanguage, exportReport, downloadPdfAnnotations,
      cameFromHistory, goBackToUpload, goBackSmart,
      activeAiTab, reviewData, isLawOutdated,
    } = review;

    return {
      contract, onlyOfficeUrl, onDocumentReady, onDocumentStateChange,
      docEditorComponent, selectedSuggestionPreview,
      prepareFocusedReviewFromSelection,
      showPlainLanguage, exportReport, downloadPdfAnnotations,
      cameFromHistory, goBackToUpload, goBackSmart,
      activeAiTab, reviewData, isLawOutdated,
    };
  },
};
</script>

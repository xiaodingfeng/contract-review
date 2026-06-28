<template>
  <div>
    <div v-if="reviewData.modification_suggestions && reviewData.modification_suggestions.length > 0" class="mb-3 flex items-center justify-between gap-2">
      <el-checkbox-group v-model="selectedSuggestionIndexes" class="flex flex-wrap gap-2">
        <el-checkbox
          v-for="(item, index) in reviewData.modification_suggestions"
          :key="'select-ms-' + index"
          :label="index"
          border
        >{{ index + 1 }}</el-checkbox>
      </el-checkbox-group>
      <div class="flex items-center gap-2">
        <span v-if="isPdfContract" class="text-xs text-amber-600">PDF 不支持采纳</span>
        <button @click="applySelectedSuggestions" :disabled="batchApplying || isPdfContract || selectedSuggestionIndexes.length === 0" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
          {{ batchApplying ? '批量采纳中...' : '一键采纳所选' }}
        </button>
      </div>
    </div>
    <div v-if="reviewData.modification_suggestions && reviewData.modification_suggestions.length > 0" class="space-y-4">
      <div v-for="(item, index) in reviewData.modification_suggestions" :key="'ms-' + index" class="p-4 bg-bg-subtle rounded-md border border-border-color transition-all hover:shadow-md">
        <div class="flex justify-between items-start">
          <p class="font-semibold text-text-dark pr-2">{{ suggestionTitle(item, index) }}</p>
          <div class="flex space-x-1 flex-shrink-0">
            <el-tooltip content="在文档中定位" placement="top">
              <button @click="locateText(suggestionOriginal(item))" class="p-1 text-gray-400 hover:text-primary transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </button>
            </el-tooltip>
            <el-tooltip content="添加批注" placement="top">
              <button @click="addDocComment(suggestionOriginal(item), suggestionReason(item))" class="p-1 text-gray-400 hover:text-primary transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
              </button>
            </el-tooltip>
          </div>
        </div>

        <div v-if="showPlainLanguage" class="mt-3 p-3 bg-green-50 text-green-800 rounded-md border-l-4 border-green-400">
          <p class="text-xs font-bold mb-1">📢 大白话建议：</p>
          <p class="text-sm">{{ item.plain_language || suggestionReason(item) }}</p>
        </div>

        <div v-else class="space-y-3 mt-3">
          <div class="text-xs">
            <p class="text-gray-500 font-medium">原文：</p>
            <blockquote class="mt-1 p-2 bg-red-50 text-red-800 border-l-4 border-red-400 break-all">
              {{ suggestionOriginal(item) || 'AI 未返回可直接定位的原文，请参考建议条款手动核对。' }}
            </blockquote>
          </div>
          <div class="text-xs">
            <p class="text-gray-500 font-medium">建议：</p>
            <blockquote
              :title="item.adopted ? `采纳前原文：${item.adopted_original || suggestionOriginal(item)}` : ''"
              :class="[
                'mt-1 p-2 text-green-800 border-l-4 border-green-400 break-all',
                item.adopted ? 'adopted-suggestion-text' : 'bg-green-50'
              ]"
            >
              {{ suggestionText(item) }}
            </blockquote>
          </div>
          <div class="text-xs">
            <p class="text-gray-500 font-medium">理由：</p>
            <p class="mt-1 text-text-main">{{ suggestionReason(item) }}</p>
          </div>
          <div v-if="item.citations && item.citations.length" class="text-xs">
            <p class="text-gray-500 font-medium">法律依据：</p>
            <div v-for="(cite, cIndex) in item.citations" :key="'cite-' + index + '-' + cIndex" class="mt-1 p-2 bg-blue-50 border-l-4 border-blue-300 rounded">
              <p class="font-medium text-blue-800">【{{ cite.source_type || '依据' }}】{{ cite.title || '' }}{{ cite.clause ? ' ' + cite.clause : '' }}</p>
              <p v-if="cite.content" class="mt-0.5 text-blue-700">{{ cite.content }}</p>
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-gray-100 flex justify-end items-center">
          <span v-if="isPdfContract" class="mr-2 text-xs text-amber-600">PDF 文件不支持原文改写，请使用审查报告导出或 PDF 批注</span>
          <button
            @click="toggleNegotiation(item)"
            :disabled="item._negotiationLoading"
            :class="[
              'mr-2 px-3 py-1.5 text-xs font-medium border rounded transition-colors flex items-center disabled:opacity-50',
              item._negotiation
                ? 'text-green-700 bg-green-50 border-green-300 hover:bg-green-100'
                : 'text-purple-700 bg-purple-50 border-purple-300 hover:bg-purple-100'
            ]"
            :title="item._negotiation ? '已推演过,点击查看或收起' : '点击进行谈判推演'"
          >
            <svg v-if="item._negotiationLoading" class="animate-spin h-3.5 w-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <svg v-else-if="item._negotiation" class="h-3.5 w-3.5 mr-1 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            {{ item._negotiationLoading ? '推演中...' : (item._showNegotiation ? '收起推演' : (item._negotiation ? '已推演·查看' : '谈判推演')) }}
          </button>
          <button @click="previewSuggestion(item)" class="mr-2 px-3 py-1.5 text-xs font-medium text-primary bg-white border border-primary rounded hover:bg-primary-light transition-colors">
            查看变更
          </button>
          <button @click="adoptSuggestion(item)" :disabled="isPdfContract || item.adopted" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            {{ item.adopted ? '已采纳' : '一键采纳建议' }}
          </button>
        </div>
        <!-- 4.1 谈判推演面板 -->
        <div v-if="item._showNegotiation && item._negotiation" class="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-md space-y-3">
          <div class="flex items-center gap-2 text-xs text-purple-800 font-semibold">
            <span>对方立场:{{ item._negotiation.counterparty_perspective }}</span>
          </div>
          <!-- 对方反驳 -->
          <div>
            <p class="text-xs font-bold text-red-700 mb-1">对方可能反驳:</p>
            <div v-for="(obj, oi) in item._negotiation.likely_objections" :key="'obj-' + oi" class="text-xs mb-1 p-2 bg-white border border-red-100 rounded">
              <p class="text-text-main">{{ obj.reason }}</p>
              <p v-if="obj.legal_basis && obj.legal_basis !== '无明确依据'" class="mt-0.5 text-gray-600">依据:{{ obj.legal_basis }}</p>
              <p v-if="obj.business_concern" class="mt-0.5 text-gray-600">顾虑:{{ obj.business_concern }}</p>
            </div>
          </div>
          <!-- 折中方案 -->
          <div>
            <p class="text-xs font-bold text-amber-700 mb-1">折中方案:</p>
            <div v-for="(opt, oi) in item._negotiation.fallback_options" :key="'opt-' + oi" class="text-xs mb-2 p-2 bg-white border border-amber-100 rounded">
              <p class="text-text-main font-medium">{{ opt.text }}</p>
              <p class="mt-1 text-gray-600">让步:{{ opt.tradeoff }}</p>
              <p class="mt-0.5 text-gray-600">风险变化:{{ opt.risk_change }}</p>
              <button
                @click="adoptFallbackOption(item, opt)"
                class="mt-1 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200"
              >采纳此折中方案</button>
            </div>
          </div>
          <!-- 谈判话术 -->
          <div>
            <p class="text-xs font-bold text-blue-700 mb-1">谈判话术:</p>
            <p class="text-xs text-text-main leading-relaxed p-2 bg-white border border-blue-100 rounded whitespace-pre-line">{{ item._negotiation.negotiation_talktrack }}</p>
          </div>
        </div>
        <div v-else-if="item._showNegotiation && item._negotiationError" class="mt-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          谈判推演失败:{{ item._negotiationError }}
        </div>
      </div>
    </div>
    <div v-else class="text-center text-text-light py-8">未发现修改建议</div>
  </div>
</template>

<script>
import { inject } from 'vue';
import { ElCheckboxGroup, ElCheckbox, ElTooltip } from 'element-plus';

export default {
  name: 'ReviewSuggestionsTab',
  components: { ElCheckboxGroup, ElCheckbox, ElTooltip },
  setup() {
    const review = inject('review');
    const {
      reviewData, showPlainLanguage, isPdfContract,
      selectedSuggestionIndexes, batchApplying,
      suggestionTitle, suggestionOriginal, suggestionText, suggestionReason,
      locateText, addDocComment, previewSuggestion, adoptSuggestion,
      applySelectedSuggestions, toggleNegotiation, adoptFallbackOption,
    } = review;
    return {
      reviewData, showPlainLanguage, isPdfContract,
      selectedSuggestionIndexes, batchApplying,
      suggestionTitle, suggestionOriginal, suggestionText, suggestionReason,
      locateText, addDocComment, previewSuggestion, adoptSuggestion,
      applySelectedSuggestions, toggleNegotiation, adoptFallbackOption,
    };
  },
};
</script>

<style scoped>
.adopted-suggestion-text {
  background: #fef3c7 !important;
  border-color: #f59e0b !important;
  color: #166534 !important;
  box-shadow: inset 0 0 0 1px #facc15;
  cursor: help;
}
</style>

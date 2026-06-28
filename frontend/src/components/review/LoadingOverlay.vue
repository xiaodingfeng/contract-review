<template>
  <div v-if="loading && activeStep < 2" class="fixed inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-50">
    <div class="flex flex-col items-center max-w-lg bg-white border border-border-color rounded-md p-6 shadow-sm w-full mx-4">
      <div class="flex items-center justify-between w-full mb-3">
        <p class="text-lg font-semibold text-text-dark">{{ loadingMessage }}</p>
        <span v-if="analysisPercent > 0" class="text-2xl font-bold text-primary">{{ analysisPercent }}%</span>
      </div>

      <!-- 进度条 -->
      <div v-if="analysisActive" class="w-full mb-3">
        <div class="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
          <div class="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out" :style="{ width: analysisPercent + '%' }"></div>
        </div>
        <div class="flex justify-between text-xs text-text-light mt-1">
          <span>已用时：{{ formatDuration(analysisElapsed) }}</span>
          <span v-if="analysisEta > 0">预计剩余：{{ formatDuration(analysisEta) }}</span>
          <span v-else-if="analysisActive">预计剩余：即将完成...</span>
        </div>
        <div v-if="clauseProgress.total > 0" class="text-xs text-blue-600 mt-1">
          已审查 {{ clauseProgress.reviewed }}/{{ clauseProgress.total }} 条款<span v-if="clauseProgress.current_clause_id">（当前：{{ clauseProgress.current_clause_id }}）</span>
        </div>
      </div>

      <!-- 步骤列表 -->
      <div v-if="analysisSteps.length" class="analysis-progress mt-2 w-full">
        <div
          v-for="(step, index) in analysisSteps"
          :key="'step-' + index"
          class="analysis-progress__item"
          :class="[
            `analysis-progress__item--${progressStatusClass(step.status)}`,
          ]"
        >
          <div class="analysis-progress__marker">
            <span v-if="step.status === 'completed'">✓</span>
            <span v-else-if="step.status === 'failed'">!</span>
            <span v-else-if="step.status === 'running'" class="analysis-progress__spinner"></span>
            <span v-else>{{ index + 1 }}</span>
          </div>
          <div class="analysis-progress__content">
            <div class="analysis-progress__title">
              <span>{{ step.label }}</span>
              <span class="analysis-progress__status">{{ progressStatusLabel(step.status) }}</span>
            </div>
            <p v-if="step.message" class="analysis-progress__message">{{ step.message }}</p>
          </div>
        </div>
      </div>
      <!-- 兼容旧版进度事件（无 steps 结构时） -->
      <div v-else-if="analysisProgress.length" class="analysis-progress mt-4 w-full">
        <div
          v-for="(item, index) in visibleAnalysisProgress"
          :key="'progress-' + index"
          class="analysis-progress__item"
          :class="[
            `analysis-progress__item--${progressStatusClass(item.status)}`,
            index === visibleAnalysisProgress.length - 1 ? 'analysis-progress__item--current' : ''
          ]"
        >
          <div class="analysis-progress__marker">
            <span v-if="item.status === 'completed'">✓</span>
            <span v-else-if="item.status === 'failed'">!</span>
          </div>
          <div class="analysis-progress__content">
            <div class="analysis-progress__title">
              <span>{{ progressStepLabel(item.step) }}</span>
              <span class="analysis-progress__status">{{ progressStatusLabel(item.status) }}</span>
            </div>
            <p v-if="item.message" class="analysis-progress__message">{{ item.message }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';

export default {
  name: 'LoadingOverlay',
  setup() {
    const review = inject('review');
    const {
      loading, activeStep, loadingMessage,
      analysisActive, analysisPercent, analysisElapsed, analysisEta,
      formatDuration, clauseProgress,
      analysisSteps, progressStatusClass, progressStatusLabel,
      analysisProgress, visibleAnalysisProgress, progressStepLabel,
    } = review;
    return {
      loading, activeStep, loadingMessage,
      analysisActive, analysisPercent, analysisElapsed, analysisEta,
      formatDuration, clauseProgress,
      analysisSteps, progressStatusClass, progressStatusLabel,
      analysisProgress, visibleAnalysisProgress, progressStepLabel,
    };
  },
};
</script>

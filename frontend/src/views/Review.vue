<template>
  <div class="review-page w-full h-full flex flex-col">
    <StepHeader v-if="activeStep !== 2" :activeStep="activeStep" />
    <UploadStep v-if="activeStep === 0" />
    <SettingsStep v-if="activeStep === 1" />
    <ReviewStep v-if="activeStep === 2" />
    <LoadingOverlay />
    <SessionRetryMask />
    <QaChatWidget />
  </div>
</template>

<script>
import { ref, watch, onMounted, onUnmounted, provide } from 'vue';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import StepHeader from '../components/review/StepHeader.vue';
import UploadStep from '../components/review/UploadStep.vue';
import SettingsStep from '../components/review/SettingsStep.vue';
import ReviewStep from '../components/review/ReviewStep.vue';
import LoadingOverlay from '../components/review/LoadingOverlay.vue';
import SessionRetryMask from '../components/review/SessionRetryMask.vue';
import QaChatWidget from '../components/review/QaChatWidget.vue';
import { useReviewState } from '../composables/useReviewState';
import { useReviewHelpers } from '../composables/useReviewHelpers';
import { useReviewEditor } from '../composables/useReviewEditor';
import { useReviewActions } from '../composables/useReviewActions';
import { useReviewFocused } from '../composables/useReviewFocused';
import { useReviewAnalysis } from '../composables/useReviewAnalysis';
import { useReviewSocket } from '../composables/useReviewSocket';
import { useReviewUpload } from '../composables/useReviewUpload';
import { useReviewSession } from '../composables/useReviewSession';

export default {
  name: 'ReviewView',
  components: {
    StepHeader, UploadStep, SettingsStep, ReviewStep,
    LoadingOverlay, SessionRetryMask, QaChatWidget,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const isResetting = ref(false);

    const state = useReviewState({ isResetting });
    const helpers = useReviewHelpers(state);
    const editor = useReviewEditor(state, helpers);
    const actions = useReviewActions(state, editor, helpers);
    const focused = useReviewFocused(state, editor);
    const analysis = useReviewAnalysis(state);
    const socket = useReviewSocket(state, {
      startStatusPolling: analysis.startStatusPolling,
      stopStatusPolling: analysis.stopStatusPolling,
      stopElapsedTimer: analysis.stopElapsedTimer,
    });
    const upload = useReviewUpload(state, {
      setupSocket: socket.setupSocket,
      resetState: state.resetState,
    });
    const session = useReviewSession(state, {
      route,
      router,
      setupSocket: socket.setupSocket,
      loadFocusedReviewHistory: focused.loadFocusedReviewHistory,
      forceSaveCurrentDocument: editor.forceSaveCurrentDocument,
      goBackToConfirm: upload.goBackToConfirm,
      scrollQaToBottom: socket.scrollQaToBottom,
      qaPanelOpen: socket.qaPanelOpen,
    });

    provide('review', {
      ...state, ...helpers, ...editor, ...actions, ...focused,
      ...analysis, ...socket, ...upload, ...session,
    });

    const {
      activeStep, perspective, activeAiTab, selectedTemplateId, reviewApplyMode, saveState,
      contract, preAnalysisData, reviewData, selectedReviewPoints, customPurposes,
      allSuggestedReviewPoints, allPotentialParties, allSuggestedCorePurposes,
      cameFromHistory, resetState, socket: socketRef,
    } = state;
    const { loadReviewTemplates } = upload;
    const { loadContractFromServer, loadState } = session;
    const { forceSaveCurrentDocument, stopAutoForceSave } = editor;
    const { stopStatusPolling, stopElapsedTimer } = analysis;

    watch([activeStep, perspective, activeAiTab, selectedTemplateId, reviewApplyMode], () => {
      localStorage.setItem('contract_apply_mode', reviewApplyMode.value);
      saveState();
    });
    watch([
      contract, preAnalysisData, reviewData, selectedReviewPoints, customPurposes,
      allSuggestedReviewPoints, allPotentialParties, allSuggestedCorePurposes,
    ], saveState, { deep: true });

    onBeforeRouteUpdate((to, from) => {
      if (from.query.contract_id && !to.query.contract_id) {
        resetState();
      }
    });

    onMounted(() => {
      loadReviewTemplates();
      const contractIdFromQuery = route.query.contract_id;
      if (contractIdFromQuery) {
        resetState();
        cameFromHistory.value = true;
        loadContractFromServer(contractIdFromQuery);
      } else {
        cameFromHistory.value = false;
        loadState();
      }
    });

    onUnmounted(() => {
      stopAutoForceSave();
      forceSaveCurrentDocument(true);
      stopStatusPolling();
      stopElapsedTimer();
      if (socketRef.value) socketRef.value.disconnect();
    });

    return { activeStep };
  },
};
</script>

<style>
/* Add global overrides for Element Plus components we are keeping */
/* Select Dropdown */
.el-select-dropdown {
  @apply rounded-lg shadow-lg border border-border-color;
}
.el-select-dropdown__item {
  @apply text-text-main;
}
.el-select-dropdown__item.hover, .el-select-dropdown__item:hover {
  @apply bg-primary-light text-primary-dark;
}
.el-select-dropdown__item.selected {
  @apply text-primary-dark font-semibold;
}

/* Checkbox */
.el-checkbox.is-bordered {
 @apply bg-white border-border-color hover:border-primary;
}
.el-checkbox.is-bordered.is-checked {
  @apply border-primary;
}
.el-checkbox__inner {
  @apply border-border-color;
}
.el-checkbox__input.is-checked .el-checkbox__inner, .el-checkbox__input.is-indeterminate .el-checkbox__inner {
  @apply bg-primary border-primary;
}
.el-checkbox__label {
  @apply text-text-main;
}
.el-checkbox__input.is-checked+.el-checkbox__label {
  @apply text-primary;
}

/* Input */
.el-input__wrapper {
  @apply rounded-md border border-border-color shadow-sm transition-colors duration-200 ease-in-out focus-within:border-primary focus-within:ring-1 focus-within:ring-primary;
}

.diff-insert {
  background: #dcfce7;
  color: #166534;
  text-decoration: none;
}

.diff-delete {
  background: #fee2e2;
  color: #991b1b;
  text-decoration: line-through;
}

.analysis-progress {
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
}

.analysis-progress__item {
  position: relative;
  display: flex;
  gap: 10px;
  padding-bottom: 12px;
}

.analysis-progress__item:last-child {
  padding-bottom: 0;
}

.analysis-progress__item::after {
  content: '';
  position: absolute;
  left: 9px;
  top: 22px;
  bottom: 0;
  width: 2px;
  background: #d1d5db;
}

.analysis-progress__item:last-child::after {
  display: none;
}

.analysis-progress__marker {
  position: relative;
  z-index: 1;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 999px;
  border: 2px solid #94a3b8;
  background: #fff;
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
}

.analysis-progress__item--running .analysis-progress__marker {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.analysis-progress__item--pending .analysis-progress__marker {
  border-color: #cbd5e1;
  background: #f1f5f9;
  color: #94a3b8;
}

.analysis-progress__item--pending .analysis-progress__status {
  color: #94a3b8;
}

.analysis-progress__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(37, 99, 235, 0.3);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: analysis-spin 0.8s linear infinite;
}

@keyframes analysis-spin {
  to { transform: rotate(360deg); }
}

.analysis-progress__item--completed .analysis-progress__marker {
  background: #16a34a;
  border-color: #16a34a;
}

.analysis-progress__item--failed .analysis-progress__marker {
  background: #dc2626;
  border-color: #dc2626;
}

.analysis-progress__content {
  min-width: 0;
  flex: 1;
}

.analysis-progress__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

.analysis-progress__status {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.analysis-progress__item--completed .analysis-progress__status {
  color: #16a34a;
}

.analysis-progress__item--failed .analysis-progress__status {
  color: #dc2626;
}

.analysis-progress__message {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}
</style>

<style scoped>
/* Using Tailwind utility classes, so scoped styles are minimal. */

:deep(.text-3xl) {
  font-size: 24px !important;
  line-height: 1.2 !important;
}

:deep(.sm\:text-4xl) {
  font-size: 28px !important;
  line-height: 1.18 !important;
}

:deep(.text-lg) {
  font-size: 15px !important;
  line-height: 1.35 !important;
}

:deep(.text-md),
:deep(.text-base) {
  font-size: 13px !important;
  line-height: 1.45 !important;
}

:deep(.text-sm) {
  font-size: 12px !important;
  line-height: 1.45 !important;
}

:deep(.text-xs) {
  font-size: 11px !important;
  line-height: 1.35 !important;
}

:deep(.p-10) {
  padding: 24px !important;
}

:deep(.p-6) {
  padding: 14px !important;
}

:deep(.p-4) {
  padding: 10px !important;
}

:deep(.p-3) {
  padding: 8px !important;
}

:deep(.py-8) {
  padding-top: 18px !important;
  padding-bottom: 18px !important;
}

:deep(.px-4) {
  padding-left: 10px !important;
  padding-right: 10px !important;
}

:deep(.py-2) {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}

:deep(.mt-10) {
  margin-top: 22px !important;
}

:deep(.mt-8) {
  margin-top: 14px !important;
}

:deep(.mt-6) {
  margin-top: 10px !important;
}

:deep(.mt-4) {
  margin-top: 8px !important;
}

:deep(.mt-3),
:deep(.mt-2) {
  margin-top: 6px !important;
}

:deep(.mb-10) {
  margin-bottom: 16px !important;
}

:deep(.mb-6) {
  margin-bottom: 10px !important;
}

:deep(.mb-4) {
  margin-bottom: 8px !important;
}

:deep(.gap-8) {
  gap: 12px !important;
}

:deep(.gap-4),
:deep(.space-x-4 > :not([hidden]) ~ :not([hidden])) {
  gap: 10px !important;
  margin-left: 10px !important;
}

:deep(.gap-3) {
  gap: 8px !important;
}

:deep(.space-y-6 > :not([hidden]) ~ :not([hidden])) {
  margin-top: 12px !important;
}

:deep(.space-y-4 > :not([hidden]) ~ :not([hidden])) {
  margin-top: 8px !important;
}

:deep(.rounded-lg),
:deep(.rounded-md) {
  border-radius: 8px !important;
}

:deep(.shadow-md) {
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 8px 22px rgba(0, 0, 0, 0.04) !important;
}

:deep(.h-\[calc\(100vh-85px\)\]) {
  height: calc(100vh - 72px) !important;
}

:deep(.el-checkbox.is-bordered) {
  padding: 5px 9px !important;
  height: auto !important;
}

:deep(.el-checkbox-group) {
  gap: 6px !important;
}

.review-page {
  height: calc(100vh - 56px);
  overflow: hidden;
  padding: 8px 10px 10px;
  font-size: 13px;
}
</style>

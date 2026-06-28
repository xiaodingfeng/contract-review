<template>
  <div v-if="sessionLoadFailed" class="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
    <div class="flex flex-col items-center max-w-md bg-white border border-border-color rounded-md p-6 shadow-md w-full mx-4">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-amber-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      <p class="text-lg font-semibold text-text-dark mb-1">恢复会话失败</p>
      <p class="text-sm text-text-light text-center mb-4">可能是网络连接问题导致无法加载合同详情。您的审查进度已保留，可点击下方按钮重试，或返回首页。</p>
      <div class="flex gap-3">
        <button @click="retryLoadSession" class="px-4 py-2 text-sm font-medium text-white bg-primary rounded hover:bg-primary-dark">重试恢复</button>
        <button @click="abandon" class="px-4 py-2 text-sm font-medium text-text-main bg-white border border-border-color rounded hover:bg-bg-subtle">放弃并重置</button>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';

export default {
  name: 'SessionRetryMask',
  setup() {
    const review = inject('review');
    const { sessionLoadFailed, retryLoadSession, resetState } = review;
    const abandon = () => {
      sessionLoadFailed.value = false;
      resetState();
    };
    return { sessionLoadFailed, retryLoadSession, abandon };
  },
};
</script>

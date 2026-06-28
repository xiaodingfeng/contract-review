<template>
  <div v-if="activeStep === 2" class="qa-chat-widget" :class="{ 'qa-chat-widget--open': qaPanelOpen }">
    <div v-if="!qaPanelOpen" class="qa-chat-widget__fab" @click="toggleQaPanel">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
      <span class="qa-chat-widget__fab-badge" v-if="qaMessages.length">智能问答</span>
      <span class="qa-chat-widget__fab-badge" v-else>智能问答</span>
    </div>
    <div v-else class="qa-chat-widget__panel">
      <div class="qa-chat-widget__header">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          <span class="font-semibold text-sm text-text-dark">智能问答</span>
          <span v-if="contract.id" class="text-xs text-text-light">已关联：{{ contract.original_filename }}</span>
        </div>
        <div class="flex items-center gap-1">
          <button v-if="qaMessages.length" @click="clearQaChat" title="清空会话" class="text-gray-400 hover:text-red-500 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
          <button @click="toggleQaPanel" title="关闭" class="text-gray-400 hover:text-text-dark p-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <div ref="qaChatBody" class="qa-chat-widget__body">
        <div v-if="qaMessages.length === 0" class="qa-chat-widget__empty">
          <p class="text-sm text-text-light">输入问题，AI 将基于当前合同为您解答。</p>
          <p class="text-xs text-text-light mt-1">例如：试用期超过法定期限怎么处理？</p>
        </div>
        <div v-for="(msg, index) in qaMessages" :key="'qa-' + index" class="qa-chat-widget__msg" :class="'qa-chat-widget__msg--' + msg.role">
          <div class="qa-chat-widget__bubble">
            <p class="qa-chat-widget__role">{{ msg.role === 'user' ? '你' : 'AI 助手' }}</p>
            <div class="qa-chat-widget__content" v-html="renderQaMarkdown(msg.content || '正在生成...')"></div>
          </div>
        </div>
        <div v-if="qaLoading" class="qa-chat-widget__typing">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="qa-chat-widget__footer">
        <el-input
          v-model="qaInput"
          type="textarea"
          :rows="2"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          resize="none"
          :disabled="qaLoading"
          @keydown.enter.prevent="handleQaEnter"
        />
        <button @click="sendQaMessage" :disabled="!qaInput.trim() || qaLoading" class="qa-chat-widget__send">
          发送
        </button>
      </div>
    </div>
    <!-- 3.3 查看法条弹窗 -->
    <el-dialog v-model="viewLawDialogVisible" title="法条详情" width="600px" append-to-body>
      <div v-if="currentLawRef" class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-base font-bold text-text-dark">{{ currentLawRef.law_name }} {{ currentLawRef.clause_id }}</p>
          <el-tag :type="currentLawRef.law_status === '现行' ? 'success' : currentLawRef.law_status === '已修订' ? 'warning' : 'danger'" size="small">
            {{ currentLawRef.law_status || '现行' }}
          </el-tag>
        </div>
        <p v-if="currentLawRef.effective_date" class="text-xs text-text-light">施行日期:{{ currentLawRef.effective_date }}</p>
        <p class="text-sm text-text-main leading-relaxed whitespace-pre-line bg-gray-50 p-3 rounded border border-gray-200">{{ currentLawRef.content }}</p>
        <p v-if="currentLawRef.law_status && currentLawRef.law_status !== '现行'" class="text-xs text-red-700 bg-red-50 p-2 rounded">
          注意:该条文法律状态为「{{ currentLawRef.law_status }}」,引用时请谨慎,建议查询最新版本。
        </p>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { inject } from 'vue';
import { ElInput, ElDialog, ElTag } from 'element-plus';

export default {
  name: 'QaChatWidget',
  components: { ElInput, ElDialog, ElTag },
  setup() {
    const review = inject('review');
    const {
      activeStep, contract,
      qaPanelOpen, toggleQaPanel,
      qaMessages, qaChatBody, renderQaMarkdown,
      qaLoading, qaInput, handleQaEnter, sendQaMessage, clearQaChat,
      viewLawDialogVisible, currentLawRef,
    } = review;
    return {
      activeStep, contract,
      qaPanelOpen, toggleQaPanel,
      qaMessages, qaChatBody, renderQaMarkdown,
      qaLoading, qaInput, handleQaEnter, sendQaMessage, clearQaChat,
      viewLawDialogVisible, currentLawRef,
    };
  },
};
</script>

<style>
/* --- Inline Q&A Chat Widget --- */
.qa-chat-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
}

.qa-chat-widget__fab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
  transition: transform 0.2s, box-shadow 0.2s;
  justify-content: center;
}

.qa-chat-widget__fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.45);
}

.qa-chat-widget__fab-badge {
  display: none;
}

.qa-chat-widget__panel {
  width: 400px;
  height: 520px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 120px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.qa-chat-widget__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
  flex-shrink: 0;
}

.qa-chat-widget__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%);
}

.qa-chat-widget__empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
}

.qa-chat-widget__msg {
  display: flex;
  margin-bottom: 10px;
  min-width: 0;
}

.qa-chat-widget__msg--user {
  justify-content: flex-end;
}

.qa-chat-widget__msg--assistant {
  justify-content: flex-start;
}

.qa-chat-widget__bubble {
  max-width: 85%;
  min-width: 0;
  border-radius: 8px;
  padding: 8px 12px;
  background: #fff;
  box-shadow: inset 0 0 0 1px #e5e7eb;
  word-break: break-word;
  overflow-wrap: break-word;
}

.qa-chat-widget__msg--user .qa-chat-widget__bubble {
  background: #2563eb;
  color: #fff;
  box-shadow: none;
}

.qa-chat-widget__role {
  margin: 0 0 3px;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

.qa-chat-widget__content {
  font-size: 13px;
  line-height: 1.55;
}

.qa-chat-widget__content :deep(p) {
  margin: 0 0 4px;
}

.qa-chat-widget__content :deep(p:last-child) {
  margin-bottom: 0;
}

.qa-chat-widget__typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.qa-chat-widget__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  animation: qa-typing-pulse 1s infinite ease-in-out;
}

.qa-chat-widget__typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.qa-chat-widget__typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes qa-typing-pulse {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}

.qa-chat-widget__footer {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  flex-shrink: 0;
}

.qa-chat-widget__footer .el-input {
  flex: 1;
}

.qa-chat-widget__send {
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 0 16px;
  cursor: pointer;
}

.qa-chat-widget__send:disabled {
  background: #a3a3a3;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .qa-chat-widget__panel {
    width: calc(100vw - 32px);
    height: calc(100vh - 100px);
  }
}
</style>

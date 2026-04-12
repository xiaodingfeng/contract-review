<template>
  <main class="qa-page">
    <section class="qa-shell">
      <header class="qa-header">
        <div>
          <p class="eyebrow">智能问答</p>
          <h1>法律与合同问答</h1>
          <p class="subcopy">可关联合同，也可直接询问法条、裁判文书、审查规则和公司主体公开信息。</p>
        </div>
        <div class="qa-actions">
          <el-select v-model="selectedContractId" placeholder="选择关联合同" clearable @change="loadHistory">
            <el-option v-for="contract in contracts" :key="contract.id" :label="contract.original_filename" :value="contract.id" />
          </el-select>
          <button class="ghost-button" @click="clearChat">清空</button>
        </div>
      </header>

      <section ref="chatContainer" class="chat-panel">
        <div v-if="messages.length === 0" class="empty-state">
          <p class="empty-title">输入一个具体问题</p>
          <p>例如：试用期超过法定期限怎么处理？某家公司主体信息是否需要进一步核验？</p>
        </div>

        <article v-for="(message, index) in messages" :key="index" :class="['message-row', message.role]">
          <div class="message-bubble">
            <p class="role-label">{{ message.role === 'user' ? '你' : 'AI 助手' }}</p>
            <div class="prose prose-sm max-w-none" v-html="renderMarkdown(message.content || '正在生成...')"></div>
          </div>
        </article>

        <div v-if="isLoading" class="stream-indicator">
          <span></span><span></span><span></span>
          <p>正在检索知识库和可信搜索结果...</p>
        </div>
      </section>

      <footer class="composer">
        <el-input
          v-model="inputQuestion"
          type="textarea"
          :rows="2"
          placeholder="输入问题，Enter 发送，Shift + Enter 换行"
          resize="none"
          :disabled="isLoading"
          @keydown.enter.prevent="handleEnter"
        />
        <button class="send-button" :disabled="!inputQuestion.trim() || isLoading" @click="askQuestion">
          发送
        </button>
      </footer>
    </section>
  </main>
</template>

<script>
import { ref, onMounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElInput, ElMessage, ElOption, ElSelect } from 'element-plus';
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import api from '../api';
import { getUserId } from '../user';

export default {
  name: 'QnAView',
  components: { ElInput, ElOption, ElSelect },
  setup() {
    const route = useRoute();
    const inputQuestion = ref('');
    const messages = ref([]);
    const isLoading = ref(false);
    const contracts = ref([]);
    const selectedContractId = ref(null);
    const chatContainer = ref(null);
    const sessionId = ref(localStorage.getItem('qa_session_id') || uuidv4());

    if (!localStorage.getItem('qa_session_id')) {
      localStorage.setItem('qa_session_id', sessionId.value);
    }

    const escapeHtml = (text) => String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const renderMarkdown = (text) => marked.parse(escapeHtml(text));

    const scrollToBottom = async () => {
      await nextTick();
      if (chatContainer.value) chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    };

    const loadContracts = async () => {
      try {
        const response = await api.getContractHistory();
        contracts.value = response.data;
        if (route.query.contract_id) selectedContractId.value = Number(route.query.contract_id);
      } catch {
        ElMessage.error('获取合同列表失败');
      }
    };

    const loadHistory = async () => {
      try {
        const response = await api.getQAHistory(sessionId.value);
        messages.value = response.data;
        scrollToBottom();
      } catch {
        console.error('Failed to load QA history');
      }
    };

    const parseSseEvent = (eventText) => {
      const eventLine = eventText.split('\n').find((line) => line.startsWith('event:'));
      const dataLines = eventText
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace('data:', '').trim());
      if (!dataLines.length) return null;
      return {
        event: eventLine?.replace('event:', '').trim(),
        data: JSON.parse(dataLines.join('\n')),
      };
    };

    const buildRequestHistory = () => messages.value
      .filter((message) => ['user', 'assistant'].includes(message.role) && String(message.content || '').trim())
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: String(message.content || '').slice(0, 4000),
      }));

    const askQuestion = async () => {
      if (!inputQuestion.value.trim() || isLoading.value) return;

      const question = inputQuestion.value.trim();
      const history = buildRequestHistory();
      inputQuestion.value = '';
      messages.value.push({ role: 'user', content: question });
      const assistantMessage = { role: 'assistant', content: '' };
      messages.value.push(assistantMessage);
      await scrollToBottom();

      isLoading.value = true;
      try {
        const response = await fetch(api.getQaStreamUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': getUserId() || '',
          },
          body: JSON.stringify({
            question,
            sessionId: sessionId.value,
            contractId: selectedContractId.value,
            history,
          }),
        });
        if (!response.ok || !response.body) throw new Error('STREAM_FAILED');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const eventText of events) {
            const parsed = parseSseEvent(eventText);
            if (!parsed) continue;
            if (parsed.event === 'delta') {
              assistantMessage.content += parsed.data.content || '';
              scrollToBottom();
            }
            if (parsed.event === 'done' && parsed.data.answer) {
              assistantMessage.content = parsed.data.answer;
            }
            if (parsed.event === 'error') throw new Error(parsed.data.error || 'STREAM_FAILED');
          }
        }
        if (!assistantMessage.content.trim()) assistantMessage.content = '未收到有效回答。';
      } catch {
        ElMessage.error('问答请求失败，请稍后重试');
        assistantMessage.content = '抱歉，我现在无法回答您的问题。';
      } finally {
        isLoading.value = false;
        scrollToBottom();
      }
    };

    const handleEnter = (event) => {
      if (!event.shiftKey) askQuestion();
    };

    const clearChat = () => {
      sessionId.value = uuidv4();
      localStorage.setItem('qa_session_id', sessionId.value);
      messages.value = [];
    };

    onMounted(() => {
      loadContracts();
      loadHistory();
    });

    return {
      inputQuestion,
      messages,
      isLoading,
      contracts,
      selectedContractId,
      chatContainer,
      askQuestion,
      handleEnter,
      renderMarkdown,
      clearChat,
      loadHistory,
    };
  },
};
</script>

<style scoped>
.qa-page {
  height: calc(100vh - 56px);
  overflow: hidden;
  background: #ffffff;
  color: #111111;
  padding: 14px 18px;
  font-size: 13px;
}

.qa-shell {
  max-width: 1180px;
  margin: 0 auto;
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 10px;
}

.qa-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
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
  font-size: 28px;
  line-height: 1.14;
  letter-spacing: 0;
}

.subcopy {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
}

.qa-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.qa-actions .el-select {
  width: 260px;
}

.ghost-button,
.send-button {
  border: 0;
  border-radius: 8px;
  font-weight: 800;
  cursor: pointer;
}

.ghost-button {
  min-height: 34px;
  background: #ffffff;
  color: #111111;
  padding: 0 12px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.send-button {
  background: #111111;
  color: #ffffff;
  padding: 0 18px;
}

.send-button:disabled {
  background: #a3a3a3;
  cursor: not-allowed;
}

.chat-panel {
  min-height: 0;
  overflow-y: auto;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  padding: 12px;
  background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%);
}

.empty-state {
  min-height: 180px;
  height: 100%;
  display: grid;
  place-content: center;
  text-align: center;
  color: #666666;
}

.empty-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 800;
  color: #111111;
}

.message-row {
  display: flex;
  margin-bottom: 10px;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: min(820px, 86%);
  border-radius: 8px;
  padding: 10px 12px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 8px 22px rgba(0, 0, 0, 0.04);
}

.message-row.user .message-bubble {
  color: #ffffff;
  background: #111111;
  box-shadow: none;
}

.role-label {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 800;
  color: inherit;
  opacity: 0.72;
}

.stream-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #666666;
  font-size: 12px;
}

.stream-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1s infinite ease-in-out;
}

.stream-indicator span:nth-child(2) {
  animation-delay: 0.15s;
}

.stream-indicator span:nth-child(3) {
  animation-delay: 0.3s;
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: stretch;
}

.prose {
  color: inherit;
  font-size: 13px;
  line-height: 1.55;
}

.prose :deep(p) {
  margin: 0 0 6px;
}

.prose :deep(p:last-child) {
  margin-bottom: 0;
}

@keyframes pulse {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  50% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

@media (max-width: 760px) {
  .qa-page {
    height: auto;
    min-height: calc(100vh - 56px);
    overflow: visible;
    padding: 12px;
  }

  .qa-shell {
    height: auto;
    min-height: calc(100vh - 88px);
  }

  .qa-header,
  .qa-actions,
  .composer {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .qa-actions .el-select {
    width: 100%;
  }

  .chat-panel {
    min-height: 420px;
  }
}
</style>

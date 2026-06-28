// Review.vue Socket 协作 + Q&A 问答
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import { io } from 'socket.io-client';
import api from '../api';
import { getUserId } from '../user';

export function useReviewSocket(state, deps) {
    const {
        contract, reviewData, loading, loadingMessage, activeStep,
        analysisActive, analysisPercent, analysisEta, analysisElapsed,
        analysisProgress, analysisSteps, clauseProgress,
        perspective, reAnalyzing, socket,
        contractModifiedNotice,
    } = state;
    const { startStatusPolling, stopStatusPolling, stopElapsedTimer } = deps;

    const qaPanelOpen = ref(false);
    const qaInput = ref('');
    const qaMessages = ref([]);
    const qaLoading = ref(false);
    const qaChatBody = ref(null);
    const qaSessionId = ref(localStorage.getItem('qa_session_id') || uuidv4());
    if (!localStorage.getItem('qa_session_id')) {
        localStorage.setItem('qa_session_id', qaSessionId.value);
    }

    const setupSocket = (contractId) => {
        if (socket.value) socket.value.disconnect();

        const backendUrl = import.meta.env.VITE_APP_BACKEND_API_URL || 'http://localhost:3000';
        socket.value = io(backendUrl);

        socket.value.on('connect', () => {
            console.log('Connected to collaboration server');
            socket.value.emit('join-contract', contractId);
        });

        socket.value.on('connect_error', (error) => {
            console.error('Collaboration server connection failed:', error.message);
        });

        socket.value.on('analysis-complete', (data) => {
            console.log('Received real-time analysis update');
            analysisActive.value = false;
            analysisPercent.value = 100;
            reAnalyzing.value = false;
            stopStatusPolling();
            stopElapsedTimer();
            ElMessage.success({
                message: `审查完成（立场：${data.perspective || '未指定'}）。`,
                duration: 3000
            });
            Object.assign(reviewData, data.results || data);
            if (data.perspective) perspective.value = data.perspective;
            loading.value = false;
            activeStep.value = 2;
        });

        socket.value.on('analysis-progress', (data) => {
            analysisProgress.value.push(data);
            if (typeof data.percent === 'number') analysisPercent.value = data.percent;
            if (typeof data.estimatedRemainingSeconds === 'number') analysisEta.value = data.estimatedRemainingSeconds;
            if (typeof data.elapsedSeconds === 'number') analysisElapsed.value = data.elapsedSeconds;
            if (Array.isArray(data.steps)) {
                analysisSteps.value = data.steps;
            } else if (data.step && data.status) {
                const stepKey = data.step;
                const stepStatus = data.status;
                analysisSteps.value = analysisSteps.value.map((s) =>
                    s.key === stepKey ? { ...s, status: stepStatus, message: data.message || s.message || '' } : s
                );
            }
            if (data.partialResult) {
                Object.assign(reviewData, data.partialResult);
            }
            loadingMessage.value = data.message || loadingMessage.value;
        });

        socket.value.on('clause_progress', (data) => {
            if (!data) return;
            clauseProgress.value = {
                reviewed: Number(data.reviewed) || 0,
                total: Number(data.total) || 0,
                current_clause_id: data.current_clause_id || '',
            };
        });

        socket.value.on('analysis-failed', (data) => {
            analysisActive.value = false;
            loading.value = false;
            reAnalyzing.value = false;
            stopStatusPolling();
            stopElapsedTimer();
            ElMessage.error(data?.error || '分析失败，请稍后重试');
        });

        socket.value.on('contract-modified', (data) => {
            if (!data || Number(data.contract_id) !== Number(contractId)) return;
            contractModifiedNotice.value = {
                contract_id: data.contract_id,
                modified: data.modified || 0,
                added: data.added || 0,
                deleted: data.deleted || 0,
                total_changes: data.total_changes || 0,
                saved_at: data.saved_at,
            };
            ElMessage.warning(`检测到合同修订(${data.total_changes || 0} 处变更),建议执行增量审查`);
        });

        socket.value.on('disconnect', () => {
            if (analysisActive.value) startStatusPolling();
        });
    };

    const escapeQaHtml = (text) => String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const renderQaMarkdown = (text) => marked.parse(escapeQaHtml(text));

    const scrollQaToBottom = async () => {
        await nextTick();
        if (qaChatBody.value) qaChatBody.value.scrollTop = qaChatBody.value.scrollHeight;
    };

    const toggleQaPanel = async () => {
        qaPanelOpen.value = !qaPanelOpen.value;
        if (qaPanelOpen.value) {
            await scrollQaToBottom();
        }
    };

    const parseQaSseEvent = (eventText) => {
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

    const buildQaHistory = () => qaMessages.value
        .filter((m) => ['user', 'assistant'].includes(m.role) && String(m.content || '').trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));

    const sendQaMessage = async () => {
        if (!qaInput.value.trim() || qaLoading.value) return;
        const question = qaInput.value.trim();
        const history = buildQaHistory();
        qaInput.value = '';
        qaMessages.value.push({ role: 'user', content: question });
        const assistantIdx = qaMessages.value.length;
        qaMessages.value.push({ role: 'assistant', content: '' });
        await scrollQaToBottom();
        qaLoading.value = true;
        try {
            const response = await fetch(api.getQaStreamUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-ID': getUserId() || '',
                },
                body: JSON.stringify({
                    question,
                    sessionId: qaSessionId.value,
                    contractId: contract.id,
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
                    const parsed = parseQaSseEvent(eventText);
                    if (!parsed) continue;
                    if (parsed.event === 'delta') {
                        qaMessages.value[assistantIdx].content += parsed.data.content || '';
                        scrollQaToBottom();
                    }
                    if (parsed.event === 'done' && parsed.data.answer) {
                        qaMessages.value[assistantIdx].content = parsed.data.answer;
                    }
                    if (parsed.event === 'error') throw new Error(parsed.data.error || 'STREAM_FAILED');
                }
            }
            if (!qaMessages.value[assistantIdx].content.trim()) {
                qaMessages.value[assistantIdx].content = '未收到有效回答。';
            }
        } catch {
            ElMessage.error('问答请求失败，请稍后重试');
            qaMessages.value[assistantIdx].content = '抱歉，我现在无法回答您的问题。';
        } finally {
            qaLoading.value = false;
            scrollQaToBottom();
        }
    };

    const handleQaEnter = (event) => {
        if (!event.shiftKey) sendQaMessage();
    };

    const clearQaChat = () => {
        qaMessages.value = [];
        qaSessionId.value = uuidv4();
        localStorage.setItem('qa_session_id', qaSessionId.value);
        qaInput.value = '';
        qaLoading.value = false;
        ElMessage.success('已清空当前会话记录');
    };

    return {
        qaPanelOpen, qaInput, qaMessages, qaLoading, qaChatBody, qaSessionId,
        setupSocket, escapeQaHtml, renderQaMarkdown, scrollQaToBottom,
        toggleQaPanel, parseQaSseEvent, buildQaHistory, sendQaMessage,
        handleQaEnter, clearQaChat,
    };
}

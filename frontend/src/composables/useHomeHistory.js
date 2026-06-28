// Home 页面审查记录列表逻辑：加载、搜索筛选、分页、删除
// 从 Home.vue setup() 抽取，Home.vue 仅负责编排与渲染
import { computed, ref, watch, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';

export const HISTORY_PAGE_SIZE = 5;

export function useHomeHistory() {
    const history = ref([]);
    const loading = ref(true);
    const error = ref(null);
    const historyPage = ref(1);
    const searchKeyword = ref('');
    const statusFilter = ref('');
    const typeFilter = ref('');

    const availableContractTypes = computed(() => {
        const types = new Set();
        history.value.forEach((item) => {
            if (item.contract_type) types.add(item.contract_type);
        });
        return Array.from(types).sort();
    });

    const filteredHistory = computed(() => {
        const kw = searchKeyword.value.trim().toLowerCase();
        return history.value.filter((item) => {
            if (kw && !String(item.original_filename || '').toLowerCase().includes(kw)) return false;
            if (statusFilter.value && item.status !== statusFilter.value) return false;
            if (typeFilter.value && item.contract_type !== typeFilter.value) return false;
            return true;
        });
    });

    const totalHistoryPages = computed(() => Math.max(1, Math.ceil(filteredHistory.value.length / HISTORY_PAGE_SIZE)));

    const pagedHistory = computed(() => {
        const start = (historyPage.value - 1) * HISTORY_PAGE_SIZE;
        return filteredHistory.value.slice(start, start + HISTORY_PAGE_SIZE);
    });

    const fetchHistory = async () => {
        loading.value = true;
        error.value = null;
        try {
            if (!getUserId()) {
                error.value = '无法获取用户身份，请刷新页面重试。';
                return;
            }
            const response = await api.getUserHistory(getUserId());
            history.value = response.data;
            historyPage.value = Math.min(historyPage.value, totalHistoryPages.value);
        } catch (err) {
            error.value = '加载审查记录失败，请稍后重试。';
            console.error(err);
        } finally {
            loading.value = false;
        }
    };

    const deleteReport = async (item) => {
        try {
            if (item.record_type === 'group') {
                await api.deleteContractGroup(item.id);
            } else {
                await api.deleteContract(item.id);
            }
            await fetchHistory();
        } catch {
            ElMessage.error('删除失败');
        }
    };

    // 筛选条件变化时回到第一页
    watch([searchKeyword, statusFilter, typeFilter], () => { historyPage.value = 1; });

    onMounted(fetchHistory);

    return {
        history,
        loading,
        error,
        historyPage,
        searchKeyword,
        statusFilter,
        typeFilter,
        availableContractTypes,
        filteredHistory,
        totalHistoryPages,
        pagedHistory,
        fetchHistory,
        deleteReport,
    };
}

// 纯展示辅助函数：日期格式化与状态文本映射
export const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const statusText = (status) => ({
    Reviewed: '已完成',
    Uploaded: '已上传',
    PreAnalyzed: '待确认',
}[status] || status || '处理中');

<template>
  <div class="bg-bg-main shadow-md rounded-lg p-6">
    <h2 class="text-2xl font-bold text-text-dark mb-6">审核历史记录</h2>
    <div v-if="loading" class="text-center py-10">
      <p class="text-text-light">正在加载中...</p>
    </div>
    <div v-else-if="historyList.length === 0" class="text-center py-10 border-2 border-dashed border-border-color rounded-lg">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      <h3 class="mt-2 text-sm font-semibold text-text-dark">没有历史记录</h3>
      <p class="mt-1 text-sm text-text-light">开始一次新的合同审查来创建您的第一条记录。</p>
    </div>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-border-color">
        <thead class="bg-bg-subtle">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-text-light uppercase tracking-wider">合同名称</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-text-light uppercase tracking-wider">审查时间</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-text-light uppercase tracking-wider">状态</th>
            <th scope="col" class="relative px-6 py-3">
              <span class="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody class="bg-bg-main divide-y divide-border-color">
          <tr v-for="(item, index) in historyList" :key="item.id" class="hover:bg-bg-subtle">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-text-dark">{{ item.original_filename }}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-text-light">{{ formatDateTime(item.created_at) }}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-text-light">
                <span :class="getStatusClass(item.status)" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full">
                    {{ item.status }}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
              <button @click="viewReport(item.id)" class="text-primary hover:text-primary-dark font-semibold">查看报告</button>
              <el-popconfirm
                title="确定要删除这条记录吗？文件将一并删除。"
                confirm-button-text="确定删除"
                cancel-button-text="取消"
                confirm-button-type="danger"
                @confirm="handleDelete(item.id, index)"
                width="250"
              >
                <template #reference>
                  <button class="text-danger hover:text-red-700 font-semibold">删除</button>
                </template>
              </el-popconfirm>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElPopconfirm } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';

export default {
  name: 'HistoryView',
  components: {
    ElPopconfirm,
  },
  setup() {
    const historyList = ref([]);
    const loading = ref(true);
    const router = useRouter();

    const fetchHistory = async () => {
      const userId = getUserId();
      if (!userId) {
        ElMessage.error('无法获取用户ID，请刷新重试。');
        loading.value = false;
        return;
      }
      try {
        const response = await api.getUserHistory(userId);
        historyList.value = response.data;
      } catch (error) {
        ElMessage.error('加载历史记录失败。');
      } finally {
        loading.value = false;
      }
    };

    const viewReport = (contractId) => {
      router.push({ path: '/', query: { contract_id: contractId } });
    };

    const handleDelete = async (contractId, index) => {
      try {
        await api.deleteContract(contractId);
        historyList.value.splice(index, 1); // Remove from list immediately
        ElMessage.success('删除成功！');
      } catch (error) {
        ElMessage.error('删除失败，请稍后重试。');
      }
    };

    const formatDateTime = (dateTime) => {
        if (!dateTime) return '';
        const date = new Date(dateTime);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    const getStatusClass = (status) => {
        if (status === 'Reviewed') {
            return 'bg-green-100 text-green-800';
        }
        if (status === 'Uploaded') {
            return 'bg-yellow-100 text-yellow-800';
        }
        return 'bg-gray-100 text-gray-800';
    };

    onMounted(() => {
      fetchHistory();
    });

    return {
      historyList,
      loading,
      viewReport,
      handleDelete,
      formatDateTime,
      getStatusClass,
    };
  },
};
</script>

<style scoped>
/* All styles are now handled by Tailwind utility classes */
</style> 
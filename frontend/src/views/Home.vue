<template>
  <div class="space-y-4">
    <!-- Hero Section -->
    <div class="text-center py-3 bg-white rounded-lg shadow-md">
      <h1 class="text-4xl font-bold tracking-tight text-text-dark sm:text-5xl">您的智能合同审查伙伴</h1>
      <p class="mt-4 max-w-2xl mx-auto text-lg leading-8 text-text-light">上传合同，AI 助您深度分析、识别风险、守护权益。一键开启专业、高效的审查之旅。</p>
      <div class="mt-4">
        <button @click="startNewReview" class="px-8 py-3 text-base font-medium text-white bg-primary border border-transparent rounded-md shadow-sm hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary">
          开始审查
        </button>
      </div>
    </div>

    <!-- History List Section -->
    <div class="bg-white rounded-lg shadow-md">
      <div class="p-3 border-b border-border-color">
        <h2 class="text-xl font-semibold text-text-dark">最近的审查历史</h2>
      </div>
      <div class="p-3">
        <div v-if="loading" class="text-center text-text-light">正在加载历史记录...</div>
        <div v-else-if="error" class="text-center text-danger">{{ error }}</div>
        <div v-else-if="history.length === 0" class="text-center text-text-light py-8">
          <p>您还没有任何审查记录。</p>
          <p class="mt-2 text-sm">点击上方的"开始审查"按钮，上传您的第一份合同吧！</p>
        </div>
        <div v-else class="overflow-y-auto max-h-[50vh]">
          <table class="min-w-full divide-y divide-border-color">
            <thead class="bg-bg-subtle sticky top-0">
              <tr>
                <th scope="col" class="py-3 px-6 text-left text-xs font-medium text-text-light uppercase tracking-wider">合同名称</th>
                <th scope="col" class="py-3 px-6 text-left text-xs font-medium text-text-light uppercase tracking-wider">审查时间</th>
                <th scope="col" class="py-3 px-6 text-left text-xs font-medium text-text-light uppercase tracking-wider">状态</th>
                <th scope="col" class="py-3 px-6 text-right text-xs font-medium text-text-light uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-border-color">
              <tr v-for="item in history" :key="item.id" class="hover:bg-bg-subtle transition-colors duration-150">
                <td class="py-4 px-6 text-sm font-medium text-text-dark whitespace-nowrap">{{ item.original_filename }}</td>
                <td class="py-4 px-6 text-sm text-text-main whitespace-nowrap">{{ formatDate(item.created_at) }}</td>
                <td class="py-4 px-6 text-sm text-text-main whitespace-nowrap">
                  <span :class="getStatusClass(item.status)" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full">
                    {{ item.status }}
                  </span>
                </td>
                <td class="py-4 px-6 text-right text-sm font-medium">
                  <button @click="viewReport(item.id)" class="text-primary hover:text-primary-dark">查看报告</button>
                  <el-popconfirm title="确认删除?" @confirm="deleteReport(item.id)">
                    <template #reference>
                      <button class="text-primary hover:text-primary-dark ml-5">删除</button>
                    </template>
                  </el-popconfirm>

                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import { getUserId } from '../user';
import {ElMessage} from "element-plus";

export default {
  name: 'HomeView',
  setup() {
    const history = ref([]);
    const loading = ref(true);
    const error = ref(null);
    const router = useRouter();

    const fetchHistory = async () => {
      try {
        const userId = getUserId();
        if (!userId) {
          error.value = '无法获取用户身份，请刷新页面重试。';
          return;
        }
        const response = await api.getUserHistory(userId);
        history.value = response.data;
      } catch (err) {
        error.value = '加载历史记录失败，请稍后重试。';
        console.error(err);
      } finally {
        loading.value = false;
      }
    };

    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      return new Date(dateString).toLocaleDateString(undefined, options);
    };

    const getStatusClass = (status) => {
      if (status === 'Reviewed') return 'bg-green-100 text-green-800';
      if (status === 'Uploaded') return 'bg-blue-100 text-blue-800';
      return 'bg-gray-100 text-gray-800';
    };

    const viewReport = (contractId) => {
      router.push({ path: '/review', query: { contract_id: contractId } });
    };
    const deleteReport = (contractId) => {
      api.deleteContract(contractId).then(v => {
        if (v.status !== 200) {
          ElMessage.error(v.statusText);
        }
        fetchHistory()
      })
    };
    const startNewReview = () => {
      localStorage.removeItem('review_session');
      router.push({ path: '/review' });
    };

    onMounted(() => {
      fetchHistory();
    });

    return {
      history,
      loading,
      error,
      formatDate,
      getStatusClass,
      viewReport,
      deleteReport,
      startNewReview
    };
  }
};
</script>

<style scoped>
.home-container {
  text-align: center;
  padding: 50px;
}
</style>

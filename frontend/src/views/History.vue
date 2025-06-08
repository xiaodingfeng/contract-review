<template>
  <div class="history-container">
    <el-card class="box-card">
      <template #header>
        <div class="clearfix">
          <span>我的审核历史</span>
        </div>
      </template>
      <el-table :data="historyList" v-loading="loading" style="width: 100%">
        <el-table-column prop="original_filename" label="合同名称" min-width="250">
        </el-table-column>
        <el-table-column prop="created_at" label="审查时间" width="200">
           <template #default="scope">
            <span>{{ formatDateTime(scope.row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
            <template #default="scope">
                <el-tag :type="getStatusType(scope.row.status)">{{ scope.row.status }}</el-tag>
            </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="scope">
            <el-button @click="viewReport(scope.row.id)" type="primary" link>查看报告</el-button>
            <el-popconfirm
               title="确定要删除这条记录吗？"
               confirm-button-text="确定"
               cancel-button-text="取消"
               @confirm="handleDelete(scope.row.id, scope.$index)"
               width="220"
             >
               <template #reference>
                 <el-button size="small" type="danger" style="margin-left: 10px;">删除</el-button>
               </template>
             </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
       <el-empty v-if="!loading && historyList.length === 0" description="暂无审核记录"></el-empty>
    </el-card>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';

export default {
  name: 'HistoryView',
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

    const getStatusType = (status) => {
        if (status === 'Reviewed') return 'success';
        if (status === 'Uploaded') return 'warning';
        return 'info';
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
      getStatusType,
    };
  },
};
</script>

<style scoped>
.history-container {
  max-width: 1200px;
  margin: 0 auto;
}
</style> 
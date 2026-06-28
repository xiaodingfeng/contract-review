<template>
  <section class="panel">
    <div class="panel-title">
      <div>
        <h2>批量导入</h2>
        <p>支持 TXT、PDF、DOCX、Markdown。法律法规 Markdown 请按模板填写。</p>
        <p class="hint-text">适合首次添加多个文档（法律/案例/规则/知识）。法律若需保留版本历史，请改用下方"法律版本管理"同步。</p>
      </div>
      <div class="template-actions">
        <button class="secondary-button" @click="downloadTemplate('law')">下载法律法规模板</button>
        <button class="secondary-button" @click="downloadTemplate('case')">下载裁判文书模板</button>
      </div>
    </div>

    <div class="batch-grid">
      <el-select v-model="batchSourceType" placeholder="来源类型">
        <el-option label="法律条文" value="law" />
        <el-option label="裁判文书" value="case" />
        <el-option label="审查规则" value="rule" />
        <el-option label="审查知识" value="guide" />
      </el-select>
      <el-input v-model="batchCategory" placeholder="分类，例如：劳动争议" />
      <el-input v-model="batchSourceUrl" placeholder="来源链接，可选" />
    </div>

    <el-upload
      class="upload-zone"
      drag
      multiple
      action=""
      :auto-upload="false"
      :on-change="handleBatchFileChange"
      :on-remove="handleBatchFileRemove"
    >
      <div class="upload-copy">拖拽文件到这里，或点击选择文件</div>
    </el-upload>

    <div class="batch-footer">
      <p>已选择 {{ batchFiles.length }} 个文件</p>
      <button class="primary-button" :disabled="batchImporting || batchFiles.length === 0" @click="batchImportKnowledge">
        {{ batchImporting ? '导入中...' : '批量导入并向量化' }}
      </button>
    </div>
    <div v-if="lastImportStats" class="stats">
      <span>文档 {{ lastImportStats.imported }}</span>
      <span>切片 {{ lastImportStats.chunks }}</span>
      <span>去重 {{ lastImportStats.deduped }}</span>
      <span>存储 {{ lastImportStats.vectorStore }}</span>
    </div>
  </section>
</template>

<script>
import { ref } from 'vue';
import { ElInput, ElMessage, ElOption, ElSelect, ElUpload } from 'element-plus';
import api from '../../api';

export default {
  name: 'BatchImportPanel',
  components: { ElInput, ElOption, ElSelect, ElUpload },
  emits: ['imported'],
  setup(props, { emit }) {
    const batchFiles = ref([]);
    const batchSourceType = ref('law');
    const batchCategory = ref('');
    const batchSourceUrl = ref('');
    const batchImporting = ref(false);
    const lastImportStats = ref(null);

    const downloadTemplate = async (type = 'law') => {
      try {
        const response = await api.downloadKnowledgeTemplate(type);
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = type === 'case' ? '裁判文书模版.json' : '法律法规模板.md';
        link.click();
        URL.revokeObjectURL(url);
      } catch {
        ElMessage.error('模板下载失败。');
      }
    };

    const handleBatchFileChange = (uploadFile, uploadFiles) => {
      batchFiles.value = uploadFiles.map((item) => item.raw).filter(Boolean);
    };

    const handleBatchFileRemove = (uploadFile, uploadFiles) => {
      batchFiles.value = uploadFiles.map((item) => item.raw).filter(Boolean);
    };

    const batchImportKnowledge = async () => {
      if (batchFiles.value.length === 0) return;
      batchImporting.value = true;
      try {
        const formData = new FormData();
        batchFiles.value.forEach((file) => formData.append('files', file));
        formData.append('source_type', batchSourceType.value);
        formData.append('category', batchCategory.value);
        formData.append('source_url', batchSourceUrl.value);
        const response = await api.batchImportKnowledge(formData);
        lastImportStats.value = response.data;
        ElMessage.success(`批量导入完成：${response.data.imported} 个文档，${response.data.chunks} 个切片。`);
        batchFiles.value = [];
        // 通知父组件刷新知识列表
        emit('imported');
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '批量导入失败。');
      } finally {
        batchImporting.value = false;
      }
    };

    return {
      batchFiles,
      batchSourceType,
      batchCategory,
      batchSourceUrl,
      batchImporting,
      lastImportStats,
      downloadTemplate,
      handleBatchFileChange,
      handleBatchFileRemove,
      batchImportKnowledge,
    };
  },
};
</script>

<style scoped>
.panel {
  margin-top: 8px;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04);
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}

.panel-title h2 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0;
}

.panel-title p {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
}

.hint-text {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

.template-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

button {
  border: 0;
  border-radius: 8px;
  font-weight: 800;
  cursor: pointer;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.primary-button,
.secondary-button {
  min-height: 32px;
  padding: 0 10px;
  white-space: nowrap;
  font-size: 12px;
}

.primary-button {
  background: #111111;
  color: #ffffff;
}

.secondary-button {
  background: #ffffff;
  color: #111111;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.batch-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr);
  gap: 9px;
}

.upload-zone {
  margin-top: 8px;
}

.upload-copy {
  padding: 14px;
  color: #666666;
}

.batch-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  margin-top: 8px;
}

.batch-footer p {
  margin: 0;
  color: #666666;
  font-size: 12px;
}

.stats {
  margin-top: 7px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stats span {
  border-radius: 8px;
  padding: 7px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

@media (max-width: 780px) {
  .batch-grid {
    grid-template-columns: 1fr;
  }

  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

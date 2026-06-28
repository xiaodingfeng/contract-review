<template>
  <section class="panel">
    <div class="panel-title">
      <div>
        <h2>法律版本管理</h2>
        <p>查看法律当前版本与历史版本时间线，同步新版本法律。</p>
        <p class="hint-text">首次添加法律请用上方"批量导入"；为已有法律更新新版本（保留历史时间线）请用本功能"同步法律"。</p>
      </div>
      <button class="primary-button" @click="openSyncDialog">同步法律</button>
    </div>

    <el-table
      :data="laws"
      v-loading="lawsLoading"
      :row-key="(row) => row.id"
      @expand-change="handleLawExpandChange"
      class="law-table"
      empty-text="暂无法律数据"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="law-versions" v-loading="versionsLoadingTitle === row.title">
            <el-timeline v-if="lawVersionsMap[row.title] && lawVersionsMap[row.title].length > 0">
              <el-timeline-item
                v-for="version in lawVersionsMap[row.title]"
                :key="version.id"
                :timestamp="version.effective_date || '未知日期'"
                placement="top"
                :hollow="version.status !== '现行'"
              >
                <div class="version-item">
                  <div class="version-header">
                    <span class="version-label">{{ version.version_label || '-' }}</span>
                    <el-tag :type="lawStatusTagType(version.status)" size="small">{{ version.status || '-' }}</el-tag>
                  </div>
                  <div class="version-meta">
                    <span>施行日期：{{ version.effective_date || '-' }}</span>
                    <span v-if="version.superseded_by" class="version-superseded">已被新版本替代</span>
                    <a v-if="version.source_url" :href="version.source_url" target="_blank" rel="noopener" class="version-link">来源链接</a>
                    <span v-if="version.synced_at" class="version-synced">同步于 {{ version.synced_at }}</span>
                  </div>
                </div>
              </el-timeline-item>
            </el-timeline>
            <p v-else-if="versionsLoadingTitle !== row.title" class="muted">暂无版本数据。</p>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="法律名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="version_label" label="当前版本" width="140" />
      <el-table-column prop="effective_date" label="施行日期" width="130" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="lawStatusTagType(row.status)" size="small">{{ row.status || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="synced_at" label="同步时间" min-width="160" />
    </el-table>

    <!-- 同步法律对话框 -->
    <el-dialog v-model="syncDialogVisible" title="同步法律" width="min(640px, calc(100vw - 32px))">
      <el-radio-group v-model="syncMode" class="sync-mode-group">
        <el-radio value="upload">上传文件</el-radio>
        <el-radio value="file">文件路径</el-radio>
        <el-radio value="markdown">Markdown 内容</el-radio>
      </el-radio-group>

      <div v-if="syncMode === 'upload'" class="sync-field">
        <label class="sync-label">选择法律 Markdown 文件</label>
        <input type="file" accept=".md,.markdown" class="sync-file-input" @change="handleSyncFileChange" />
        <p v-if="syncFileName" class="hint-text">已选择：{{ syncFileName }}</p>
        <p class="hint-text">文件需符合法律法规模板格式（含 INFO 区块与"第X条"条文），可先下载模板参考。</p>
      </div>

      <div v-else-if="syncMode === 'file'" class="sync-field">
        <label class="sync-label">服务器 Markdown 文件路径</label>
        <el-input v-model="syncFilePath" placeholder="例如：backend/data/laws/民法典/合同编.md" />
      </div>

      <div v-else class="sync-field">
        <div class="sync-field-row">
          <label class="sync-label">法律名称</label>
          <el-input v-model="syncTitle" placeholder="例如：中华人民共和国民法典" />
        </div>
        <label class="sync-label">Markdown 内容</label>
        <el-input v-model="syncMarkdown" type="textarea" :rows="8" placeholder="粘贴法律 Markdown 文本" />
      </div>

      <template #footer>
        <div class="dialog-footer">
          <button class="secondary-button" @click="syncDialogVisible = false">取消</button>
          <button class="primary-button" :disabled="syncSubmitting" @click="submitSync">
            {{ syncSubmitting ? '同步中...' : '开始同步' }}
          </button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { onMounted, ref } from 'vue';
import { ElDialog, ElInput, ElLoading, ElMessage, ElRadio, ElRadioGroup, ElTable, ElTableColumn, ElTag, ElTimeline, ElTimelineItem } from 'element-plus';
import { apiClient } from '../../api';
import { lawStatusTagType } from '../../composables/useSettingsShared';

export default {
  name: 'LawVersionPanel',
  components: { ElDialog, ElInput, ElRadio, ElRadioGroup, ElTable, ElTableColumn, ElTag, ElTimeline, ElTimelineItem },
  directives: { loading: ElLoading.directive },
  setup() {
    const laws = ref([]);
    const lawsLoading = ref(false);
    const lawVersionsMap = ref({});
    const versionsLoadingTitle = ref('');
    const syncDialogVisible = ref(false);
    const syncMode = ref('file');
    const syncFilePath = ref('');
    const syncTitle = ref('');
    const syncMarkdown = ref('');
    const syncFileName = ref('');
    const syncFileContent = ref('');
    const syncSubmitting = ref(false);

    const loadLaws = async () => {
      lawsLoading.value = true;
      try {
        const response = await apiClient.get('/knowledge/laws');
        laws.value = response.data.data || [];
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '法律列表加载失败。');
        laws.value = [];
      } finally {
        lawsLoading.value = false;
      }
    };

    const handleLawExpandChange = async (row, expandedRows) => {
      const isExpanded = Array.isArray(expandedRows)
        ? expandedRows.some((r) => r.id === row.id)
        : Boolean(expandedRows);
      if (!isExpanded) return;
      if (lawVersionsMap.value[row.title]) return;
      versionsLoadingTitle.value = row.title;
      try {
        const response = await apiClient.get('/knowledge/laws/versions', { params: { title: row.title } });
        lawVersionsMap.value[row.title] = response.data.data || [];
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '版本时间线加载失败。');
        lawVersionsMap.value[row.title] = [];
      } finally {
        versionsLoadingTitle.value = '';
      }
    };

    const openSyncDialog = () => {
      syncMode.value = 'upload';
      syncFilePath.value = '';
      syncTitle.value = '';
      syncMarkdown.value = '';
      syncFileName.value = '';
      syncFileContent.value = '';
      syncDialogVisible.value = true;
    };

    const handleSyncFileChange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        syncFileName.value = '';
        syncFileContent.value = '';
        return;
      }
      syncFileName.value = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        syncFileContent.value = String(ev.target.result || '');
      };
      reader.onerror = () => {
        ElMessage.error('文件读取失败。');
        syncFileName.value = '';
        syncFileContent.value = '';
      };
      reader.readAsText(file);
    };

    // 前端预校验法律 Markdown 格式,避免不符合模板的文件提交后后端解析失败
    const looksLikeLegalMarkdown = (content) => String(content || '').includes('<!-- INFO END -->')
      && /^第[〇零一二两三四五六七八九十百千万亿\d]+条/m.test(content);

    const submitSync = async () => {
      let payload;
      if (syncMode.value === 'upload') {
        if (!syncFileContent.value.trim()) {
          ElMessage.warning('请选择法律 Markdown 文件。');
          return;
        }
        if (!looksLikeLegalMarkdown(syncFileContent.value)) {
          ElMessage.error('文件格式不符合法律 Markdown 模板要求：需包含 INFO 区块结束标记(<!-- INFO END -->)与"第X条"条文。请先下载模板参考。');
          return;
        }
        payload = { markdown: syncFileContent.value };
      } else if (syncMode.value === 'file') {
        payload = { filePath: syncFilePath.value.trim() };
        if (!payload.filePath) {
          ElMessage.warning('请输入法律 Markdown 文件路径。');
          return;
        }
      } else {
        payload = { title: syncTitle.value.trim(), markdown: syncMarkdown.value };
        if (!payload.title) {
          ElMessage.warning('请输入法律名称。');
          return;
        }
        if (!payload.markdown.trim()) {
          ElMessage.warning('请粘贴法律 Markdown 内容。');
          return;
        }
      }
      syncSubmitting.value = true;
      try {
        const response = await apiClient.post('/knowledge/laws/sync', payload);
        const result = response.data.data;
        ElMessage.success(`同步成功：${result.title}（${result.version_label}），共 ${result.clauseCount} 个条文。`);
        syncDialogVisible.value = false;
        lawVersionsMap.value = {};
        await loadLaws();
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '法律同步失败。');
      } finally {
        syncSubmitting.value = false;
      }
    };

    onMounted(() => {
      loadLaws();
    });

    return {
      laws,
      lawsLoading,
      lawVersionsMap,
      versionsLoadingTitle,
      syncDialogVisible,
      syncMode,
      syncFilePath,
      syncTitle,
      syncMarkdown,
      syncFileName,
      syncSubmitting,
      lawStatusTagType,
      loadLaws,
      handleLawExpandChange,
      openSyncDialog,
      handleSyncFileChange,
      submitSync,
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

.panel-title p,
.muted {
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

.law-table {
  margin-top: 8px;
  width: 100%;
}

.law-versions {
  padding: 8px 16px;
  min-height: 40px;
}

.version-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-label {
  font-weight: 800;
  font-size: 13px;
}

.version-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #666666;
}

.version-link {
  color: #2563eb;
  text-decoration: underline;
}

.version-superseded {
  color: #d97706;
}

.version-synced {
  color: #999999;
}

.sync-mode-group {
  margin-bottom: 16px;
}

.sync-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sync-field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.sync-label {
  font-size: 12px;
  font-weight: 800;
  color: #666666;
}

.sync-file-input {
  font-size: 13px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

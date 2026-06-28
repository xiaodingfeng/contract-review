<template>
  <section class="standard-clauses-panel">
    <header class="panel-header">
      <div>
        <h3>行业标准条款库</h3>
        <p class="hint-text">维护公司/行业标准条款，审查时自动对比合同条款与标准条款差异，提示"贵司标准与行业惯例的差异"。公共库条款由系统预置(只读)，私有库条款可由您上传/编辑/删除。</p>
      </div>
      <div class="panel-actions">
        <el-select v-model="standardFilter.category" placeholder="全部分类" clearable size="small" @change="loadStandards" style="width:140px">
          <el-option v-for="opt in standardCategories" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select v-model="standardFilter.owner" placeholder="全部来源" clearable size="small" @change="loadStandards" style="width:140px">
          <el-option label="公共库" value="public" />
          <el-option label="我的私有库" value="mine" />
        </el-select>
        <button @click="openStandardEditor(null)" class="primary-btn">+ 新增条款</button>
      </div>
    </header>

    <!-- 分类快捷筛选 -->
    <div class="category-quick-filter">
      <span class="quick-filter-label">快捷筛选:</span>
      <button
        @click="standardFilter.category = ''; loadStandards()"
        :class="['quick-filter-chip', !standardFilter.category ? 'active' : '']"
      >全部</button>
      <button
        v-for="opt in standardCategories"
        :key="'qf-' + opt.value"
        @click="standardFilter.category = opt.value; loadStandards()"
        :class="['quick-filter-chip', standardFilter.category === opt.value ? 'active' : '']"
      >{{ opt.label }}</button>
    </div>

    <div v-if="standardsLoading" class="muted">加载中...</div>
    <div v-else-if="standards.length === 0" class="empty-state">
      <p class="empty-title">暂无标准条款</p>
      <p class="empty-desc">点击右上方"新增条款"上传您的公司标准条款，审查时将自动与合同条款对比差异。</p>
    </div>
    <div v-else class="standards-list">
      <div v-for="std in standards" :key="std.id" class="standard-item">
        <div class="standard-item-header">
          <span class="standard-category-tag">{{ standardCategoryLabel(std.category) }}</span>
          <span class="standard-title">{{ std.title || std.category }}</span>
          <span v-if="std.owner_type === 'public'" class="owner-tag public">公共</span>
          <span v-else class="owner-tag private">私有</span>
          <span v-if="std.industry" class="industry-tag">{{ std.industry }}</span>
        </div>
        <p class="standard-text">{{ std.clause_text }}</p>
        <div v-if="std.applicable_contract_types && std.applicable_contract_types.length" class="applicable-types-row">
          <span class="meta-label">适用合同:</span>
          <span v-for="t in std.applicable_contract_types" :key="t" class="applicable-type-chip">{{ contractTypeLabel(t) }}</span>
        </div>
        <div class="standard-item-footer">
          <span class="meta-text">版本 v{{ std.version }}</span>
          <div v-if="std.canEdit" class="action-group">
            <button @click="openStandardEditor(std)" class="link-btn">编辑</button>
            <button @click="deleteStandard(std)" class="link-btn danger">删除</button>
          </div>
          <span v-else class="meta-text muted">只读</span>
        </div>
      </div>
    </div>

    <!-- 标准条款编辑弹窗 -->
    <el-dialog v-model="standardEditorVisible" :title="standardForm.id ? '编辑标准条款' : '新增标准条款'" width="600px" append-to-body>
      <div class="standard-form">
        <div class="form-row">
          <label>分类<span class="required">*</span></label>
          <el-select v-model="standardForm.category" placeholder="选择分类" style="width:100%">
            <el-option v-for="opt in standardCategories" :key="opt.value" :label="opt.label" :value="opt.value">
              <span>{{ opt.label }}</span>
              <el-tooltip :content="opt.tip" placement="right" effect="dark">
                <span class="option-tip-hint">?</span>
              </el-tooltip>
            </el-option>
          </el-select>
        </div>
        <div class="form-row">
          <label>标题</label>
          <el-input v-model="standardForm.title" placeholder="如：保密义务标准条款" />
        </div>
        <div class="form-row">
          <label>条款正文<span class="required">*</span></label>
          <el-input v-model="standardForm.clause_text" type="textarea" :rows="6" placeholder="粘贴或输入标准条款正文" show-word-limit :maxlength="2000" />
        </div>
        <div class="form-row">
          <label>所属行业</label>
          <el-select v-model="standardForm.industry" placeholder="选择或输入行业" filterable allow-create default-first-option style="width:100%">
            <el-option v-for="ind in industryOptions" :key="ind" :label="ind" :value="ind" />
          </el-select>
        </div>
        <div class="form-row">
          <label>适用合同类型</label>
          <el-select v-model="standardForm.applicable_contract_types" multiple filterable placeholder="选择适用的合同类型(可多选)" style="width:100%">
            <el-option v-for="opt in contractTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <p class="hint-text">审查时，只有合同类型匹配的标准条款才会被自动对比</p>
        </div>
      </div>
      <template #footer>
        <button @click="standardEditorVisible = false" class="link-btn">取消</button>
        <button @click="saveStandard" :disabled="standardSaving" class="primary-btn">{{ standardSaving ? '保存中...' : '保存' }}</button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { onMounted, reactive, ref } from 'vue';
import { ElDialog, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElTooltip } from 'element-plus';
import api, { apiClient } from '../../api';
import {
  contractTypeOptions,
  contractTypeLabel,
  industryOptions,
  standardCategories,
  standardCategoryLabel,
} from '../../composables/useSettingsShared';

export default {
  name: 'StandardClausesTab',
  components: { ElDialog, ElInput, ElOption, ElSelect, ElTooltip },
  setup() {
    const standards = ref([]);
    const standardsLoading = ref(false);
    const standardFilter = reactive({ category: '', owner: '' });
    const standardEditorVisible = ref(false);
    const standardSaving = ref(false);
    const standardForm = reactive({
      id: null,
      category: '',
      title: '',
      clause_text: '',
      industry: '通用',
      applicable_contract_types: [],
    });

    const loadStandards = async () => {
      standardsLoading.value = true;
      try {
        const params = {};
        if (standardFilter.category) params.category = standardFilter.category;
        if (standardFilter.owner) params.owner = standardFilter.owner;
        const response = await apiClient.get('/standards', { params });
        standards.value = response.data?.items || [];
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '加载标准条款失败');
        standards.value = [];
      } finally {
        standardsLoading.value = false;
      }
    };

    const openStandardEditor = (std) => {
      if (std) {
        standardForm.id = std.id;
        standardForm.category = std.category;
        standardForm.title = std.title || '';
        standardForm.clause_text = std.clause_text || '';
        standardForm.industry = std.industry || '通用';
        standardForm.applicable_contract_types = Array.isArray(std.applicable_contract_types)
          ? [...std.applicable_contract_types] : [];
      } else {
        standardForm.id = null;
        standardForm.category = '';
        standardForm.title = '';
        standardForm.clause_text = '';
        standardForm.industry = '通用';
        standardForm.applicable_contract_types = [];
      }
      standardEditorVisible.value = true;
    };

    const saveStandard = async () => {
      if (!standardForm.category || !standardForm.clause_text.trim()) {
        ElMessage.warning('分类与条款正文必填');
        return;
      }
      standardSaving.value = true;
      try {
        const payload = {
          category: standardForm.category,
          title: standardForm.title,
          clause_text: standardForm.clause_text,
          industry: standardForm.industry,
          applicable_contract_types: [...standardForm.applicable_contract_types],
        };
        if (standardForm.id) {
          await api.updateStandard(standardForm.id, payload);
          ElMessage.success('已更新');
        } else {
          await api.createStandard(payload);
          ElMessage.success('已新增');
        }
        standardEditorVisible.value = false;
        await loadStandards();
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '保存失败');
      } finally {
        standardSaving.value = false;
      }
    };

    const deleteStandard = async (std) => {
      try {
        await ElMessageBox.confirm(`确认删除标准条款「${std.title || std.category}」?`, '确认删除', { type: 'warning' });
        await api.deleteStandard(std.id);
        ElMessage.success('已删除');
        await loadStandards();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败');
      }
    };

    onMounted(() => {
      loadStandards();
    });

    return {
      standards,
      standardsLoading,
      standardFilter,
      standardEditorVisible,
      standardSaving,
      standardForm,
      standardCategories,
      industryOptions,
      contractTypeOptions,
      contractTypeLabel,
      standardCategoryLabel,
      loadStandards,
      openStandardEditor,
      saveStandard,
      deleteStandard,
    };
  },
};
</script>

<style scoped>
.standard-clauses-panel { padding: 8px 4px; }
.standard-clauses-panel .panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.standard-clauses-panel .panel-header h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #111827; }
.standard-clauses-panel .panel-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.standard-clauses-panel .primary-btn { background: #2563eb; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.standard-clauses-panel .primary-btn:hover { background: #1d4ed8; }
.standard-clauses-panel .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.standard-clauses-panel .muted { color: #6b7280; font-size: 13px; padding: 24px 0; text-align: center; }
.standards-list { display: flex; flex-direction: column; gap: 12px; }
.standard-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
.standard-item-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.standard-category-tag { background: #dbeafe; color: #1e40af; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.standard-title { font-weight: 600; color: #111827; font-size: 14px; }
.owner-tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 500; }
.owner-tag.public { background: #dcfce7; color: #166534; }
.owner-tag.private { background: #fef3c7; color: #92400e; }
.industry-tag { font-size: 11px; padding: 1px 6px; background: #f3f4f6; color: #4b5563; border-radius: 4px; }
.standard-text { margin: 6px 0 10px; color: #374151; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.standard-item-footer { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.standard-item-footer .meta-text { color: #6b7280; }
.standard-item-footer .action-group { display: flex; gap: 12px; }
.link-btn { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 2px 4px; }
.link-btn:hover { text-decoration: underline; }
.link-btn.danger { color: #dc2626; }
.standard-form .form-row { margin-bottom: 12px; }
.standard-form .form-row label { display: block; margin-bottom: 4px; font-size: 13px; color: #374151; font-weight: 500; }
.standard-form .form-row .required { color: #dc2626; margin-left: 2px; }
.standard-form .hint-text, .hint-text { font-size: 12px; color: #6b7280; line-height: 1.5; }
.standard-form .hint-text { margin: 4px 0 0; }
.hint-text { margin-top: 6px; }
.category-quick-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; padding: 8px 10px; background: #f9fafb; border-radius: 6px; }
.category-quick-filter .quick-filter-label { font-size: 12px; color: #6b7280; margin-right: 4px; }
.quick-filter-chip { background: #fff; border: 1px solid #e5e7eb; color: #374151; font-size: 12px; padding: 3px 10px; border-radius: 12px; cursor: pointer; transition: all 0.15s; }
.quick-filter-chip:hover { border-color: #2563eb; color: #2563eb; }
.quick-filter-chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.empty-state { text-align: center; padding: 40px 20px; }
.empty-state .empty-title { font-size: 15px; font-weight: 600; color: #374151; margin: 0 0 8px; }
.empty-state .empty-desc { font-size: 13px; color: #6b7280; margin: 0; line-height: 1.6; }
.applicable-types-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 6px 0 10px; }
.applicable-types-row .meta-label { font-size: 11px; color: #6b7280; }
.applicable-type-chip { font-size: 11px; padding: 1px 6px; background: #ede9fe; color: #5b21b6; border-radius: 4px; border: 1px solid #ddd6fe; }
.option-tip-hint { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-left: 6px; border-radius: 50%; background: #e5e7eb; color: #6b7280; font-size: 10px; font-weight: 700; }
</style>

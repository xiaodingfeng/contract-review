<template>
  <section class="panel">
    <div class="panel-title">
      <div>
        <h2>审查模板管理</h2>
        <p>在线管理审查模板，支持编辑、版本回滚与语义匹配。系统模板可编辑不可删除。</p>
      </div>
      <div class="template-actions">
        <button class="primary-button" @click="createTemplate">新建模板</button>
        <button class="secondary-button" :disabled="!currentTemplate" @click="saveTemplate">保存</button>
        <button class="secondary-button" :disabled="!currentTemplate" @click="openVersionsDrawer">版本历史</button>
      </div>
    </div>

    <div class="template-layout">
      <!-- 左侧:模板列表 -->
      <div class="template-list-panel">
        <el-table
          :data="templates"
          v-loading="templatesLoading"
          size="small"
          highlight-current-row
          @current-change="selectTemplate"
          class="template-table"
          empty-text="暂无模板"
        >
          <el-table-column prop="name" label="名称" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">
              <svg v-if="row.is_system" class="template-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="系统模板"><path stroke-linecap="round" stroke-linejoin="round" d="M12 11V7a4 4 0 00-8 0v4M5 11h14v10H5V11z" /></svg>
              {{ row.name }}
            </template>
          </el-table-column>
          <el-table-column label="启用" width="70">
            <template #default="{ row }">
              <el-switch v-model="row.is_active" @change="toggleTemplateActive(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <button v-if="!row.is_system" class="text-danger" @click.stop="deleteTemplate(row)">删除</button>
              <span v-else class="muted">系统</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 右侧:编辑面板 -->
      <div class="template-edit-panel" v-if="currentTemplate">
        <div class="template-field">
          <label>
            ID
            <el-tooltip placement="top" content="模板唯一标识,英文+下划线(如 labor、custom_labor)。创建后不可修改,系统模板禁用编辑。"><span class="field-hint">?</span></el-tooltip>
          </label>
          <el-input v-model="currentTemplate.id" :disabled="currentTemplate.is_system || !currentTemplate._isNew" placeholder="模板唯一标识,如 custom_labor" />
        </div>
        <div class="template-field">
          <label>
            名称
            <el-tooltip placement="top" :content="'展示给用户的中文名称,如「劳动合同审查模板」。会出现在审查页面的模板下拉选项中。'"><span class="field-hint">?</span></el-tooltip>
          </label>
          <el-input v-model="currentTemplate.name" placeholder="模板名称" />
        </div>

        <div class="template-field">
          <label>
            合同类型关键词
            <el-tooltip placement="top" :content="'用于合同识别。系统匹配合同时,若合同正文或类型命中这些关键词,则优先使用本模板。建议填写该合同类型的常见关键词,如「劳动」「雇佣」「offer」。'"><span class="field-hint">?</span></el-tooltip>
          </label>
          <div class="tag-editor">
            <el-tag
              v-for="(tag, idx) in currentTemplate.contract_type_keywords"
              :key="'kw-' + idx"
              closable
              @close="currentTemplate.contract_type_keywords.splice(idx, 1)"
            >{{ tag }}</el-tag>
            <el-input v-model="newKeyword" size="small" class="tag-input" placeholder="回车添加" @keyup.enter="addTag(currentTemplate.contract_type_keywords, newKeyword, 'newKeyword')" />
          </div>
        </div>

        <div class="template-field">
          <label>
            审查要点
            <el-tooltip placement="top" content="本模板关注的具体审查点列表。会展示给用户勾选,并影响 AI 审查的重点覆盖范围。每条建议简明描述一个审查维度。"><span class="field-hint">?</span></el-tooltip>
          </label>
          <div class="input-list">
            <div v-for="(point, idx) in currentTemplate.review_points" :key="'rp-' + idx" class="input-row">
              <el-input v-model="currentTemplate.review_points[idx]" size="small" />
              <button class="text-danger" @click="currentTemplate.review_points.splice(idx, 1)">移除</button>
            </div>
            <button class="secondary-button template-add-btn" @click="currentTemplate.review_points.push('')">+ 添加审查要点</button>
          </div>
        </div>

        <div class="template-field">
          <label>
            核心目的
            <el-tooltip placement="top" :content="'本模板的审查目标说明。会注入 AI prompt 影响审查方向,建议每条用一句话描述一个目标,如「核查试用期上限合法性」。'"><span class="field-hint">?</span></el-tooltip>
          </label>
          <div class="input-list">
            <div v-for="(purpose, idx) in currentTemplate.core_purposes" :key="'cp-' + idx" class="input-row">
              <el-input v-model="currentTemplate.core_purposes[idx]" size="small" />
              <button class="text-danger" @click="currentTemplate.core_purposes.splice(idx, 1)">移除</button>
            </div>
            <button class="secondary-button template-add-btn" @click="currentTemplate.core_purposes.push('')">+ 添加核心目的</button>
          </div>
        </div>

        <div class="template-field">
          <label>
            提示词规则
            <el-tooltip placement="top" :content="'对 AI 的硬性约束规则,如「竞业限制期限不得超过两年」。每条规则会拼接到 AI prompt 中,用于强制约束 AI 输出符合法规。'"><span class="field-hint">?</span></el-tooltip>
          </label>
          <div class="input-list">
            <div v-for="(rule, idx) in currentTemplate.prompt_rules" :key="'pr-' + idx" class="input-row">
              <el-input v-model="currentTemplate.prompt_rules[idx]" size="small" />
              <button class="text-danger" @click="currentTemplate.prompt_rules.splice(idx, 1)">移除</button>
            </div>
            <button class="secondary-button template-add-btn" @click="currentTemplate.prompt_rules.push('')">+ 添加提示词规则</button>
          </div>
        </div>

        <div class="template-field">
          <label>
            报告章节
            <el-tooltip placement="top" :content="'审查报告包含的章节。从预设选项中选择,AI 会按这些章节生成报告结构。不同合同类型可组合不同章节,如劳动合同可选「劳动合规」。'"><span class="field-hint">?</span></el-tooltip>
          </label>
          <el-select
            v-model="currentTemplate.report_sections"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择报告包含的章节"
            class="w-full"
          >
            <el-option
              v-for="opt in REPORT_SECTION_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>

        <div class="template-field">
          <label>
            典型描述
            <el-tooltip placement="top" content="用于语义匹配的模板描述文本。留空时保存会自动根据名称、审查要点、核心目的生成。配置 embedding 服务后启用语义匹配,未配置则降级为关键词匹配。"><span class="field-hint">?</span></el-tooltip>
          </label>
          <el-input v-model="currentTemplate.typical_description" type="textarea" :rows="3" placeholder="留空保存时将根据名称、审查要点、核心目的自动生成" />
        </div>
      </div>

      <div class="template-edit-panel muted" v-else>请选择左侧模板或点击"新建模板"。</div>
    </div>

    <el-drawer v-model="versionsDrawerVisible" title="版本历史" size="42%">
      <div v-loading="versionsLoading">
        <p v-if="!templateVersions.length && !versionsLoading" class="muted">暂无版本记录。每次编辑保存后会自动生成版本快照。</p>
        <div v-for="ver in templateVersions" :key="ver.id" class="version-card">
          <div class="version-card-header">
            <span class="version-label">版本 {{ ver.version }}</span>
            <span class="muted">{{ ver.created_at }}</span>
          </div>
          <div class="version-card-meta muted" v-if="ver.changed_by">操作者:{{ ver.changed_by }}</div>
          <button class="secondary-button" @click="revertVersion(ver.version)">回滚到此版本</button>
        </div>
      </div>
    </el-drawer>
  </section>
</template>

<script>
import { onMounted, ref } from 'vue';
import { ElDrawer, ElInput, ElLoading, ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag, ElTooltip } from 'element-plus';
import { apiClient } from '../../api';
import { REPORT_SECTION_OPTIONS } from '../../composables/useSettingsShared';

export default {
  name: 'ReviewTemplatesTab',
  components: { ElDrawer, ElInput, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag, ElTooltip },
  directives: { loading: ElLoading.directive },
  setup() {
    const templates = ref([]);
    const templatesLoading = ref(false);
    const currentTemplate = ref(null);
    const newKeyword = ref('');
    const templateVersions = ref([]);
    const versionsDrawerVisible = ref(false);
    const versionsLoading = ref(false);

    const loadTemplates = async () => {
      templatesLoading.value = true;
      try {
        const response = await apiClient.get('/templates', { params: { page: 1, page_size: 100 } });
        templates.value = response.data.items || [];
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '模板列表加载失败。');
        templates.value = [];
      } finally {
        templatesLoading.value = false;
      }
    };

    const selectTemplate = (row) => {
      if (!row) return;
      currentTemplate.value = JSON.parse(JSON.stringify({ ...row, _isNew: false }));
    };

    const createTemplate = () => {
      currentTemplate.value = {
        id: '',
        name: '',
        contract_type_keywords: [],
        review_points: [],
        core_purposes: [],
        report_sections: [],
        prompt_rules: [],
        typical_description: '',
        is_active: true,
        is_system: false,
        _isNew: true,
      };
    };

    const saveTemplate = async () => {
      const t = currentTemplate.value;
      if (!t) return;
      if (!t.id || !t.name) {
        ElMessage.warning('ID 和名称为必填项。');
        return;
      }
      try {
        const payload = {
          name: t.name,
          contract_type_keywords: t.contract_type_keywords,
          review_points: t.review_points,
          core_purposes: t.core_purposes,
          report_sections: t.report_sections,
          prompt_rules: t.prompt_rules,
          typical_description: t.typical_description,
          is_active: t.is_active,
        };
        if (t._isNew) {
          payload.id = t.id;
          await apiClient.post('/templates', payload);
          ElMessage.success('模板创建成功。');
        } else {
          await apiClient.put('/templates/' + encodeURIComponent(t.id), payload);
          ElMessage.success('模板保存成功。');
        }
        await loadTemplates();
        currentTemplate.value = null;
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '模板保存失败。');
      }
    };

    const deleteTemplate = async (row) => {
      try {
        await ElMessageBox.confirm(`确认删除模板"${row.name}"?`, '确认删除', { type: 'warning' });
        await apiClient.delete('/templates/' + encodeURIComponent(row.id));
        ElMessage.success('模板已删除。');
        if (currentTemplate.value && currentTemplate.value.id === row.id) {
          currentTemplate.value = null;
        }
        await loadTemplates();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    const toggleTemplateActive = async (row) => {
      try {
        await apiClient.put('/templates/' + encodeURIComponent(row.id), {
          name: row.name,
          contract_type_keywords: row.contract_type_keywords,
          review_points: row.review_points,
          core_purposes: row.core_purposes,
          report_sections: row.report_sections,
          prompt_rules: row.prompt_rules,
          typical_description: row.typical_description,
          is_active: row.is_active,
        });
        ElMessage.success(row.is_active ? '已启用。' : '已停用。');
      } catch (error) {
        row.is_active = !row.is_active;
        ElMessage.error(error.response?.data?.error || '状态更新失败。');
      }
    };

    const openVersionsDrawer = async () => {
      if (!currentTemplate.value) return;
      versionsDrawerVisible.value = true;
      await loadVersions(currentTemplate.value.id);
    };

    const loadVersions = async (templateId) => {
      versionsLoading.value = true;
      try {
        const response = await apiClient.get('/templates/' + encodeURIComponent(templateId) + '/versions');
        templateVersions.value = response.data.items || [];
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '版本历史加载失败。');
        templateVersions.value = [];
      } finally {
        versionsLoading.value = false;
      }
    };

    const revertVersion = async (version) => {
      if (!currentTemplate.value) return;
      try {
        await ElMessageBox.confirm(`确认回滚到版本 ${version}?当前状态会先保存为新版本。`, '确认回滚', { type: 'warning' });
        await apiClient.post('/templates/' + encodeURIComponent(currentTemplate.value.id) + '/revert/' + version);
        ElMessage.success('已回滚到版本 ' + version + '。');
        versionsDrawerVisible.value = false;
        await loadTemplates();
        currentTemplate.value = null;
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '回滚失败。');
      }
    };

    const addTag = (arr, value, resetKey) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      arr.push(trimmed);
      if (resetKey === 'newKeyword') newKeyword.value = '';
    };

    onMounted(() => {
      loadTemplates();
    });

    return {
      templates,
      templatesLoading,
      currentTemplate,
      newKeyword,
      REPORT_SECTION_OPTIONS,
      templateVersions,
      versionsDrawerVisible,
      versionsLoading,
      loadTemplates,
      selectTemplate,
      createTemplate,
      saveTemplate,
      deleteTemplate,
      toggleTemplateActive,
      openVersionsDrawer,
      revertVersion,
      addTag,
    };
  },
};
</script>

<style scoped>
.panel { margin-top: 8px; border-radius: 8px; padding: 12px; background: #ffffff; box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04); }
.panel-title { display: flex; align-items: center; justify-content: space-between; gap: 9px; }
.panel-title h2 { margin: 0; font-size: 16px; letter-spacing: 0; }
.panel-title p, .muted { margin: 4px 0 0; color: #666666; line-height: 1.45; }
.template-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
button { border: 0; border-radius: 8px; font-weight: 800; cursor: pointer; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.primary-button, .secondary-button { min-height: 32px; padding: 0 10px; white-space: nowrap; font-size: 12px; }
.primary-button { background: #111111; color: #ffffff; }
.secondary-button { background: #ffffff; color: #111111; box-shadow: inset 0 0 0 1px #e5e5e5; }
.text-danger { background: transparent; padding: 0; font-size: 12px; line-height: 1.2; color: #ef4444; }
.template-layout { margin-top: 8px; display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 12px; align-items: start; }
.template-list-panel { border-radius: 8px; padding: 8px; background: #fafafa; box-shadow: inset 0 0 0 1px #e5e5e5; }
.template-table { width: 100%; }
.template-lock-icon { width: 13px; height: 13px; vertical-align: -2px; margin-right: 3px; color: #d97706; }
.template-edit-panel { border-radius: 8px; padding: 12px; background: #fafafa; box-shadow: inset 0 0 0 1px #e5e5e5; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.template-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.template-field label { font-size: 12px; font-weight: 800; color: #666666; display: inline-flex; align-items: center; gap: 4px; }
.field-hint { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: #e5e7eb; color: #6b7280; font-size: 10px; font-weight: 700; cursor: help; line-height: 1; }
.tag-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tag-input { width: 160px; }
.input-list { display: flex; flex-direction: column; gap: 6px; }
.input-row { display: flex; align-items: center; gap: 8px; }
.input-row .el-input { flex: 1; }
.template-add-btn { align-self: flex-start; }
.version-card { border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa; box-shadow: inset 0 0 0 1px #e5e5e5; display: flex; flex-direction: column; gap: 6px; }
.version-card-header { display: flex; justify-content: space-between; align-items: center; }
.version-card-meta { font-size: 12px; }
.version-label { font-weight: 800; font-size: 13px; }
@media (max-width: 780px) { .template-layout { grid-template-columns: 1fr; } }
</style>

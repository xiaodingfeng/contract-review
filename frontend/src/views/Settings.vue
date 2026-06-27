<template>
  <main class="settings-page">
    <section class="settings-head">
      <p class="eyebrow">知识库</p>
      <h1>管理审查依据</h1>
      <p>检索、导入和删除法律条文、裁判文书、审查规则。删除失效依据后，后续审查会使用新的知识库结果。</p>
    </section>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="知识库管理" name="knowledge">

    <section class="panel list-panel">
      <!-- 向量数据库为空时的提示 -->
      <div v-if="vectorStatusChecked && !vectorStatus.hasData && !rebuilding" class="vector-empty-banner">
        <div class="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div>
            <p class="font-semibold text-sm">向量数据库尚未构建</p>
            <p class="text-xs text-gray-500">知识检索和合同审查需要向量数据库支持，请点击"重建向量数据库"进行初始化。</p>
          </div>
        </div>
      </div>

      <!-- 重建进度面板 -->
      <div v-if="rebuilding" class="rebuild-progress-panel">
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold text-sm">{{ rebuildPhaseLabel }}</span>
          <span class="text-xs text-gray-500">{{ rebuildPercent }}%</span>
        </div>
        <el-progress :percentage="rebuildPercent" :stroke-width="8" :status="rebuildError ? 'exception' : ''" />
        <div v-if="rebuildFileName" class="mt-2 text-xs text-gray-600 truncate">
          <span class="text-gray-400">正在处理：</span>{{ rebuildFileName }}
        </div>
        <div v-if="rebuildChunks > 0" class="text-xs text-gray-400 mt-1">
          已生成 {{ rebuildChunks }} 个切片
        </div>
        <div v-if="rebuildError" class="mt-2 text-xs text-red-500">{{ rebuildError }}</div>
      </div>

      <div class="panel-title">
        <div>
          <h2>知识列表</h2>
          <p>分页查看知识切片，用于定位和删除失效文档。</p>
        </div>
        <div class="flex gap-2">
          <button class="primary-button" @click="loadKnowledge">刷新</button>
          <button class="secondary-button" :disabled="rebuilding" @click="rebuildVectorDatabase">
            {{ rebuilding ? '重建中...' : '重建向量数据库' }}
          </button>
        </div>
      </div>

      <div class="toolbar">
        <el-input v-model="searchQuery" placeholder="搜索标题、条号、来源或正文" @keyup.enter="reloadFirstPage" />
        <el-select v-model="sourceType" placeholder="全部类型" clearable @change="reloadFirstPage">
          <el-option label="法律条文" value="law" />
          <el-option label="裁判文书" value="case" />
          <el-option label="审查规则" value="rule" />
          <el-option label="审查知识" value="guide" />
        </el-select>
        <el-select v-model="lawFilter" placeholder="法律时效" clearable @change="reloadFirstPage">
          <el-option label="现行有效" value="现行" />
          <el-option label="已修订" value="已修订" />
          <el-option label="已废止" value="已废止" />
        </el-select>
        <button class="secondary-button" @click="reloadFirstPage">查询</button>
        <button class="danger-button" :disabled="!sourceType" @click="deleteByType">删除当前类型</button>
      </div>

      <div class="knowledge-list">
        <p v-if="loading" class="muted">正在加载...</p>
        <p v-else-if="items.length === 0" class="muted">没有匹配的知识。</p>
        <article v-for="item in items" :key="item.id || item.source_id" class="knowledge-item">
          <header>
            <div>
              <h3 :title="item.title">{{ item.title }}</h3>
              <p :title="item.source_name || item.category || '未标注来源'">{{ item.source_name || item.category || '未标注来源' }}</p>
            </div>
            <div class="item-meta">
              <el-tag v-if="item.law_status && item.law_status !== '现行'" :type="lawStatusTagType(item.law_status)" size="small">{{ item.law_status }}</el-tag>
              <span :title="`${sourceLabel(item.source_type)}${item.clause_id ? ` / ${item.clause_id}` : ''}`">
                {{ sourceLabel(item.source_type) }}{{ item.clause_id ? ` / ${item.clause_id}` : '' }}
              </span>
            </div>
          </header>
          <p class="content" :title="item.content">{{ item.content }}</p>
          <footer>
            <small :title="item.source_id">{{ item.source_id }}</small>
            <div class="item-actions">
              <button class="text-button" @click="showKnowledgeDetail(item)">查看详情</button>
              <button class="text-danger" @click="deleteOne(item)">删除</button>
            </div>
          </footer>
        </article>
      </div>

      <div class="pager">
        <button :disabled="page === 1" @click="changePage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
        <button :disabled="page === totalPages" @click="changePage(page + 1)">下一页</button>
      </div>
    </section>

    <section class="panel retrieval-panel">
      <div class="panel-title">
        <div>
          <h2>知识检索模拟</h2>
          <p>模拟合同审查和智能问答使用知识库时的向量数据库检索、向量模型检索和重排序检索。</p>
        </div>
        <button class="primary-button" :disabled="retrievalLoading" @click="runKnowledgeRetrieval">
          {{ retrievalLoading ? '检索中...' : '模拟检索' }}
        </button>
      </div>

      <div class="retrieval-toolbar">
        <el-input v-model="retrievalQuery" placeholder="输入合同条款、审查问题或问答问题" @keyup.enter="runKnowledgeRetrieval" />
        <el-select v-model="retrievalScenario" placeholder="应用场景">
          <el-option label="合同审查" value="contract_review" />
          <el-option label="智能问答" value="qa" />
        </el-select>
        <el-select v-model="retrievalMode" placeholder="检索方式">
          <el-option label="向量数据库检索" value="vector_db" />
          <el-option label="向量模型检索" value="vector_model" />
          <el-option label="重排序检索" value="rerank" />
        </el-select>
        <el-select v-model="retrievalSourceType" placeholder="全部类型" clearable>
          <el-option label="法律条文" value="law" />
          <el-option label="裁判文书" value="case" />
          <el-option label="审查规则" value="rule" />
          <el-option label="审查知识" value="guide" />
        </el-select>
      </div>

      <div class="retrieval-summary">
        <span>{{ retrievalModeLabel }}</span>
        <span>{{ retrievalScenarioLabel }}</span>
        <span>Top {{ retrievalLimit }}</span>
      </div>

      <div class="knowledge-list retrieval-list">
        <p v-if="retrievalLoading" class="muted">正在模拟知识检索...</p>
        <p v-else-if="retrievalResults.length === 0" class="muted">输入检索内容后，可查看带相似度的知识命中结果。</p>
        <article v-for="item in retrievalResults" :key="`retrieval-${item.id || item.source_id}`" class="knowledge-item">
          <header>
            <div>
              <h3 :title="item.title">{{ item.title }}</h3>
              <p :title="item.source_name || item.category || '未标注来源'">{{ item.source_name || item.category || '未标注来源' }}</p>
            </div>
            <span :title="`${sourceLabel(item.source_type)}${item.clause_id ? ` / ${item.clause_id}` : ''}`">
              {{ sourceLabel(item.source_type) }}{{ item.clause_id ? ` / ${item.clause_id}` : '' }}
            </span>
          </header>
          <p class="content" :title="item.content">{{ item.content }}</p>
          <footer>
            <small :title="item.source_id">{{ item.source_id }}</small>
            <div class="retrieval-actions">
              <strong>相似度 {{ similarityPercent(item) }}</strong>
              <button class="text-button" @click="showKnowledgeDetail(item)">查看详情</button>
            </div>
          </footer>
        </article>
      </div>
    </section>

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
    </section>

      </el-tab-pane>

      <el-tab-pane label="审查模板管理" name="review-templates">
        <section class="panel">
          <div class="panel-title">
            <div>
              <h2>审查模板管理</h2>
              <p>在线管理审查模板,支持编辑、版本回滚与语义匹配。系统模板可编辑不可删除。</p>
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
        </section>
      </el-tab-pane>

      <!-- 4.3 行业标准条款库 -->
      <el-tab-pane label="标准条款库" name="standard-clauses">
        <section class="standard-clauses-panel">
          <header class="panel-header">
            <div>
              <h3>行业标准条款库</h3>
              <p class="hint-text">维护公司/行业标准条款,审查时自动对比合同条款与标准条款差异,提示"贵司标准与行业惯例的差异"。公共库条款由系统预置(只读),私有库条款可由您上传/编辑/删除。</p>
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
            <p class="empty-desc">点击右上方"新增条款"上传您的公司标准条款,审查时将自动与合同条款对比差异。</p>
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
        </section>
      </el-tab-pane>
    </el-tabs>

    <!-- 4.3 标准条款编辑弹窗 -->
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
          <el-input v-model="standardForm.title" placeholder="如:保密义务标准条款" />
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
          <p class="hint-text">审查时,只有合同类型匹配的标准条款才会被自动对比</p>
        </div>
      </div>
      <template #footer>
        <button @click="standardEditorVisible = false" class="link-btn">取消</button>
        <button @click="saveStandard" :disabled="standardSaving" class="primary-btn">{{ standardSaving ? '保存中...' : '保存' }}</button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="知识详情" width="min(760px, calc(100vw - 32px))" class="knowledge-detail-dialog">
      <div v-if="selectedKnowledgeDetail" class="detail-body">
        <div class="detail-grid">
          <div>
            <label>标题</label>
            <p>{{ selectedKnowledgeDetail.title || '-' }}</p>
          </div>
          <div>
            <label>类型</label>
            <p>{{ sourceLabel(selectedKnowledgeDetail.source_type) }}</p>
          </div>
          <div>
            <label>条号</label>
            <p>{{ selectedKnowledgeDetail.clause_id || '-' }}</p>
          </div>
          <div>
            <label>来源</label>
            <p>{{ selectedKnowledgeDetail.source_name || selectedKnowledgeDetail.category || '-' }}</p>
          </div>
        </div>
        <div class="detail-field">
          <label>Source ID</label>
          <p>{{ selectedKnowledgeDetail.source_id || '-' }}</p>
        </div>
        <div class="detail-field">
          <label>正文</label>
          <pre>{{ selectedKnowledgeDetail.content || '-' }}</pre>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="syncDialogVisible" title="同步法律" width="min(640px, calc(100vw - 32px))">
      <el-radio-group v-model="syncMode" class="sync-mode-group">
        <el-radio value="file">文件路径</el-radio>
        <el-radio value="markdown">Markdown 内容</el-radio>
      </el-radio-group>

      <div v-if="syncMode === 'file'" class="sync-field">
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
  </main>
</template>

<script>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElDialog, ElDrawer, ElInput, ElLoading, ElMessage, ElMessageBox, ElOption, ElProgress, ElRadio, ElRadioGroup, ElSelect, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag, ElTimeline, ElTimelineItem, ElTooltip, ElUpload } from 'element-plus';
import api, { apiClient } from '../api';

export default {
  name: 'SettingsView',
  components: { ElDialog, ElDrawer, ElInput, ElOption, ElProgress, ElRadio, ElRadioGroup, ElSelect, ElSwitch, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag, ElTimeline, ElTimelineItem, ElTooltip, ElUpload },
  directives: { loading: ElLoading.directive },
  setup() {
    const searchQuery = ref('');
    const sourceType = ref('');
    const lawFilter = ref('');
    const page = ref(1);
    const pageSize = ref(8);
    const total = ref(0);
    const items = ref([]);
    const loading = ref(false);
    const batchFiles = ref([]);
    const batchSourceType = ref('law');
    const batchCategory = ref('');
    const batchSourceUrl = ref('');
    const batchImporting = ref(false);
    const lastImportStats = ref(null);
    const detailVisible = ref(false);
    const selectedKnowledgeDetail = ref(null);
    const retrievalQuery = ref('试用期最长可以约定多久？');
    const retrievalScenario = ref('contract_review');
    const retrievalMode = ref('vector_db');
    const retrievalSourceType = ref('');
    const retrievalLimit = ref(6);
    const retrievalResults = ref([]);
    const retrievalLoading = ref(false);
    const rebuilding = ref(false);
    const rebuildPhase = ref('');
    const rebuildFileName = ref('');
    const rebuildPercent = ref(0);
    const rebuildChunks = ref(0);
    const rebuildError = ref('');
    const vectorStatus = ref({ hasData: true, lawCount: 0, caseCount: 0, totalCount: 0 });
    const vectorStatusChecked = ref(false);

    // 法律版本管理
    const activeTab = ref('knowledge');
    const laws = ref([]);
    const lawsLoading = ref(false);
    const lawVersionsMap = ref({});
    const versionsLoadingTitle = ref('');
    const syncDialogVisible = ref(false);
    const syncMode = ref('file');
    const syncFilePath = ref('');
    const syncTitle = ref('');
    const syncMarkdown = ref('');
    const syncSubmitting = ref(false);

    // 审查模板管理(P1 Task 3)
    const templates = ref([]);
    const templatesLoading = ref(false);
    const currentTemplate = ref(null);
    const newKeyword = ref('');
    const newSection = ref('');
    const templateVersions = ref([]);
    const versionsDrawerVisible = ref(false);
    const versionsLoading = ref(false);

    // 报告章节预设选项:中文标签 + 英文值(后端 prompt 拼接用英文标识)
    const REPORT_SECTION_OPTIONS = [
      { value: 'risk_summary', label: '风险摘要' },
      { value: 'modification_suggestions', label: '修改建议' },
      { value: 'labor_compliance', label: '劳动合规' },
      { value: 'performance_risk', label: '履约风险' },
      { value: 'breach_cost_analysis', label: '违约成本分析' },
      { value: 'missing_clauses', label: '缺失条款' },
      { value: 'citations', label: '引用依据' },
    ];

    const rebuildPhaseLabel = computed(() => {
      const labels = {
        clearing: '正在清空现有数据...',
        clearing_done: '清空完成',
        law_start: '准备导入法条数据...',
        law: '正在导入法条数据',
        law_done: '法条导入完成',
        case_start: '准备导入案例数据...',
        case: '正在导入案例数据',
        case_done: '案例导入完成',
        complete: '重建完成',
        error: '重建失败',
      };
      return labels[rebuildPhase.value] || rebuildPhase.value;
    });

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
    const retrievalModeLabel = computed(() => ({
      vector_db: '向量数据库检索',
      vector_model: '向量模型检索',
      rerank: '重排序检索',
    }[retrievalMode.value]));
    const retrievalScenarioLabel = computed(() => ({
      contract_review: '合同审查知识检索',
      qa: '智能问答知识检索',
    }[retrievalScenario.value]));
    const sourceLabel = (type) => ({
      law: '法律条文',
      case: '裁判文书',
      rule: '审查规则',
      guide: '审查知识',
    }[type] || type || '知识');

    const loadKnowledge = async () => {
      loading.value = true;
      try {
        const response = await api.listKnowledge({
          page: page.value,
          pageSize: pageSize.value,
          q: searchQuery.value,
          type: sourceType.value,
          law_status: lawFilter.value,
        });
        items.value = response.data.items;
        total.value = response.data.total;
      } catch {
        ElMessage.error('知识库加载失败，请检查后端服务。');
      } finally {
        loading.value = false;
      }
    };

    const reloadFirstPage = async () => {
      page.value = 1;
      await loadKnowledge();
    };

    const changePage = async (nextPage) => {
      page.value = Math.min(totalPages.value, Math.max(1, nextPage));
      await loadKnowledge();
    };

    const showKnowledgeDetail = (item) => {
      selectedKnowledgeDetail.value = item;
      detailVisible.value = true;
    };

    const normalizeScore = (score) => {
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore)) return 0;
      if (numericScore <= 1) return Math.max(0, numericScore);
      return numericScore / (numericScore + 1);
    };

    const similarityPercent = (item) => `${Math.round(normalizeScore(item.similarity ?? item.score) * 100)}%`;

    const tokenizeForMock = (text) => String(text || '')
      .toLowerCase()
      .match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) || [];

    const stableNoise = (value) => {
      const raw = String(value || '');
      let hash = 0;
      for (let index = 0; index < raw.length; index += 1) {
        hash = (hash * 31 + raw.charCodeAt(index)) % 1000;
      }
      return hash / 1000;
    };

    const scoreMockVectorModelResult = (item, query) => {
      const queryTokens = new Set(tokenizeForMock(query));
      const text = `${item.title || ''}${item.category || ''}${item.clause_id || ''}${item.source_name || ''}${item.content || ''}`;
      const textTokens = new Set(tokenizeForMock(text));
      const overlap = [...queryTokens].filter((token) => textTokens.has(token)).length;
      const overlapScore = queryTokens.size ? overlap / queryTokens.size : 0;
      const exactScore = text.includes(query) ? 0.18 : 0;
      const sourceBoost = retrievalScenario.value === 'contract_review' && ['law', 'rule'].includes(item.source_type) ? 0.08 : 0;
      const qaBoost = retrievalScenario.value === 'qa' && ['law', 'case', 'guide'].includes(item.source_type) ? 0.06 : 0;
      return Math.min(0.98, 0.45 + overlapScore * 0.34 + exactScore + sourceBoost + qaBoost + stableNoise(item.source_id) * 0.08);
    };

    const runMockVectorModelRetrieval = async (query) => {
      const response = await api.listKnowledge({
        page: 1,
        pageSize: 80,
        type: retrievalSourceType.value,
      });
      return (response.data.items || [])
        .map((item) => ({
          ...item,
          retrieval_engine: 'mock-vector-model',
          similarity: scoreMockVectorModelResult(item, query),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, retrievalLimit.value);
    };

    const runKnowledgeRetrieval = async () => {
      const query = retrievalQuery.value.trim();
      if (!query) {
        ElMessage.warning('请输入检索内容。');
        return;
      }
      retrievalLoading.value = true;
      try {
        if (retrievalMode.value === 'vector_model') {
          retrievalResults.value = await runMockVectorModelRetrieval(query);
          return;
        }
        const response = await api.searchKnowledge(query, {
          limit: retrievalMode.value === 'rerank' ? retrievalLimit.value : retrievalLimit.value * 2,
          types: retrievalSourceType.value,
          rerank: retrievalMode.value === 'rerank',
        });
        retrievalResults.value = (response.data || [])
          .slice(0, retrievalLimit.value)
          .map((item) => ({
            ...item,
            retrieval_engine: retrievalMode.value === 'rerank' ? 'vector-rerank' : 'vector-db',
            similarity: normalizeScore(item.score),
          }));
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '模拟检索失败，请检查后端服务。');
      } finally {
        retrievalLoading.value = false;
      }
    };

    const deleteOne = async (item) => {
      try {
        await ElMessageBox.confirm('删除后会影响后续审查和问答引用，确认删除？', '确认删除', { type: 'warning' });
        const response = item.id
          ? await api.deleteKnowledgeById(item.id)
          : await api.deleteKnowledge({ source_ids: [item.source_id] });
        ElMessage.success(`已删除 ${response.data.deleted} 条知识。`);
        await loadKnowledge();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    const deleteByType = async () => {
      try {
        await ElMessageBox.confirm(`确认删除所有“${sourceLabel(sourceType.value)}”？`, '按类型删除', { type: 'warning' });
        const response = await api.deleteKnowledge({ source_type: sourceType.value });
        ElMessage.success(`已删除 ${response.data.deleted} 条知识。`);
        await reloadFirstPage();
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        ElMessage.error(error.response?.data?.error || '删除失败。');
      }
    };

    const downloadTemplate = async (type = 'law') => {
      try {
        const response = await api.downloadKnowledgeTemplate(type);
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = type === 'case' ? '裁判文书模版.json' : '法律法规模版.md';
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
        await reloadFirstPage();
      } catch (error) {
        ElMessage.error(error.response?.data?.error || '批量导入失败。');
      } finally {
        batchImporting.value = false;
      }
    };

    const rebuildVectorDatabase = async () => {
      try {
        await ElMessageBox.confirm(
          '将清空所有现有向量数据并重新生成。此过程可能需要几分钟，确定继续？',
          '重建向量数据库',
          { confirmButtonText: '确认重建', cancelButtonText: '取消', type: 'warning' },
        );
      } catch {
        return;
      }

      // 重置进度状态
      rebuilding.value = true;
      rebuildPhase.value = 'clearing';
      rebuildFileName.value = '';
      rebuildPercent.value = 0;
      rebuildChunks.value = 0;
      rebuildError.value = '';

      try {
        const baseURL = apiClient.defaults.baseURL || '';
        const token = apiClient.defaults.headers?.Authorization || '';
        const response = await fetch(`${baseURL}/knowledge/rebuild`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {}),
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              rebuildPhase.value = data.phase;

              if (data.phase === 'law' || data.phase === 'case') {
                rebuildFileName.value = data.fileName || '';
                rebuildChunks.value = data.chunks || 0;
                const total = data.total || 1;
                const current = data.current || 0;

                // 计算总进度：法条占 70%，案例占 25%，清空占 5%
                if (data.phase === 'law') {
                  rebuildPercent.value = Math.round(5 + (current / total) * 70);
                } else {
                  rebuildPercent.value = Math.round(75 + (current / total) * 25);
                }
              } else if (data.phase === 'clearing') {
                rebuildPercent.value = 2;
                rebuildFileName.value = '';
              } else if (data.phase === 'clearing_done') {
                rebuildPercent.value = 5;
              } else if (data.phase === 'law_start') {
                rebuildPercent.value = 5;
              } else if (data.phase === 'law_done') {
                rebuildPercent.value = 75;
                rebuildFileName.value = '';
              } else if (data.phase === 'case_start') {
                rebuildPercent.value = 75;
              } else if (data.phase === 'case_done') {
                rebuildPercent.value = 100;
                rebuildFileName.value = '';
              } else if (data.phase === 'complete') {
                rebuildPercent.value = 100;
                rebuildPhase.value = 'complete';
                const lawChunks = data.law?.chunks || 0;
                const caseChunks = data.case?.chunks || 0;
                ElMessage.success(
                  `重建完成：清除 ${data.cleared || 0} 条，法条 ${lawChunks} 切片，案例 ${caseChunks} 切片。`,
                );
              } else if (data.phase === 'error') {
                rebuildError.value = data.message || '重建失败';
                ElMessage.error(data.message || '向量数据库重建失败。');
              }
            } catch {
              // 忽略解析错误的行
            }
          }
        }

        await loadKnowledge();
        await checkVectorStatus();
      } catch (error) {
        rebuildError.value = error.message || '向量数据库重建失败。';
        ElMessage.error('向量数据库重建失败。');
      } finally {
        rebuilding.value = false;
      }
    };

    const checkVectorStatus = async () => {
      try {
        const response = await api.getVectorStatus();
        vectorStatus.value = response.data;
        vectorStatusChecked.value = true;
      } catch {
        vectorStatusChecked.value = true;
      }
    };

    const lawStatusTagType = (status) => ({
      现行: 'success',
      已修订: 'warning',
      已废止: 'info',
    }[status] || 'info');

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
      syncMode.value = 'file';
      syncFilePath.value = '';
      syncTitle.value = '';
      syncMarkdown.value = '';
      syncDialogVisible.value = true;
    };

    const submitSync = async () => {
      const payload = syncMode.value === 'file'
        ? { filePath: syncFilePath.value.trim() }
        : { title: syncTitle.value.trim(), markdown: syncMarkdown.value };
      if (syncMode.value === 'file' && !payload.filePath) {
        ElMessage.warning('请输入法律 Markdown 文件路径。');
        return;
      }
      if (syncMode.value === 'markdown' && !payload.title) {
        ElMessage.warning('请输入法律名称。');
        return;
      }
      if (syncMode.value === 'markdown' && !payload.markdown.trim()) {
        ElMessage.warning('请粘贴法律 Markdown 内容。');
        return;
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

    // 审查模板管理方法(P1 Task 3)
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
      // 深拷贝避免直接修改列表行,保存后才持久化
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

    watch(activeTab, (newTab) => {
      if (newTab === 'review-templates' && templates.value.length === 0 && !templatesLoading.value) {
        loadTemplates();
      }
      if (newTab === 'standard-clauses' && standards.value.length === 0 && !standardsLoading.value) {
        loadStandards();
      }
    });

    // ===== 4.3 行业标准条款库 =====
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
    const standardCategories = [
      { value: 'confidentiality', label: '保密义务', tip: '保密信息范围、保密期限、违约赔偿等' },
      { value: 'breach', label: '违约责任', tip: '违约金比例、赔偿范围、解除权等' },
      { value: 'ip', label: '知识产权', tip: '归属、许可、衍生作品、侵权处理' },
      { value: 'dispute', label: '争议解决', tip: '管辖法院/仲裁机构、适用法律' },
      { value: 'force_majeure', label: '不可抗力', tip: '定义、通知义务、责任免除范围' },
    ];
    const industryOptions = ['通用', '互联网', '制造业', '金融', '房地产', '央企/国企', '医疗', '教育', '零售', '物流'];
    // 25 个合同类型预设(与 reviewTemplates.json 模板 id 对齐)
    const contractTypeOptions = [
      { value: 'labor', label: '劳动合同' },
      { value: 'lease', label: '租赁合同' },
      { value: 'service', label: '服务合同' },
      { value: 'sale', label: '买卖合同' },
      { value: 'loan', label: '借款合同' },
      { value: 'guarantee', label: '担保合同' },
      { value: 'construction', label: '建设合同' },
      { value: 'tech_development', label: '技术开发合同' },
      { value: 'tech_transfer', label: '技术转让合同' },
      { value: 'transport', label: '运输合同' },
      { value: 'warehouse', label: '仓储合同' },
      { value: 'entrust', label: '委托合同' },
      { value: 'partnership', label: '合伙合同' },
      { value: 'equity_transfer', label: '股权转让合同' },
      { value: 'franchise', label: '特许经营合同' },
      { value: 'insurance', label: '保险合同' },
      { value: 'property_management', label: '物业管理合同' },
      { value: 'advertising', label: '广告合同' },
      { value: 'finance_lease', label: '融资租赁合同' },
      { value: 'brokerage', label: '居间合同' },
      { value: 'nda', label: '保密协议' },
      { value: 'non_compete', label: '竞业限制协议' },
      { value: 'ip_license', label: '知识产权许可合同' },
      { value: 'gift', label: '赠与合同' },
      { value: 'general', label: '通用合同' },
    ];
    const contractTypeLabel = (val) => {
      const found = contractTypeOptions.find((c) => c.value === val);
      return found ? found.label : val;
    };
    const standardCategoryLabel = (cat) => {
      const found = standardCategories.find((c) => c.value === cat);
      return found ? found.label : cat;
    };

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
        standardForm.applicable_contract_types = Array.isArray(std.applicable_contract_types) ? [...std.applicable_contract_types] : [];
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
      loadKnowledge();
      checkVectorStatus();
      loadLaws();
    });

    return {
      searchQuery,
      sourceType,
      lawFilter,
      page,
      total,
      totalPages,
      items,
      loading,
      batchFiles,
      batchSourceType,
      batchCategory,
      batchSourceUrl,
      batchImporting,
      lastImportStats,
      detailVisible,
      selectedKnowledgeDetail,
      retrievalQuery,
      retrievalScenario,
      retrievalMode,
      retrievalSourceType,
      retrievalLimit,
      retrievalResults,
      retrievalLoading,
      retrievalModeLabel,
      retrievalScenarioLabel,
      sourceLabel,
      similarityPercent,
      loadKnowledge,
      reloadFirstPage,
      changePage,
      showKnowledgeDetail,
      runKnowledgeRetrieval,
      deleteOne,
      deleteByType,
      downloadTemplate,
      handleBatchFileChange,
      handleBatchFileRemove,
      batchImportKnowledge,
      rebuilding,
      rebuildVectorDatabase,
      rebuildPhase,
      rebuildPhaseLabel,
      rebuildFileName,
      rebuildPercent,
      rebuildChunks,
      rebuildError,
      vectorStatus,
      vectorStatusChecked,
      activeTab,
      laws,
      lawsLoading,
      lawVersionsMap,
      versionsLoadingTitle,
      syncDialogVisible,
      syncMode,
      syncFilePath,
      syncTitle,
      syncMarkdown,
      syncSubmitting,
      lawStatusTagType,
      loadLaws,
      handleLawExpandChange,
      openSyncDialog,
      submitSync,
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
      loadVersions,
      revertVersion,
      addTag,
      // 4.3 标准条款库
      standards,
      standardsLoading,
      standardFilter,
      standardCategories,
      industryOptions,
      contractTypeOptions,
      contractTypeLabel,
      standardCategoryLabel,
      loadStandards,
      standardEditorVisible,
      standardForm,
      standardSaving,
      openStandardEditor,
      saveStandard,
      deleteStandard,
    };
  },
};
</script>

<style scoped>
.settings-page {
  max-width: 1160px;
  margin: 0 auto;
  padding: 12px 16px 24px;
  color: #111111;
  font-size: 13px;
}

.vector-empty-banner {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}

.rebuild-progress-panel {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}

.settings-head {
  margin-bottom: 8px;
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
  font-size: 24px;
  line-height: 1.14;
  letter-spacing: 0;
}

.settings-head p:not(.eyebrow),
.panel-title p,
.batch-footer p,
.muted {
  margin: 4px 0 0;
  color: #666666;
  line-height: 1.45;
}

.panel {
  margin-top: 8px;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 10px 26px rgba(0, 0, 0, 0.04);
}

.panel-title,
.toolbar,
.batch-footer,
.pager {
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

.template-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar {
  margin-top: 8px;
}

.toolbar .el-input {
  flex: 1;
}

.toolbar .el-select {
  width: 150px;
}

.retrieval-toolbar {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px 170px 150px;
  gap: 9px;
}

.retrieval-summary {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.retrieval-summary span,
.retrieval-actions strong {
  border-radius: 999px;
  padding: 3px 7px;
  background: #f5f5f5;
  color: #111111;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.retrieval-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}

.retrieval-actions strong {
  font-weight: 800;
  white-space: nowrap;
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
.secondary-button,
.danger-button,
.pager button {
  min-height: 32px;
  padding: 0 10px;
  white-space: nowrap;
  font-size: 12px;
}

.primary-button {
  background: #111111;
  color: #ffffff;
}

.secondary-button,
.pager button {
  background: #ffffff;
  color: #111111;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.danger-button {
  background: #ef4444;
  color: #ffffff;
}

.knowledge-list {
  margin-top: 8px;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.knowledge-item {
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  min-width: 0;
  overflow: hidden;
}

.knowledge-item header,
.knowledge-item footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.knowledge-item header > div,
.knowledge-item footer > small {
  min-width: 0;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.knowledge-item h3 {
  margin: 0;
  font-size: 13px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-item header p,
.knowledge-item small {
  margin: 3px 0 0;
  color: #666666;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-item header span {
  flex-shrink: 0;
  max-width: 42%;
  border-radius: 999px;
  padding: 3px 7px;
  background: #ffffff;
  color: #111111;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content {
  margin: 5px 0;
  line-height: 1.45;
  color: #333333;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}

.text-button,
.text-danger {
  background: transparent;
  padding: 0;
  font-size: 12px;
  line-height: 1.2;
}

.text-button {
  color: #111111;
  position: relative;
}

.text-danger {
  color: #ef4444;
}

.text-button::after {
  content: "";
  position: absolute;
  right: -9px;
  top: 2px;
  width: 1px;
  height: 12px;
  background: #d4d4d4;
}

.pager {
  justify-content: flex-end;
  margin-top: 7px;
  color: #666666;
  font-size: 12px;
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

.detail-body {
  display: grid;
  gap: 10px;
  color: #111111;
  font-size: 13px;
  max-width: 100%;
  overflow: hidden;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
}

.detail-body label {
  display: block;
  margin-bottom: 4px;
  color: #666666;
  font-size: 12px;
  font-weight: 800;
}

.detail-grid > div,
.detail-field {
  min-width: 0;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.detail-body p,
.detail-body pre {
  margin: 0;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
}

.detail-body pre {
  max-height: 340px;
  overflow: auto;
  font-family: inherit;
  border-radius: 8px;
  padding: 10px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #eeeeee;
}

.settings-tabs {
  margin-top: 8px;
}

.hint-text {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 780px) {
  .settings-page {
    padding: 14px;
  }

  .panel-title,
  .toolbar,
  .batch-footer,
  .knowledge-item header,
  .knowledge-item footer,
  .pager {
    flex-direction: column;
    align-items: stretch;
  }

  .item-actions {
    justify-content: flex-end;
  }

  .toolbar .el-select,
  .retrieval-toolbar,
  .batch-grid,
  .detail-grid {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .retrieval-actions {
    justify-content: flex-end;
  }

  .stats {
    grid-template-columns: 1fr 1fr;
  }
}

.template-layout {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.template-list-panel {
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.template-table {
  width: 100%;
}

.template-lock-icon {
  width: 13px;
  height: 13px;
  vertical-align: -2px;
  margin-right: 3px;
  color: #d97706;
}

.template-edit-panel {
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.template-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.template-field label {
  font-size: 12px;
  font-weight: 800;
  color: #666666;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.field-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e5e7eb;
  color: #6b7280;
  font-size: 10px;
  font-weight: 700;
  cursor: help;
  line-height: 1;
}

.tag-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.tag-input {
  width: 160px;
}

.input-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-row .el-input {
  flex: 1;
}

.template-add-btn {
  align-self: flex-start;
}

.version-card {
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  background: #fafafa;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.version-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.version-card-meta {
  font-size: 12px;
}

@media (max-width: 780px) {
  .template-layout {
    grid-template-columns: 1fr;
  }
}

/* 4.3 标准条款库 */
.standard-clauses-panel {
  padding: 8px 4px;
}
.standard-clauses-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.standard-clauses-panel .panel-header h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}
.standard-clauses-panel .panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.standard-clauses-panel .primary-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.standard-clauses-panel .primary-btn:hover {
  background: #1d4ed8;
}
.standard-clauses-panel .primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.standard-clauses-panel .muted {
  color: #6b7280;
  font-size: 13px;
  padding: 24px 0;
  text-align: center;
}
.standards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.standard-item {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 14px;
}
.standard-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.standard-category-tag {
  background: #dbeafe;
  color: #1e40af;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}
.standard-title {
  font-weight: 600;
  color: #111827;
  font-size: 14px;
}
.owner-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.owner-tag.public {
  background: #dcfce7;
  color: #166534;
}
.owner-tag.private {
  background: #fef3c7;
  color: #92400e;
}
.industry-tag {
  font-size: 11px;
  padding: 1px 6px;
  background: #f3f4f6;
  color: #4b5563;
  border-radius: 4px;
}
.standard-text {
  margin: 6px 0 10px;
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.standard-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.standard-item-footer .meta-text {
  color: #6b7280;
}
.standard-item-footer .action-group {
  display: flex;
  gap: 12px;
}
.link-btn {
  background: none;
  border: none;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
.link-btn:hover {
  text-decoration: underline;
}
.link-btn.danger {
  color: #dc2626;
}
.standard-form .form-row {
  margin-bottom: 12px;
}
.standard-form .form-row label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: #374151;
  font-weight: 500;
}
.standard-form .form-row .required {
  color: #dc2626;
  margin-left: 2px;
}
.standard-form .hint-text {
  font-size: 12px;
  color: #6b7280;
  margin: 4px 0 0;
}
/* 分类快捷筛选 */
.category-quick-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
}
.category-quick-filter .quick-filter-label {
  font-size: 12px;
  color: #6b7280;
  margin-right: 4px;
}
.quick-filter-chip {
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #374151;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.quick-filter-chip:hover {
  border-color: #2563eb;
  color: #2563eb;
}
.quick-filter-chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px 20px;
}
.empty-state .empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px;
}
.empty-state .empty-desc {
  font-size: 13px;
  color: #6b7280;
  margin: 0;
  line-height: 1.6;
}
/* 适用合同类型展示 */
.applicable-types-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin: 6px 0 10px;
}
.applicable-types-row .meta-label {
  font-size: 11px;
  color: #6b7280;
}
.applicable-type-chip {
  font-size: 11px;
  padding: 1px 6px;
  background: #ede9fe;
  color: #5b21b6;
  border-radius: 4px;
  border: 1px solid #ddd6fe;
}
/* 下拉选项中的提示问号 */
.option-tip-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 6px;
  border-radius: 50%;
  background: #e5e7eb;
  color: #6b7280;
  font-size: 10px;
  font-weight: 700;
}
</style>

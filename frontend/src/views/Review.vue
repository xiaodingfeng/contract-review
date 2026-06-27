<template>
  <div class="review-page w-full h-full flex flex-col">
    <!-- Custom Steps Header -->
    <div class="flex-shrink-0 mb-2 p-2 bg-white rounded-lg shadow-sm">
      <div class="flex items-center">
        <div class="flex items-center text-xs" :class="activeStep >= 0 ? 'text-primary' : 'text-gray-500'">
          <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 0 ? 'border-primary' : 'border-gray-400'">
            <span v-if="activeStep > 0">✓</span><span v-else>1</span>
          </div>
          <span class="ml-1 font-semibold">上传合同</span>
        </div>
        <div class="flex-auto border-t-2 mx-2" :class="activeStep >= 1 ? 'border-primary' : 'border-gray-300'"></div>
        <div class="flex items-center text-xs" :class="activeStep >= 1 ? 'text-primary' : 'text-gray-500'">
          <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 1 ? 'border-primary' : 'border-gray-400'">
             <span v-if="activeStep > 1">✓</span><span v-else>2</span>
          </div>
          <span class="ml-1 font-semibold">确认信息并分析</span>
        </div>
        <div class="flex-auto border-t-2 mx-2" :class="activeStep >= 2 ? 'border-primary' : 'border-gray-300'"></div>
        <div class="flex items-center text-xs" :class="activeStep >= 2 ? 'text-primary' : 'text-gray-500'">
          <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 2 ? 'border-primary' : 'border-gray-400'">
            <span>3</span>
          </div>
          <span class="ml-1 font-semibold">查看并编辑结果</span>
        </div>
      </div>
    </div>

    <!-- Step 0: Upload -->
    <div v-if="activeStep === 0" class="flex-grow overflow-y-auto flex flex-col items-center py-8 px-4 text-center">
      <h1 class="text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">智能合同审查</h1>
      <p class="mt-3 text-base leading-7 text-text-light">上传您的合同文档，AI 将为您深度分析、识别风险、守护权益。</p>

      <div class="mt-10 w-full max-w-2xl">
        <el-upload
          class="upload-dragger"
          drag
          action=""
          :http-request="({ file }) => uploadAndGo(file)"
          :before-upload="handleBeforeUpload"
          :show-file-list="false"
        >
          <div class="flex flex-col items-center justify-center p-10">
            <svg class="mx-auto h-12 w-12 text-text-light" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <div class="mt-4 flex text-sm leading-6 text-gray-600">
              <span class="font-semibold text-primary">点击上传</span>
              <p class="pl-1">或将文件拖到此处</p>
            </div>
            <p class="text-xs leading-5 text-gray-500">支持 .docx 和 .pdf 格式（PDF 需为可复制的文字版，不支持扫描件）</p>
          </div>
        </el-upload>
      </div>

      <div class="linked-analysis-panel mt-8 w-full max-w-2xl text-left">
        <div>
          <p class="text-sm font-semibold text-primary">多合同关联分析</p>
          <h2 class="mt-1 text-xl font-semibold text-text-dark">同时审查主合同、附件和补充协议</h2>
          <p class="mt-2 text-sm text-text-light">选择至少 2 份 DOCX 或 PDF 文件，系统会识别条款冲突、重复约定、遗漏和前后矛盾。</p>
        </div>
        <div class="linked-analysis-panel__picker">
          <input
            ref="linkedFileInput"
            type="file"
            multiple
            accept=".docx,.pdf"
            @change="handleLinkedFilesChange"
            class="linked-analysis-panel__native-input"
          />
          <button type="button" class="linked-analysis-panel__file-button" @click="openLinkedFilePicker">
            选择关联合同文件
          </button>
          <span class="linked-analysis-panel__count">已选择 {{ linkedGroupFiles.length }} 份</span>
          <button
            @click="startLinkedContractAnalysis"
            :disabled="linkedAnalysisLoading || linkedGroupFiles.length < 2"
            class="linked-analysis-panel__button"
          >
            {{ linkedAnalysisLoading ? '正在分析关联合同...' : '开始多合同关联分析' }}
          </button>
        </div>
        <div v-if="linkedGroupFiles.length" class="linked-analysis-panel__files">
          <span v-for="file in linkedGroupFiles" :key="file.name + file.size">{{ file.name }}</span>
        </div>
        <div v-if="linkedAnalysisProgress.length" class="linked-analysis-panel__progress">
          <div v-for="item in linkedAnalysisProgress" :key="item.key" class="linked-analysis-panel__progress-row">
            <span :class="['linked-analysis-panel__progress-dot', `linked-analysis-panel__progress-dot--${item.status}`]"></span>
            <div>
              <strong>{{ item.label }}</strong>
              <p>{{ item.message }}</p>
            </div>
          </div>
        </div>
        <div v-if="linkedAnalysisResult" class="linked-analysis-result">
          <h3>关联分析结果</h3>
          <p v-if="linkedAnalysisResult.summary" class="linked-analysis-result__summary">{{ linkedAnalysisResult.summary }}</p>
          <div v-if="linkedAnalysisResult.conflicts?.length" class="linked-analysis-result__section">
            <h4>条款冲突与矛盾</h4>
            <div v-for="(item, index) in linkedAnalysisResult.conflicts" :key="'conflict-' + index" class="linked-analysis-result__item">
              <strong>{{ item.title || `冲突点 ${index + 1}` }}</strong>
              <p>{{ item.description }}</p>
              <p v-if="item.contract_refs?.length">涉及文件：{{ item.contract_refs.join('、') }}</p>
              <p v-if="item.suggestion">处理建议：{{ item.suggestion }}</p>
            </div>
          </div>
          <div v-if="linkedAnalysisResult.shared_risks?.length" class="linked-analysis-result__section">
            <h4>跨合同共同风险</h4>
            <ul>
              <li v-for="(risk, index) in linkedAnalysisResult.shared_risks" :key="'shared-risk-' + index">{{ risk }}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 1: Pre-analysis & Settings -->
    <div v-if="activeStep === 1" class="confirm-step w-full max-w-5xl mx-auto py-8">
      <div v-if="preAnalysisData.contract_type">
        <div class="text-center mb-10">
            <p class="text-lg text-text-main">文件 <span class="font-semibold text-primary">{{ contract.original_filename }}</span> 已上传成功。</p>
            <div class="mt-2 flex items-center justify-center gap-2">
                <p class="text-md text-text-light">AI初步识别该合同为：</p>
                <el-input
                    v-model="preAnalysisData.contract_type"
                    class="contract-type-edit"
                    size="small"
                    style="width: 240px;"
                    placeholder="可修改合同类型"
                />
            </div>
            <button @click="showContractPreview = !showContractPreview" class="mt-3 text-sm font-medium text-primary hover:text-primary-dark inline-flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform" :class="{ 'rotate-180': showContractPreview }" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                {{ showContractPreview ? '收起合同预览' : '查看合同预览' }}
                <span v-if="preAnalysisData.text_stats" class="text-xs text-text-light font-normal">（{{ preAnalysisData.text_stats.charCount }} 字）</span>
            </button>
            <div v-if="showContractPreview" class="mt-3 mx-auto max-w-3xl text-left bg-white border border-border-color rounded-lg p-4 max-h-60 overflow-y-auto">
                <p class="text-sm text-text-main leading-relaxed whitespace-pre-line">{{ contractPreviewText }}</p>
                <p v-if="preAnalysisData.text_stats && preAnalysisData.text_stats.charCount > 200" class="mt-2 pt-2 border-t border-border-color text-xs text-text-light text-center">仅展示前 200 字，完整内容将在审查后显示</p>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <!-- Left Panel: Perspective -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h3 class="text-lg font-semibold text-text-dark">1. 选择您的审查立场</h3>
                <p class="text-sm text-text-light mt-1">AI将基于您的立场进行侧重分析。</p>
                <div class="mt-4">
                    <el-select v-model="perspective" placeholder="请选择您的立场" class="w-full"  filterable allow-create>
                        <el-option
                        v-for="party in allPotentialParties"
                        :key="party"
                        :label="party"
                        :value="party">
                        </el-option>
                    </el-select>
                </div>
            </div>

            <!-- Right Panel: Actions -->
            <div class="bg-white rounded-lg shadow-md p-6 flex flex-col justify-between">
                <div>
                    <h3 class="text-lg font-semibold text-text-dark">2. 确认审查范围</h3>
                    <p class="text-sm text-text-light mt-1">默认已全选AI建议的审查点。</p>
                    <div class="mt-4">
                        <label class="block text-sm font-medium text-text-main mb-1">审查模板</label>
                        <el-select v-model="selectedTemplateId" placeholder="选择审查模板" class="w-full">
                            <el-option
                                v-for="template in reviewTemplates"
                                :key="template.id"
                                :label="template.name"
                                :value="template.id"
                            />
                        </el-select>
                    </div>
                </div>
                <div class="mt-6 flex justify-end space-x-3">
                     <button @click="goBackToUpload" class="px-4 py-2 text-sm font-medium text-text-main bg-white border border-border-color rounded-md hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary">
                        重新上传
                    </button>
                    <button @click="startAnalysis" :disabled="!perspective" class="px-6 py-2 text-sm font-medium text-white bg-primary border border-transparent rounded-md shadow-sm hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed">
                        开始分析
                    </button>
                </div>
            </div>
        </div>

         <!-- Bottom Panel: Review Points & Purposes -->
        <div class="review-options-panel bg-white rounded-lg shadow-md p-6 mt-8">
            <h3 class="text-lg font-semibold text-text-dark mb-4">审查点及核心目的</h3>
            <div class="mb-6">
                <h4 class="text-md font-medium text-text-dark mb-2">审查点选择 (可多选)</h4>
                <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group flex flex-wrap gap-3">
                    <el-checkbox
                    v-for="point in allSuggestedReviewPoints"
                    :key="point"
                    :label="point"
                    :value="point"
                    border
                    ></el-checkbox>
                </el-checkbox-group>
            </div>
            <div>
                 <h4 class="text-md font-medium text-text-dark mb-2">审查核心目的 (可自定义)</h4>
                 <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row flex items-center mb-2">
                    <el-autocomplete
                        v-model="purpose.value"
                        :fetch-suggestions="querySearchCorePurposes"
                        placeholder="搜索或输入新目的"
                        class="w-full"
                        trigger-on-focus
                    ></el-autocomplete>
                    <button @click="removePurpose(index)" class="ml-2 text-gray-400 hover:text-danger">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                 </div>
                 <button @click="addPurpose" class="mt-2 text-sm font-medium text-primary hover:text-primary-dark flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    添加目的
                 </button>
            </div>
        </div>
      </div>
    </div>

    <!-- Step 2: Review & Edit -->
    <div v-if="activeStep === 2" class="flex-grow min-h-0 flex space-x-4">
        <!-- Left Side: OnlyOffice Editor -->
        <div class="w-2/3 bg-white rounded-lg shadow-md overflow-hidden h-full flex flex-col">
            <div class="px-3 py-2 border-b border-border-color bg-bg-subtle flex items-center justify-between gap-3">
                <div class="text-sm text-text-main">
                    左侧为合同实时预览与编辑区。可选中文本后进行专项审查。
                </div>
                <button @click="prepareFocusedReviewFromSelection" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">
                    读取选中文本审查
                </button>
            </div>
            <DocumentEditor
                v-if="contract.editorConfig"
                id="docEditorComponent"
                ref="docEditorComponent"
                class="flex-grow min-h-0"
                :documentServerUrl="onlyOfficeUrl"
                :config="contract.editorConfig"
                :events_onDocumentReady="onDocumentReady"
                :events_onDocumentStateChange="onDocumentStateChange"
            />
            <div v-if="selectedSuggestionPreview" class="border-t border-border-color bg-white p-3 max-h-44 overflow-y-auto">
                <div class="flex items-center justify-between">
                    <p class="text-sm font-semibold text-text-dark">最近采纳预览</p>
                    <span class="text-xs text-green-700">{{ selectedSuggestionPreview.status }}</span>
                </div>
                <div class="mt-2 grid grid-cols-2 gap-3 text-xs">
                    <div>
                        <p class="text-gray-500 font-medium">采纳前原文</p>
                        <p class="mt-1 p-2 bg-red-50 text-red-800 border border-red-100 rounded whitespace-pre-line">{{ selectedSuggestionPreview.before }}</p>
                    </div>
                    <div>
                        <p class="text-gray-500 font-medium">采纳后文本</p>
                        <p class="mt-1 p-2 bg-green-50 text-green-800 border border-green-100 rounded whitespace-pre-line">{{ selectedSuggestionPreview.after }}</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Right Side: AI Review Panel -->
        <div class="w-1/3 bg-white rounded-lg shadow-md flex flex-col h-full">
            <!-- Panel Header -->
            <div class="p-3 border-b border-border-color flex justify-between items-center flex-shrink-0">
                <div class="flex items-center">
                    <h3 class="text-lg font-semibold text-text-dark">AI 审查报告</h3>
                    <div class="ml-4 flex items-center">
                        <span class="text-xs text-text-light mr-1">大白话模式</span>
                        <el-switch v-model="showPlainLanguage" size="small"></el-switch>
                    </div>
                </div>
                <div>
                    <button @click="exportReport('pdf')" class="mr-3 text-sm font-medium text-primary hover:text-primary-dark">导出PDF</button>
                    <button @click="exportReport('word')" class="mr-3 text-sm font-medium text-primary hover:text-primary-dark">导出Word</button>
                    <button @click="downloadPdfAnnotations" class="mr-3 text-sm font-medium text-primary hover:text-primary-dark">PDF批注</button>
                    <template v-if="cameFromHistory">
                        <button @click="goBackToUpload" class="text-sm font-medium text-primary hover:text-primary-dark">重新上传</button>
                        <button @click="goBackSmart" class="ml-4 text-sm font-medium text-primary hover:text-primary-dark">返回历史</button>
                    </template>
                    <template v-else>
                        <button @click="goBackSmart" class="text-sm font-medium text-primary hover:text-primary-dark">返回上一步</button>
                    </template>
                </div>
            </div>

            <!-- Tab Navigation -->
            <div class="px-4 border-b border-border-color flex-shrink-0">
                <nav class="-mb-px grid grid-cols-4 gap-2">
                    <button @click="activeAiTab = 'summary'" :class="[activeAiTab === 'summary' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">总览</button>
                    <button @click="activeAiTab = 'suggestions'" :class="[activeAiTab === 'suggestions' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">修改</button>
                    <button @click="activeAiTab = 'knowledge'" :class="[activeAiTab === 'knowledge' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">依据</button>
                    <button @click="activeAiTab = 'workspace'" :class="[activeAiTab === 'workspace' ? 'border-primary text-primary bg-primary-light' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm rounded-t">工作台</button>
                </nav>
            </div>

            <!-- Tab Content -->
            <div class="p-3 overflow-y-auto flex-grow">
                <!-- 硬性合规检查（规则引擎） -->
                <div v-if="activeAiTab === 'summary'" class="mb-4">
                    <div v-if="hardViolations.length > 0" class="p-4 bg-red-50 rounded-md border-2 border-red-400">
                        <div class="flex items-center justify-between mb-3">
                            <p class="font-bold text-red-800 flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                硬性合规检查：检出 {{ hardViolations.length }} 项违规
                            </p>
                        </div>
                        <div class="space-y-3">
                            <div v-for="(item, index) in hardViolations" :key="'hv-' + index" class="p-3 bg-white rounded border border-red-200">
                                <div class="flex justify-between items-start gap-2">
                                    <p class="font-semibold text-text-dark">{{ item.description }}</p>
                                    <span :class="item.severity === 'high' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ item.severity === 'high' ? '高' : '中' }}</span>
                                </div>
                                <p class="mt-1 text-xs text-text-light">依据：{{ item.legal_basis }}</p>
                                <p class="mt-1 text-sm">合同值：<span class="font-bold text-red-700">{{ item.contract_value }}</span> ／ 限值：<span class="font-bold text-green-700">{{ item.limit_value }}</span></p>
                                <p class="mt-1 text-sm text-text-main">修改建议：{{ item.fix_template }}</p>
                                <div class="mt-2 flex justify-end">
                                    <button @click="adoptHardViolation(item)" class="px-3 py-1 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">一键采纳</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="p-3 bg-green-50 rounded-md border border-green-200 text-sm text-green-700 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                        硬性合规检查通过
                    </div>
                </div>
                <!-- 风险仪表盘 -->
                <div v-if="activeAiTab === 'summary' && riskDashboard.total > 0" class="mb-4 p-4 bg-white rounded-md border border-border-color">
                    <div class="flex items-center justify-between flex-wrap gap-3">
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-semibold text-text-dark">整体风险等级</span>
                            <span :class="riskDashboard.overallClass" class="px-3 py-1 text-sm font-bold rounded-full border">{{ riskDashboard.overallLabel }}</span>
                        </div>
                        <div class="flex items-center gap-4 text-xs">
                            <div class="flex items-center gap-1">
                                <span class="w-3 h-3 rounded-full bg-red-500"></span>
                                <span class="text-text-main">高危 {{ riskDashboard.stats.high }}</span>
                            </div>
                            <div class="flex items-center gap-1">
                                <span class="w-3 h-3 rounded-full bg-amber-500"></span>
                                <span class="text-text-main">中危 {{ riskDashboard.stats.medium }}</span>
                            </div>
                            <div class="flex items-center gap-1">
                                <span class="w-3 h-3 rounded-full bg-blue-500"></span>
                                <span class="text-text-main">低危 {{ riskDashboard.stats.low }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
                        <div class="p-2 bg-bg-subtle rounded">
                            <p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.disputes }}</p>
                            <p class="text-xs text-text-light">风险点</p>
                        </div>
                        <div class="p-2 bg-bg-subtle rounded">
                            <p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.suggestions }}</p>
                            <p class="text-xs text-text-light">修改建议</p>
                        </div>
                        <div class="p-2 bg-bg-subtle rounded">
                            <p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.missing }}</p>
                            <p class="text-xs text-text-light">缺失条款</p>
                        </div>
                        <div class="p-2 bg-bg-subtle rounded">
                            <p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.breach }}</p>
                            <p class="text-xs text-text-light">违约场景</p>
                        </div>
                        <div class="p-2 bg-bg-subtle rounded">
                            <p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.party }}</p>
                            <p class="text-xs text-text-light">主体审查</p>
                        </div>
                    </div>
                </div>
                <!-- Dispute Points -->
                <div v-if="activeAiTab === 'summary'">
                    <!-- 截断条款提示（长合同分层审查中因超长未完整审查的条款，建议人工复核） -->
                    <div v-if="reviewData.truncated_clauses && reviewData.truncated_clauses.length > 0" class="mb-4 p-4 bg-yellow-50 border border-yellow-400 border-l-4 rounded-md">
                        <p class="font-bold text-yellow-800 flex items-center mb-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            部分条款因过长未完整审查，建议人工复核
                        </p>
                        <ul class="text-sm text-yellow-800 space-y-1">
                            <li v-for="(tc, idx) in reviewData.truncated_clauses" :key="'tc-' + idx">
                                <span class="font-medium">{{ tc.clause_id }}</span>
                                <span v-if="tc.char_count" class="text-yellow-700 ml-1">（{{ tc.char_count }} 字）</span>
                                <span class="text-yellow-700 ml-1">— {{ tc.reason }}</span>
                            </li>
                        </ul>
                    </div>
                    <div v-if="reviewData.dispute_points && reviewData.dispute_points.length > 0">
                        <!-- 3.1 增量审查:变更待审提示卡 -->
                        <div v-if="contractModifiedNotice" class="mb-3 p-3 bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-md flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2 text-sm text-red-800">
                                <span class="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                                <span class="font-semibold">变更待审:</span>
                                <span>检测到合同修订 {{ contractModifiedNotice.total_changes }} 处变更(修改 {{ contractModifiedNotice.modified }} / 新增 {{ contractModifiedNotice.added }} / 删除 {{ contractModifiedNotice.deleted }}),建议执行增量审查</span>
                            </div>
                            <button
                                @click="runIncrementalReview"
                                :disabled="incrementalReviewLoading"
                                class="px-3 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50 whitespace-nowrap"
                            >
                                {{ incrementalReviewLoading ? '审查中...' : '执行增量审查' }}
                            </button>
                        </div>
                        <!-- 3.1 增量审查:历史审查记录 -->
                        <div v-if="incrementalReviews.length > 0" class="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                            <p class="text-sm font-semibold text-blue-800 mb-2">增量审查记录({{ incrementalReviews.length }} 次)</p>
                            <div v-for="(review, idx) in incrementalReviews" :key="'inc-' + idx" class="text-xs text-blue-700 mb-1 last:mb-0">
                                <span class="font-medium">{{ formatIncrementalTime(review.reviewed_at) }}</span>
                                <span class="ml-2">变更:修{{ review.diff_summary?.modified || 0 }} / 增{{ review.diff_summary?.added || 0 }} / 删{{ review.diff_summary?.deleted || 0 }}</span>
                                <span v-if="review.new_risks?.length" class="ml-2 text-red-700">新增风险 {{ review.new_risks.length }} 项</span>
                                <span v-if="review.resolved_risks?.length" class="ml-2 text-green-700">已解决 {{ review.resolved_risks.length }} 项</span>
                            </div>
                        </div>
                        <!-- 风险等级过滤 -->
                        <div class="mb-3 flex items-center gap-2 flex-wrap">
                            <span class="text-xs text-text-light">风险等级筛选：</span>
                            <button @click="severityFilter = 'all'" :class="severityFilter === 'all' ? 'bg-primary text-white' : 'bg-white text-text-main border border-border-color'" class="px-2 py-0.5 text-xs rounded">全部 ({{ reviewData.dispute_points.length }})</button>
                            <button v-if="disputeSeverityStats.high" @click="severityFilter = 'high'" :class="severityFilter === 'high' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 border border-red-300'" class="px-2 py-0.5 text-xs rounded">高 ({{ disputeSeverityStats.high }})</button>
                            <button v-if="disputeSeverityStats.medium" @click="severityFilter = 'medium'" :class="severityFilter === 'medium' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'" class="px-2 py-0.5 text-xs rounded">中 ({{ disputeSeverityStats.medium }})</button>
                            <button v-if="disputeSeverityStats.low" @click="severityFilter = 'low'" :class="severityFilter === 'low' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-700 border border-blue-300'" class="px-2 py-0.5 text-xs rounded">低 ({{ disputeSeverityStats.low }})</button>
                            <span class="text-xs text-text-light ml-2">已按严重程度从高到低排序</span>
                        </div>
                        <div class="space-y-4">
                            <div v-for="(item, index) in filteredAndSortedDisputePoints" :key="'dp-' + index" :class="['p-4 bg-bg-subtle rounded-md border border-border-color', item.resolved ? 'opacity-50 border-gray-300' : (normalizeSeverity(item.severity) === 'high' ? 'border-l-4 border-l-red-500' : normalizeSeverity(item.severity) === 'medium' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-blue-500')]">
                                <div class="flex justify-between items-start gap-2">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <p class="font-semibold text-text-dark" :class="item.resolved ? 'line-through text-gray-500' : ''">{{ disputeTitle(item, index) }}</p>
                                        <span v-if="item.clause_id" class="px-2 py-0.5 text-xs font-medium rounded border bg-blue-100 text-blue-700 border-blue-300 whitespace-nowrap">{{ item.clause_id }}</span>
                                        <el-tag v-if="item.resolved" type="info" size="small" effect="plain">已解决</el-tag>
                                        <el-tag v-if="item.isNewIncremental" type="danger" size="small">新增风险</el-tag>
                                    </div>
                                    <span v-if="item.severity && !item.resolved" :class="severityClass(item.severity)" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ severityLabel(item.severity) }}</span>
                                </div>
                                <p v-if="!showPlainLanguage" class="mt-2 text-sm text-text-main whitespace-pre-line">{{ disputeDescription(item) }}</p>
                                <div v-else class="mt-2 p-3 bg-blue-50 text-blue-800 rounded-md border-l-4 border-blue-400">
                                    <p class="text-xs font-bold mb-1">📢 大白话解释：</p>
                                    <p class="text-sm">{{ item.plain_language || disputeDescription(item) }}</p>
                                </div>
                                <!-- 3.3 证据链联动 -->
                                <EvidenceCard
                                    v-if="!item.resolved && item.evidence"
                                    :evidence="item.evidence"
                                    :title="`证据链`"
                                    class="mt-3"
                                    @locate-contract="handleLocateContract"
                                    @view-law="handleViewLaw"
                                />
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现风险点</div>
                </div>
                <!-- Breach Cost Analysis -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.breach_cost_analysis && reviewData.breach_cost_analysis.length > 0" class="space-y-4">
                        <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-xs text-yellow-800 flex items-start gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <span>以下违约成本由 AI 基于合同文本和法律依据估算，仅供参考，不构成法律意见或赔偿承诺。实际赔偿金额以法院判决或双方协商为准。</span>
                        </div>
                        <div v-for="(item, index) in reviewData.breach_cost_analysis" :key="'bc-' + index" class="p-4 bg-orange-50 rounded-md border border-orange-200">
                            <p class="font-bold text-orange-900 flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                违约场景：{{ item.scenario }}
                            </p>
                            <div class="mt-2 text-sm">
                                <p class="text-orange-700 font-medium">依据：</p>
                                <p class="text-orange-800">{{ item.legal_basis }}</p>
                            </div>
                            <div class="mt-3 p-2 bg-white rounded border border-orange-100">
                                <p class="text-xs text-gray-500 font-medium">预计赔偿/成本（仅供参考）：</p>
                                <p class="text-md font-bold text-danger">{{ item.estimated_cost }}</p>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现明确的违约成本条款</div>
                </div>
                <!-- Seal Analysis (3.2 多模态印章分析) -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.seal_analysis && reviewData.seal_analysis.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.seal_analysis" :key="'seal-' + index" :class="['p-4 rounded-md border', sealItemClass(item)]">
                            <div class="flex justify-between items-center mb-2">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <p class="font-bold text-text-dark">{{ item.seal_name }}</p>
                                    <el-tag v-if="item.source === 'vision'" type="primary" size="small" effect="plain">视觉模型</el-tag>
                                    <el-tag v-else-if="item.source === 'ocr'" type="info" size="small" effect="plain">OCR</el-tag>
                                </div>
                                <el-tag :type="item.risk_level === '低' ? 'success' : item.risk_level === '中' ? 'warning' : 'danger'" size="small">
                                    风险：{{ item.risk_level }}
                                </el-tag>
                            </div>
                            <div class="mt-2 text-sm flex items-center">
                                <span class="text-gray-500 mr-2">状态:</span>
                                <span :class="sealStatusClass(item)" class="font-medium">{{ item.status }}</span>
                            </div>
                            <!-- 视觉模型分析的字段 -->
                            <div v-if="item.source === 'vision'" class="mt-2 grid grid-cols-3 gap-2 text-xs">
                                <div :class="['p-2 rounded border', item.ps_suspect ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700']">
                                    <p class="font-semibold">PS 疑似</p>
                                    <p>{{ item.ps_suspect ? '是' : '否' }}</p>
                                </div>
                                <div :class="['p-2 rounded border', item.position_compliant ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700']">
                                    <p class="font-semibold">位置合规</p>
                                    <p>{{ item.position_compliant ? '是' : '否' }}</p>
                                </div>
                                <div class="p-2 rounded border bg-blue-50 border-blue-200 text-blue-700">
                                    <p class="font-semibold">印章类型</p>
                                    <p>{{ item.seal_type || '未知' }}</p>
                                </div>
                            </div>
                            <p class="mt-2 text-xs text-text-main leading-relaxed">
                                <span class="text-gray-500">检测详情:</span><br/>
                                {{ item.details }}
                            </p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现印章信息或正在分析中</div>
                </div>
                <!-- 4.3 行业标准对比 -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.standard_comparison && reviewData.standard_comparison.length > 0" class="space-y-3">
                        <div v-for="(cmp, idx) in reviewData.standard_comparison" :key="'std-cmp-' + idx" class="p-4 bg-amber-50 rounded-md border border-amber-200 border-l-4 border-l-amber-500">
                            <div class="flex items-center justify-between mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="px-2 py-0.5 text-xs font-semibold bg-amber-200 text-amber-900 rounded">{{ cmp.category_label || cmp.category }}</span>
                                    <p class="font-semibold text-text-dark text-sm">合同 {{ cmp.contract_clause_id || '' }} vs {{ cmp.matched_standard?.title || '行业标准' }}</p>
                                </div>
                                <span class="text-xs text-amber-700">相似度 {{ (cmp.matched_standard?.score || 0).toFixed(2) }}</span>
                            </div>
                            <div class="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <p class="text-gray-600 font-medium mb-1">合同条款:</p>
                                    <p class="text-text-main bg-white p-2 rounded border border-amber-100 leading-relaxed">{{ cmp.contract_clause_text }}</p>
                                </div>
                                <div>
                                    <p class="text-gray-600 font-medium mb-1">标准条款{{ cmp.matched_standard?.industry ? '(' + cmp.matched_standard.industry + ')' : '' }}:</p>
                                    <p class="text-text-main bg-white p-2 rounded border border-amber-100 leading-relaxed">{{ cmp.matched_standard?.clause_text }}</p>
                                </div>
                            </div>
                            <p class="mt-2 text-xs text-amber-800">{{ cmp.diff_description }}</p>
                        </div>
                    </div>
                </div>
                <!-- Relevant Laws -->
                <div v-if="activeAiTab === 'knowledge'">
                    <div v-if="reviewData.relevant_laws && reviewData.relevant_laws.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.relevant_laws" :key="'law-' + index" :class="['p-4 rounded-md border', isLawOutdated(item) ? 'bg-red-50 border-red-200 border-l-4 border-l-red-500' : 'bg-blue-50 border-blue-100']">
                            <div class="flex justify-between gap-3">
                                <p class="font-bold text-blue-900">【{{ item.law }}】{{ item.clause }}</p>
                                <el-tag v-if="isLawOutdated(item)" type="danger" size="small">{{ item.law_status === '已废止' ? '已废止' : '已修订' }}</el-tag>
                                <el-tag v-else type="success" size="small">现行</el-tag>
                            </div>
                            <p class="mt-2 text-sm text-blue-900 leading-6">{{ item.content }}</p>
                            <p v-if="isLawOutdated(item)" class="mt-2 text-xs text-red-700">{{ item.updateNotice || '该条文已被修订，仅作历史参考' }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未命中相关法条</div>
                </div>
                <!-- Missing Clauses -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.missing_clauses && reviewData.missing_clauses.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.missing_clauses" :key="'mc-' + index" class="p-4 bg-bg-subtle rounded-md">
                            <p class="font-semibold text-text-dark">{{ missingClauseTitle(item, index) }}</p>
                            <p class="mt-1 text-sm text-text-main">{{ item.description }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现缺失条款</div>
                </div>
                <!-- Modification Suggestions -->
                <div v-if="activeAiTab === 'suggestions'">
                    <div v-if="reviewData.modification_suggestions && reviewData.modification_suggestions.length > 0" class="mb-3 flex items-center justify-between gap-2">
                        <el-checkbox-group v-model="selectedSuggestionIndexes" class="flex flex-wrap gap-2">
                            <el-checkbox
                                v-for="(item, index) in reviewData.modification_suggestions"
                                :key="'select-ms-' + index"
                                :label="index"
                                border
                            >{{ index + 1 }}</el-checkbox>
                        </el-checkbox-group>
                        <div class="flex items-center gap-2">
                            <span v-if="isPdfContract" class="text-xs text-amber-600">PDF 不支持采纳</span>
                            <button @click="applySelectedSuggestions" :disabled="batchApplying || isPdfContract || selectedSuggestionIndexes.length === 0" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
                                {{ batchApplying ? '批量采纳中...' : '一键采纳所选' }}
                            </button>
                        </div>
                    </div>
                    <div v-if="reviewData.modification_suggestions && reviewData.modification_suggestions.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.modification_suggestions" :key="'ms-' + index" class="p-4 bg-bg-subtle rounded-md border border-border-color transition-all hover:shadow-md">
                            <div class="flex justify-between items-start">
                                <p class="font-semibold text-text-dark pr-2">{{ suggestionTitle(item, index) }}</p>
                                <div class="flex space-x-1 flex-shrink-0">
                                    <el-tooltip content="在文档中定位" placement="top">
                                        <button @click="locateText(suggestionOriginal(item))" class="p-1 text-gray-400 hover:text-primary transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        </button>
                                    </el-tooltip>
                                    <el-tooltip content="添加批注" placement="top">
                                        <button @click="addDocComment(suggestionOriginal(item), suggestionReason(item))" class="p-1 text-gray-400 hover:text-primary transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                        </button>
                                    </el-tooltip>
                                </div>
                            </div>

                            <div v-if="showPlainLanguage" class="mt-3 p-3 bg-green-50 text-green-800 rounded-md border-l-4 border-green-400">
                                <p class="text-xs font-bold mb-1">📢 大白话建议：</p>
                                <p class="text-sm">{{ item.plain_language || suggestionReason(item) }}</p>
                            </div>

                            <div v-else class="space-y-3 mt-3">
                                <div class="text-xs">
                                    <p class="text-gray-500 font-medium">原文：</p>
                                    <blockquote class="mt-1 p-2 bg-red-50 text-red-800 border-l-4 border-red-400 break-all">
                                        {{ suggestionOriginal(item) || 'AI 未返回可直接定位的原文，请参考建议条款手动核对。' }}
                                    </blockquote>
                                </div>
                                <div class="text-xs">
                                    <p class="text-gray-500 font-medium">建议：</p>
                                    <blockquote
                                        :title="item.adopted ? `采纳前原文：${item.adopted_original || suggestionOriginal(item)}` : ''"
                                        :class="[
                                            'mt-1 p-2 text-green-800 border-l-4 border-green-400 break-all',
                                            item.adopted ? 'adopted-suggestion-text' : 'bg-green-50'
                                        ]"
                                    >
                                        {{ suggestionText(item) }}
                                    </blockquote>
                                </div>
                                <div class="text-xs">
                                    <p class="text-gray-500 font-medium">理由：</p>
                                    <p class="mt-1 text-text-main">{{ suggestionReason(item) }}</p>
                                </div>
                                <div v-if="item.citations && item.citations.length" class="text-xs">
                                    <p class="text-gray-500 font-medium">法律依据：</p>
                                    <div v-for="(cite, cIndex) in item.citations" :key="'cite-' + index + '-' + cIndex" class="mt-1 p-2 bg-blue-50 border-l-4 border-blue-300 rounded">
                                        <p class="font-medium text-blue-800">【{{ cite.source_type || '依据' }}】{{ cite.title || '' }}{{ cite.clause ? ' ' + cite.clause : '' }}</p>
                                        <p v-if="cite.content" class="mt-0.5 text-blue-700">{{ cite.content }}</p>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="mt-4 pt-3 border-t border-gray-100 flex justify-end items-center">
                                <span v-if="isPdfContract" class="mr-2 text-xs text-amber-600">PDF 文件不支持原文改写，请使用审查报告导出或 PDF 批注</span>
                                <button
                                    @click="toggleNegotiation(item)"
                                    :disabled="item._negotiationLoading"
                                    :class="[
                                        'mr-2 px-3 py-1.5 text-xs font-medium border rounded transition-colors flex items-center disabled:opacity-50',
                                        item._negotiation
                                            ? 'text-green-700 bg-green-50 border-green-300 hover:bg-green-100'
                                            : 'text-purple-700 bg-purple-50 border-purple-300 hover:bg-purple-100'
                                    ]"
                                    :title="item._negotiation ? '已推演过,点击查看或收起' : '点击进行谈判推演'"
                                >
                                    <svg v-if="item._negotiationLoading" class="animate-spin h-3.5 w-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                    <svg v-else-if="item._negotiation" class="h-3.5 w-3.5 mr-1 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                                    {{ item._negotiationLoading ? '推演中...' : (item._showNegotiation ? '收起推演' : (item._negotiation ? '已推演·查看' : '谈判推演')) }}
                                </button>
                                <button @click="previewSuggestion(item)" class="mr-2 px-3 py-1.5 text-xs font-medium text-primary bg-white border border-primary rounded hover:bg-primary-light transition-colors">
                                    查看变更
                                </button>
                                <button @click="adoptSuggestion(item)" :disabled="isPdfContract || item.adopted" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                    {{ item.adopted ? '已采纳' : '一键采纳建议' }}
                                </button>
                            </div>
                            <!-- 4.1 谈判推演面板 -->
                            <div v-if="item._showNegotiation && item._negotiation" class="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-md space-y-3">
                                <div class="flex items-center gap-2 text-xs text-purple-800 font-semibold">
                                    <span>对方立场:{{ item._negotiation.counterparty_perspective }}</span>
                                </div>
                                <!-- 对方反驳 -->
                                <div>
                                    <p class="text-xs font-bold text-red-700 mb-1">对方可能反驳:</p>
                                    <div v-for="(obj, oi) in item._negotiation.likely_objections" :key="'obj-' + oi" class="text-xs mb-1 p-2 bg-white border border-red-100 rounded">
                                        <p class="text-text-main">{{ obj.reason }}</p>
                                        <p v-if="obj.legal_basis && obj.legal_basis !== '无明确依据'" class="mt-0.5 text-gray-600">依据:{{ obj.legal_basis }}</p>
                                        <p v-if="obj.business_concern" class="mt-0.5 text-gray-600">顾虑:{{ obj.business_concern }}</p>
                                    </div>
                                </div>
                                <!-- 折中方案 -->
                                <div>
                                    <p class="text-xs font-bold text-amber-700 mb-1">折中方案:</p>
                                    <div v-for="(opt, oi) in item._negotiation.fallback_options" :key="'opt-' + oi" class="text-xs mb-2 p-2 bg-white border border-amber-100 rounded">
                                        <p class="text-text-main font-medium">{{ opt.text }}</p>
                                        <p class="mt-1 text-gray-600">让步:{{ opt.tradeoff }}</p>
                                        <p class="mt-0.5 text-gray-600">风险变化:{{ opt.risk_change }}</p>
                                        <button
                                            @click="adoptFallbackOption(item, opt)"
                                            class="mt-1 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200"
                                        >采纳此折中方案</button>
                                    </div>
                                </div>
                                <!-- 谈判话术 -->
                                <div>
                                    <p class="text-xs font-bold text-blue-700 mb-1">谈判话术:</p>
                                    <p class="text-xs text-text-main leading-relaxed p-2 bg-white border border-blue-100 rounded whitespace-pre-line">{{ item._negotiation.negotiation_talktrack }}</p>
                                </div>
                            </div>
                            <div v-else-if="item._showNegotiation && item._negotiationError" class="mt-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                谈判推演失败:{{ item._negotiationError }}
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现修改建议</div>
                </div>
                <!-- Party Review -->
                <div v-if="activeAiTab === 'summary'">
                     <div v-if="reviewData.party_review && reviewData.party_review.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.party_review" :key="'pr-' + index" class="p-4 bg-bg-subtle rounded-md">
                            <p class="font-semibold text-text-dark">{{ partyReviewTitle(item, index) }}</p>
                            <p class="mt-1 text-sm text-text-main whitespace-pre-line">{{ partyReviewDescription(item) }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">主体信息无风险</div>
                </div>
                <div v-if="activeAiTab === 'summary' && reviewData.company_review && reviewData.company_review.length > 0" class="mt-4 space-y-4">
                    <div v-for="(item, index) in sortedCompanyReview" :key="'company-' + index" :class="['p-4 bg-white rounded-md border border-border-color', companyCardBorderClass(companyRiskLevel(item))]">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex items-center gap-2 flex-wrap">
                                <p class="font-semibold text-text-dark">{{ item.company_name || item.title || '主体审查' }}</p>
                                <span :class="companyRiskBadgeClass(companyRiskLevel(item))" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ companyRiskLabel(companyRiskLevel(item)) }}</span>
                            </div>
                            <span v-if="dataSourceLabel(item.authenticity)" :class="dataSourceClass(item.authenticity)" class="text-xs px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0">{{ dataSourceLabel(item.authenticity) }}</span>
                        </div>
                        <div class="mt-2">
                            <p v-if="item.status" class="text-xs text-text-light">核验状态：{{ item.status }}</p>
                            <p v-if="item.evidence_summary" class="mt-1 text-sm text-text-main whitespace-pre-line">{{ item.evidence_summary }}</p>
                        </div>
                        <div class="mt-3">
                            <button v-if="(item.risk_items || []).length" @click="toggleCompanyCard(index)" class="text-xs text-primary hover:underline">
                                {{ expandedCompanyCards.includes(index) ? '收起' : '展开' }}风险事项明细 ({{ (item.risk_items || []).length }})
                            </button>
                            <p v-else class="text-xs text-text-light">无风险事项</p>
                            <div v-show="expandedCompanyCards.includes(index) && (item.risk_items || []).length" class="mt-2 overflow-x-auto">
                                <table class="w-full text-xs border-collapse">
                                    <thead>
                                        <tr class="bg-bg-subtle text-text-light">
                                            <th class="p-2 text-left font-medium border border-border-color">类型</th>
                                            <th class="p-2 text-left font-medium border border-border-color">详情</th>
                                            <th class="p-2 text-left font-medium border border-border-color">日期</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="(ri, riIndex) in (item.risk_items || [])" :key="'ri-' + index + '-' + riIndex">
                                            <td class="p-2 text-text-main border border-border-color">{{ ri.type }}</td>
                                            <td class="p-2 text-text-main border border-border-color">{{ ri.detail }}</td>
                                            <td class="p-2 text-text-light whitespace-nowrap border border-border-color">{{ ri.date }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <p v-if="item.suggestion" class="mt-3 pt-3 border-t border-gray-100 text-sm text-text-main">
                            <span class="font-medium text-text-dark">建议：</span>{{ item.suggestion }}
                        </p>
                        <div v-if="item.sources && item.sources.length" class="mt-2 flex flex-col gap-1">
                            <a v-for="source in item.sources" :key="source" :href="source" target="_blank" rel="noreferrer" class="text-xs text-primary hover:underline truncate">{{ source }}</a>
                        </div>
                        <p v-if="item.authenticity" class="mt-2 text-xs text-text-light">{{ item.authenticity }}</p>
                    </div>
                </div>
                <!-- Focused Review -->
                <div v-if="activeAiTab === 'workspace'">
                    <div class="space-y-4">
                        <div class="p-4 bg-white rounded-md border border-border-color">
                            <div class="flex items-center justify-between">
                                <h4 class="font-semibold text-text-dark">合同版本对比</h4>
                                <button @click="loadLatestDiff" :disabled="diffLoading" class="px-3 py-1.5 text-xs font-medium text-primary bg-white border border-primary rounded hover:bg-primary-light">
                                    {{ diffLoading ? '加载中...' : '查看最近变更' }}
                                </button>
                            </div>
                            <div v-if="diffItems.length" class="mt-3 p-3 bg-bg-subtle rounded text-xs leading-6 max-h-56 overflow-y-auto whitespace-pre-wrap">
                                <template v-for="(part, index) in diffItems" :key="'diff-' + index">
                                    <span v-if="part.type === 'insert'" class="diff-insert">{{ part.text }}</span>
                                    <span v-else-if="part.type === 'delete'" class="diff-delete">{{ part.text }}</span>
                                    <span v-else>{{ part.text }}</span>
                                </template>
                            </div>
                            <p v-else class="mt-2 text-xs text-text-light">采纳修改后会自动保存原始快照，可在这里查看新增和删除文本。</p>
                        </div>
                        <div class="p-4 bg-bg-subtle rounded-md border border-border-color">
                            <div class="flex justify-between items-center">
                                <h4 class="font-semibold text-text-dark">选中文本专项审查</h4>
                                <button @click="prepareFocusedReviewFromSelection" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">
                                    从左侧读取选中文本
                                </button>
                            </div>
                            <el-input
                                v-model="focusedReviewText"
                                class="mt-3"
                                type="textarea"
                                :rows="6"
                                placeholder="可从左侧 OnlyOffice 选中文本后读取，也可手动粘贴某一条款或段落"
                            />
                            <el-input
                                v-model="focusedReviewQuestion"
                                class="mt-3"
                                placeholder="专项问题，例如：审查这段试用期条款是否合法，并给出可替换文本"
                            />
                            <div class="mt-3 flex justify-end">
                                <button @click="submitFocusedReview" :disabled="focusedReviewLoading || !focusedReviewText.trim()" class="px-4 py-2 text-sm font-medium text-white bg-primary rounded hover:bg-primary-dark disabled:opacity-50">
                                    {{ focusedReviewLoading ? '审查中...' : '开始专项审查' }}
                                </button>
                            </div>
                        </div>

                        <div v-if="focusedReviewResult" class="p-4 bg-white rounded-md border border-border-color">
                            <p class="font-semibold text-text-dark">专项审查结论</p>
                            <p class="mt-2 text-sm text-text-main whitespace-pre-line">{{ focusedReviewResult.risk_summary }}</p>
                            <div v-if="focusedReviewResult.plain_language" class="mt-3 p-3 bg-blue-50 text-blue-800 border-l-4 border-blue-400 rounded">
                                <p class="text-xs font-bold mb-1">大白话说明</p>
                                <p class="text-sm">{{ focusedReviewResult.plain_language }}</p>
                            </div>
                            <div v-if="focusedReviewResult.suggested_text" class="mt-3">
                                <p class="text-xs text-gray-500 font-medium">建议替换文本</p>
                                <p class="mt-1 p-2 bg-green-50 text-green-800 border border-green-100 rounded whitespace-pre-line">{{ focusedReviewResult.suggested_text }}</p>
                                <button @click="applyFocusedSuggestion" class="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">
                                    替换左侧选中文本
                                </button>
                            </div>
                            <div v-if="focusedReviewResult.relevant_laws && focusedReviewResult.relevant_laws.length" class="mt-3">
                                <p class="text-xs text-gray-500 font-medium">检索依据</p>
                                <div v-for="(item, index) in focusedReviewResult.relevant_laws" :key="'fr-law-' + index" class="mt-2 p-2 bg-bg-subtle rounded text-xs">
                                    【{{ item.law }}】{{ item.clause }}：{{ item.content }}
                                </div>
                            </div>
                        </div>

                        <!-- 专项审查历史 -->
                        <div v-if="focusedReviewHistory.length" class="p-4 bg-white rounded-md border border-border-color">
                            <div class="flex justify-between items-center">
                                <p class="font-semibold text-text-dark text-sm">历史专项审查（已持久化，刷新不丢失）</p>
                                <span class="text-xs text-text-light">{{ focusedReviewHistory.length }} 条</span>
                            </div>
                            <div class="mt-2 space-y-2 max-h-72 overflow-y-auto">
                                <div v-for="item in focusedReviewHistory" :key="'fr-h-' + item.id" class="p-2 bg-bg-subtle rounded text-xs border border-transparent hover:border-primary transition-colors">
                                    <div class="flex justify-between items-start gap-2">
                                        <div class="flex-1 min-w-0">
                                            <p class="text-text-main font-medium truncate">{{ item.question || '（无专项问题）' }}</p>
                                            <p class="text-text-light mt-0.5 truncate">原文：{{ item.source_text }}</p>
                                            <p class="text-text-light mt-0.5">{{ formatHistoryTime(item.created_at) }}</p>
                                        </div>
                                        <div class="flex gap-1 flex-shrink-0">
                                            <button @click="loadFocusedReviewFromHistory(item)" class="px-2 py-1 text-xs text-primary border border-primary rounded hover:bg-primary hover:text-white">查看</button>
                                            <button @click="deleteFocusedReviewFromHistory(item.id)" class="px-2 py-1 text-xs text-red-500 border border-red-300 rounded hover:bg-red-500 hover:text-white">删除</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Re-review Form -->
                <div v-if="activeAiTab === 'workspace'">
                   <div class="space-y-6">
                        <div>
                            <label class="block text-sm font-medium text-text-main">合同类型</label>
                            <el-input v-model="preAnalysisData.contract_type" class="mt-1"></el-input>
                        </div>
                        <div>
                             <label class="block text-sm font-medium text-text-main">审查立场</label>
                             <el-select v-model="perspective" placeholder="请选择或输入您的立场" class="w-full mt-1" filterable allow-create>
                                <el-option v-for="party in allPotentialParties" :key="party" :label="party" :value="party"></el-option>
                             </el-select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-text-main">审查点选择</label>
                             <div class="mt-2 p-3 bg-bg-subtle rounded-md">
                                <el-checkbox-group v-model="selectedReviewPoints" class="flex flex-wrap gap-2">
                                    <el-checkbox v-for="point in allSuggestedReviewPoints" :key="point" :label="point" :value="point" border></el-checkbox>
                                </el-checkbox-group>
                             </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-text-main">审查核心目的</label>
                             <div v-for="(purpose, index) in customPurposes" :key="index" class="flex items-center mt-1">
                                <el-autocomplete
                                    v-model="purpose.value"
                                    :fetch-suggestions="querySearchCorePurposes"
                                    placeholder="搜索或输入新目的"
                                    class="w-full"
                                    trigger-on-focus
                                ></el-autocomplete>
                                <button @click="removePurpose(index)" class="ml-2 text-gray-400 hover:text-danger"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
                            </div>
                            <button @click="addPurpose" class="mt-2 text-sm font-medium text-primary hover:text-primary-dark flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                添加目的
                            </button>
                        </div>
                        <div class="pt-4">
                            <button
                                @click="startReAnalysis"
                                :disabled="!perspective || selectedReviewPoints.length === 0 || reAnalyzing"
                                class="w-full px-4 py-2 text-sm font-medium text-white bg-primary border border-transparent rounded-md shadow-sm hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {{ reAnalyzing ? '正在重审...' : '确认重审' }}
                            </button>
                        </div>
                        <!-- 重审进度面板 -->
                        <div v-if="reAnalyzing || analysisActive" class="reanalysis-progress p-4 bg-white rounded-md border border-border-color">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-semibold text-text-dark">{{ loadingMessage || '正在重新审查合同...' }}</span>
                                <span v-if="analysisPercent > 0" class="text-lg font-bold text-primary">{{ analysisPercent }}%</span>
                            </div>
                            <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden mb-2">
                                <div class="bg-primary h-2 rounded-full transition-all duration-500 ease-out" :style="{ width: analysisPercent + '%' }"></div>
                            </div>
                            <div class="flex justify-between text-xs text-text-light mb-3">
                                <span>已用时：{{ formatDuration(analysisElapsed) }}</span>
                                <span v-if="analysisEta > 0">预计剩余：{{ formatDuration(analysisEta) }}</span>
                            </div>
                            <div v-if="analysisSteps.length" class="analysis-progress mt-2 w-full">
                                <div
                                    v-for="(step, index) in analysisSteps"
                                    :key="'re-step-' + index"
                                    class="analysis-progress__item"
                                    :class="[`analysis-progress__item--${progressStatusClass(step.status)}`]"
                                >
                                    <div class="analysis-progress__marker">
                                        <span v-if="step.status === 'completed'">✓</span>
                                        <span v-else-if="step.status === 'failed'">!</span>
                                        <span v-else-if="step.status === 'running'" class="analysis-progress__spinner"></span>
                                        <span v-else>{{ index + 1 }}</span>
                                    </div>
                                    <div class="analysis-progress__content">
                                        <div class="analysis-progress__title">
                                            <span>{{ step.label }}</span>
                                            <span class="analysis-progress__status">{{ progressStatusLabel(step.status) }}</span>
                                        </div>
                                        <p v-if="step.message" class="analysis-progress__message">{{ step.message }}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                   </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Loading Overlay - Moved inside the single root element -->
    <div v-if="loading && activeStep < 2" class="fixed inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-50">
        <div class="flex flex-col items-center max-w-lg bg-white border border-border-color rounded-md p-6 shadow-sm w-full mx-4">
            <div class="flex items-center justify-between w-full mb-3">
                <p class="text-lg font-semibold text-text-dark">{{ loadingMessage }}</p>
                <span v-if="analysisPercent > 0" class="text-2xl font-bold text-primary">{{ analysisPercent }}%</span>
            </div>

            <!-- 进度条 -->
            <div v-if="analysisActive" class="w-full mb-3">
                <div class="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div class="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out" :style="{ width: analysisPercent + '%' }"></div>
                </div>
                <div class="flex justify-between text-xs text-text-light mt-1">
                    <span>已用时：{{ formatDuration(analysisElapsed) }}</span>
                    <span v-if="analysisEta > 0">预计剩余：{{ formatDuration(analysisEta) }}</span>
                </div>
                <div v-if="clauseProgress.total > 0" class="text-xs text-blue-600 mt-1">
                    已审查 {{ clauseProgress.reviewed }}/{{ clauseProgress.total }} 条款<span v-if="clauseProgress.current_clause_id">（当前：{{ clauseProgress.current_clause_id }}）</span>
                </div>
            </div>

            <!-- 步骤列表 -->
            <div v-if="analysisSteps.length" class="analysis-progress mt-2 w-full">
                <div
                    v-for="(step, index) in analysisSteps"
                    :key="'step-' + index"
                    class="analysis-progress__item"
                    :class="[
                        `analysis-progress__item--${progressStatusClass(step.status)}`,
                    ]"
                >
                    <div class="analysis-progress__marker">
                        <span v-if="step.status === 'completed'">✓</span>
                        <span v-else-if="step.status === 'failed'">!</span>
                        <span v-else-if="step.status === 'running'" class="analysis-progress__spinner"></span>
                        <span v-else>{{ index + 1 }}</span>
                    </div>
                    <div class="analysis-progress__content">
                        <div class="analysis-progress__title">
                            <span>{{ step.label }}</span>
                            <span class="analysis-progress__status">{{ progressStatusLabel(step.status) }}</span>
                        </div>
                        <p v-if="step.message" class="analysis-progress__message">{{ step.message }}</p>
                    </div>
                </div>
            </div>
            <!-- 兼容旧版进度事件（无 steps 结构时） -->
            <div v-else-if="analysisProgress.length" class="analysis-progress mt-4 w-full">
                <div
                    v-for="(item, index) in visibleAnalysisProgress"
                    :key="'progress-' + index"
                    class="analysis-progress__item"
                    :class="[
                        `analysis-progress__item--${progressStatusClass(item.status)}`,
                        index === visibleAnalysisProgress.length - 1 ? 'analysis-progress__item--current' : ''
                    ]"
                >
                    <div class="analysis-progress__marker">
                        <span v-if="item.status === 'completed'">✓</span>
                        <span v-else-if="item.status === 'failed'">!</span>
                    </div>
                    <div class="analysis-progress__content">
                        <div class="analysis-progress__title">
                            <span>{{ progressStepLabel(item.step) }}</span>
                            <span class="analysis-progress__status">{{ progressStatusLabel(item.status) }}</span>
                        </div>
                        <p v-if="item.message" class="analysis-progress__message">{{ item.message }}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 会话恢复失败重试遮罩 -->
    <div v-if="sessionLoadFailed" class="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
        <div class="flex flex-col items-center max-w-md bg-white border border-border-color rounded-md p-6 shadow-md w-full mx-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-amber-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p class="text-lg font-semibold text-text-dark mb-1">恢复会话失败</p>
            <p class="text-sm text-text-light text-center mb-4">可能是网络连接问题导致无法加载合同详情。您的审查进度已保留，可点击下方按钮重试，或返回首页。</p>
            <div class="flex gap-3">
                <button @click="retryLoadSession" class="px-4 py-2 text-sm font-medium text-white bg-primary rounded hover:bg-primary-dark">重试恢复</button>
                <button @click="sessionLoadFailed = false; resetState();" class="px-4 py-2 text-sm font-medium text-text-main bg-white border border-border-color rounded hover:bg-bg-subtle">放弃并重置</button>
            </div>
        </div>
    </div>

    <!-- Inline Q&A Chat Widget -->
    <div v-if="activeStep === 2" class="qa-chat-widget" :class="{ 'qa-chat-widget--open': qaPanelOpen }">
        <div v-if="!qaPanelOpen" class="qa-chat-widget__fab" @click="toggleQaPanel">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <span class="qa-chat-widget__fab-badge" v-if="qaMessages.length">智能问答</span>
            <span class="qa-chat-widget__fab-badge" v-else>智能问答</span>
        </div>
        <div v-else class="qa-chat-widget__panel">
            <div class="qa-chat-widget__header">
                <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    <span class="font-semibold text-sm text-text-dark">智能问答</span>
                    <span v-if="contract.id" class="text-xs text-text-light">已关联：{{ contract.original_filename }}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button v-if="qaMessages.length" @click="clearQaChat" title="清空会话" class="text-gray-400 hover:text-red-500 p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                    <button @click="toggleQaPanel" title="关闭" class="text-gray-400 hover:text-text-dark p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
            <div ref="qaChatBody" class="qa-chat-widget__body">
                <div v-if="qaMessages.length === 0" class="qa-chat-widget__empty">
                    <p class="text-sm text-text-light">输入问题，AI 将基于当前合同为您解答。</p>
                    <p class="text-xs text-text-light mt-1">例如：试用期超过法定期限怎么处理？</p>
                </div>
                <div v-for="(msg, index) in qaMessages" :key="'qa-' + index" class="qa-chat-widget__msg" :class="'qa-chat-widget__msg--' + msg.role">
                    <div class="qa-chat-widget__bubble">
                        <p class="qa-chat-widget__role">{{ msg.role === 'user' ? '你' : 'AI 助手' }}</p>
                        <div class="qa-chat-widget__content" v-html="renderQaMarkdown(msg.content || '正在生成...')"></div>
                    </div>
                </div>
                <div v-if="qaLoading" class="qa-chat-widget__typing">
                    <span></span><span></span><span></span>
                </div>
            </div>
            <div class="qa-chat-widget__footer">
                <el-input
                    v-model="qaInput"
                    type="textarea"
                    :rows="2"
                    placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                    resize="none"
                    :disabled="qaLoading"
                    @keydown.enter.prevent="handleQaEnter"
                />
                <button @click="sendQaMessage" :disabled="!qaInput.trim() || qaLoading" class="qa-chat-widget__send">
                    发送
                </button>
            </div>
        </div>
        <!-- 3.3 查看法条弹窗 -->
        <el-dialog v-model="viewLawDialogVisible" title="法条详情" width="600px" append-to-body>
            <div v-if="currentLawRef" class="space-y-3">
                <div class="flex items-center justify-between">
                    <p class="text-base font-bold text-text-dark">{{ currentLawRef.law_name }} {{ currentLawRef.clause_id }}</p>
                    <el-tag :type="currentLawRef.law_status === '现行' ? 'success' : currentLawRef.law_status === '已修订' ? 'warning' : 'danger'" size="small">
                        {{ currentLawRef.law_status || '现行' }}
                    </el-tag>
                </div>
                <p v-if="currentLawRef.effective_date" class="text-xs text-text-light">施行日期:{{ currentLawRef.effective_date }}</p>
                <p class="text-sm text-text-main leading-relaxed whitespace-pre-line bg-gray-50 p-3 rounded border border-gray-200">{{ currentLawRef.content }}</p>
                <p v-if="currentLawRef.law_status && currentLawRef.law_status !== '现行'" class="text-xs text-red-700 bg-red-50 p-2 rounded">
                    注意:该条文法律状态为「{{ currentLawRef.law_status }}」,引用时请谨慎,建议查询最新版本。
                </p>
            </div>
        </el-dialog>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, toRaw, onMounted, nextTick, onUnmounted, computed } from 'vue';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete, ElSwitch, ElTooltip, ElDialog, ElTag } from 'element-plus';
import { marked } from 'marked';
import { v4 as uuidv4 } from 'uuid';
import api from '../api';
import { getUserId } from '../user';
import { DocumentEditor } from "@onlyoffice/document-editor-vue";
import { io } from "socket.io-client";
import EvidenceCard from '../components/EvidenceCard.vue';

export default {
  name: 'ReviewView',
  components: {
    DocumentEditor,
    EvidenceCard,
    ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete, ElSwitch, ElTooltip, ElDialog, ElTag
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const activeStep = ref(0);
    let isResetting = false; // The flag to prevent watchers from firing during reset
    const cameFromHistory = ref(false);
    const loading = ref(false);
    const loadingMessage = ref('');
    const sessionLoadFailed = ref(false);
    const perspective = ref('');
    const activeAiTab = ref('summary');
    const docEditorComponent = ref(null);
    const isEditorReady = ref(false);
    const reAnalyzing = ref(false);
    const showPlainLanguage = ref(false);
    const socket = ref(null);
    const forceSaveTimer = ref(null);
    const forceSaveDebounceTimer = ref(null);
    const forceSaveInFlight = ref(false);
    const hasPendingEditorChanges = ref(false);
    const selectedSuggestionPreview = ref(null);
    const adoptedHighlights = ref({});
    const analysisProgress = ref([]);
    // 长合同分层审查：条款级进度（Task 2.5）
    const clauseProgress = ref({ reviewed: 0, total: 0, current_clause_id: '' });
    const selectedSuggestionIndexes = ref([]);
    const batchApplying = ref(false);
    const diffItems = ref([]);
    const diffLoading = ref(false);
    const linkedGroupFiles = ref([]);
    const linkedAnalysisLoading = ref(false);
    const linkedAnalysisResult = ref(null);
    const linkedAnalysisProgress = ref([]);
    const linkedFileInput = ref(null);
    const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6));
    // 判断当前合同是否为 PDF（PDF 不支持原文改写/采纳）
    const isPdfContract = computed(() => {
        const name = String(contract.original_filename || '').toLowerCase();
        return name.endsWith('.pdf');
    });
    const progressStepLabels = {
      pre_analysis: '合同预分析',
      extract_text: '提取合同正文',
      knowledge_search: '检索法条与案例',
      company_search: '核验合同主体',
      llm_review: '生成审查结论',
      seal_analysis: '印章与签章核验',
      finalize: '保存审查结果',
      failed: '分析失败',
    };
    const progressStatusLabels = {
      running: '进行中',
      completed: '已完成',
      failed: '失败',
      pending: '等待中',
      reviewed: '已审查',
      pre_analyzed: '已预分析',
      processing: '处理中',
      queued: '排队中',
    };
    const progressStepLabel = (step) => progressStepLabels[step] || step || '处理中';
    const progressStatusLabel = (status) => progressStatusLabels[status] || status || '处理中';
    const progressStatusClass = (status) => {
      if (status === 'completed' || status === 'reviewed' || status === 'pre_analyzed') return 'completed';
      if (status === 'failed') return 'failed';
      if (status === 'running') return 'running';
      return 'pending';
    };

    // 异步分析进度追踪状态
    const analysisPercent = ref(0);
    const analysisEta = ref(0);
    const analysisElapsed = ref(0);
    const analysisJobId = ref(null);
    const analysisSteps = ref([]);
    const statusPollTimer = ref(null);
    const analysisActive = ref(false);

    const formatDuration = (seconds) => {
      if (!seconds || seconds < 0) return '0秒';
      if (seconds < 60) return `${seconds}秒`;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return s > 0 ? `${m}分${s}秒` : `${m}分`;
    };
    const focusedReviewText = ref('');
    const focusedReviewQuestion = ref('');
    const focusedReviewResult = ref(null);
    const focusedReviewLoading = ref(false);
    const focusedReviewHistory = ref([]);
    const focusedReviewHistoryLoading = ref(false);
    // 风险点 severity 排序与过滤
    const severityFilter = ref('all'); // all | high | medium | low
    const severityOrder = { high: 0, '高': 0, medium: 1, '中': 1, low: 2, '低': 2 };
    const normalizeSeverity = (s) => {
        const v = String(s || '').toLowerCase().trim();
        if (['high', '高', '严重', 'critical'].includes(v)) return 'high';
        if (['medium', '中', '一般', 'moderate'].includes(v)) return 'medium';
        if (['low', '低', '轻微', 'minor'].includes(v)) return 'low';
        return 'medium';
    };
    const severityLabel = (s) => {
        const n = normalizeSeverity(s);
        return { high: '高', medium: '中', low: '低' }[n];
    };
    const severityClass = (s) => {
        const n = normalizeSeverity(s);
        return {
            high: 'bg-red-100 text-red-700 border-red-300',
            medium: 'bg-amber-100 text-amber-700 border-amber-300',
            low: 'bg-blue-100 text-blue-700 border-blue-300',
        }[n];
    };
    const filteredAndSortedDisputePoints = computed(() => {
        const list = reviewData.dispute_points || [];
        const filtered = severityFilter.value === 'all'
            ? list
            : list.filter((item) => normalizeSeverity(item.severity) === severityFilter.value);
        return [...filtered].sort((a, b) => {
            const sa = severityOrder[normalizeSeverity(a.severity)] ?? 1;
            const sb = severityOrder[normalizeSeverity(b.severity)] ?? 1;
            return sa - sb;
        });
    });
    const disputeSeverityStats = computed(() => {
        const list = reviewData.dispute_points || [];
        const stats = { high: 0, medium: 0, low: 0 };
        list.forEach((item) => { stats[normalizeSeverity(item.severity)] += 1; });
        return stats;
    });
    // 风险仪表盘：整体风险等级 + 各模块统计
    const riskDashboard = computed(() => {
        const disputes = reviewData.dispute_points || [];
        const missing = reviewData.missing_clauses || [];
        const breach = reviewData.breach_cost_analysis || [];
        const party = reviewData.party_review || [];
        const suggestions = reviewData.modification_suggestions || [];
        const stats = disputeSeverityStats.value;
        const total = disputes.length;
        // 整体风险等级：有高危即为高，否则有中危即为中，否则低
        let overallLevel = 'low';
        let overallLabel = '低';
        let overallClass = 'bg-green-100 text-green-700 border-green-300';
        if (stats.high > 0) {
            overallLevel = 'high';
            overallLabel = '高';
            overallClass = 'bg-red-100 text-red-700 border-red-300';
        } else if (stats.medium > 0) {
            overallLevel = 'medium';
            overallLabel = '中';
            overallClass = 'bg-amber-100 text-amber-700 border-amber-300';
        }
        return {
            total,
            stats,
            overallLevel,
            overallLabel,
            overallClass,
            moduleCounts: {
                disputes: total,
                missing: missing.length,
                breach: breach.length,
                party: party.length,
                suggestions: suggestions.length,
            },
        };
    });
    // 硬性合规检查（规则引擎检出的违规清单）
    const hardViolations = computed(() => {
        return reviewData.hard_violations || reviewData.analysis_result?.hard_violations || [];
    });
    // 一键采纳硬性违规修改建议：将 fix_template 包装后推入 modification_suggestions
    const adoptHardViolation = (violation) => {
        if (!violation || !violation.fix_template) return;
        reviewData.modification_suggestions.push({
            title: violation.description,
            original_text: violation.clause_excerpt || '',
            suggested_text: violation.fix_template,
            reason: violation.legal_basis || '',
            plain_language: violation.fix_template,
            anchor_hint: '',
        });
        ElMessage.success('已将硬性违规修改建议加入修改列表。');
    };
    // 主体风险画像(Task 2.5 / 2.6)
    const companyRiskOrder = { red: 0, yellow: 1, green: 2 };
    const companyRiskLevel = (item) => {
        const lvl = item && item.risk_level;
        if (lvl === 'red' || lvl === 'yellow' || lvl === 'green') return lvl;
        return 'green'; // 旧结构兼容:无 risk_level 默认绿色
    };
    const companyRiskLabel = (level) => ({
        red: '高风险', yellow: '中风险', green: '低风险',
    })[level] || '低风险';
    const companyRiskBadgeClass = (level) => ({
        red: 'bg-red-100 text-red-700 border-red-300',
        yellow: 'bg-amber-100 text-amber-700 border-amber-300',
        green: 'bg-green-100 text-green-700 border-green-300',
    })[level] || 'bg-green-100 text-green-700 border-green-300';
    const companyCardBorderClass = (level) => ({
        red: 'border-l-4 border-l-red-500',
        yellow: 'border-l-4 border-l-amber-500',
        green: '',
    })[level] || '';
    const sortedCompanyReview = computed(() => {
        const list = reviewData.company_review || [];
        return [...list].sort((a, b) => {
            const oa = companyRiskOrder[companyRiskLevel(a)] ?? 2;
            const ob = companyRiskOrder[companyRiskLevel(b)] ?? 2;
            return oa - ob;
        });
    });
    const expandedCompanyCards = ref([]);
    const toggleCompanyCard = (index) => {
        const i = expandedCompanyCards.value.indexOf(index);
        if (i >= 0) expandedCompanyCards.value.splice(i, 1);
        else expandedCompanyCards.value.push(index);
    };
    // data_source 标识(Task 2.6):从 authenticity 解析数据来源
    const dataSourceLabel = (authenticity) => {
        const text = String(authenticity || '');
        if (/mock/i.test(text)) return '模拟数据';
        if (/web_search_fallback|fallback/i.test(text)) return '网页搜索回退';
        if (/tiyanji|qichacha|gsxt/i.test(text)) return '已核验';
        if (text) return '外部检索';
        return '';
    };
    const dataSourceClass = (authenticity) => {
        const text = String(authenticity || '');
        if (/mock/i.test(text)) return 'bg-gray-100 text-gray-500';
        if (/web_search_fallback|fallback/i.test(text)) return 'bg-gray-100 text-gray-500';
        if (/tiyanji|qichacha|gsxt/i.test(text)) return 'bg-blue-50 text-blue-600';
        if (text) return 'bg-gray-100 text-gray-500';
        return '';
    };
    // 法条时效性警告(Task 1.8)
    const isLawOutdated = (item) => {
        if (!item) return false;
        if (item.hasUpdate === true) return true;
        const status = item.law_status;
        return !!status && status !== '现行';
    };

    // 3.1 增量审查:执行条款级增量审查
    const runIncrementalReview = async () => {
        if (!contract.id || incrementalReviewLoading.value) return;
        incrementalReviewLoading.value = true;
        try {
            const payload = {};
            if (selectedTemplateId.value) payload.templateId = selectedTemplateId.value;
            const response = await api.reviewIncremental(contract.id, payload);
            const result = response.data || {};
            if (result.message && !result.diff_clauses?.length) {
                ElMessage.info(result.message);
                contractModifiedNotice.value = null;
                return;
            }
            // 同步增量审查结果到 reviewData
            const newRisks = Array.isArray(result.new_risks) ? result.new_risks : [];
            const resolvedRisks = Array.isArray(result.resolved_risks) ? result.resolved_risks : [];
            // 标记历史风险中已解决的
            reviewData.dispute_points = reviewData.dispute_points.map((dp) => (
                resolvedRisks.includes(dp.title) ? { ...dp, resolved: true } : dp
            ));
            // 追加新增风险
            const enrichedNewRisks = newRisks.map((r) => ({ ...r, isNewIncremental: true }));
            reviewData.dispute_points = [...enrichedNewRisks, ...reviewData.dispute_points];
            // 追加审查记录
            const reviewRecord = {
                reviewed_at: result.reviewed_at,
                diff_summary: {
                    modified: result.diff_clauses?.filter((d) => d.change_type === 'modified').length || 0,
                    added: result.diff_clauses?.filter((d) => d.change_type === 'added').length || 0,
                    deleted: result.diff_clauses?.filter((d) => d.change_type === 'deleted').length || 0,
                },
                new_risks: newRisks,
                resolved_risks: resolvedRisks,
            };
            if (!reviewData.incremental_reviews) reviewData.incremental_reviews = [];
            reviewData.incremental_reviews.push(reviewRecord);
            // 清除变更待审提示
            contractModifiedNotice.value = null;
            ElMessage.success(`增量审查完成:新增风险 ${newRisks.length} 项,已解决 ${resolvedRisks.length} 项`);
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '增量审查失败,请稍后重试');
        } finally {
            incrementalReviewLoading.value = false;
        }
    };

    // 增量审查时间格式化
    const formatIncrementalTime = (iso) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch {
            return iso;
        }
    };

    // 3.3 证据链联动:定位到合同原文(OnlyOffice 搜索)
    const handleLocateContract = (anchor) => {
        if (!anchor?.text) return;
        const editor = docEditorComponent.value?.editorInstance || docEditorComponent.value;
        // 优先调 OnlyOffice 的搜索 API
        try {
            const inst = editor?.editorInstance ? editor.editorInstance() : (typeof editor === 'function' ? editor() : editor);
            if (inst && typeof inst.searchAndReplace === 'function') {
                inst.searchAndReplace({ searchText: anchor.text, replaceText: anchor.text, lookAt: 'all' });
                ElMessage.success('已定位到合同原文');
                return;
            }
            if (inst && typeof inst.search === 'function') {
                inst.search(anchor.text);
                ElMessage.success('已定位到合同原文');
                return;
            }
        } catch (e) {
            console.warn('OnlyOffice search failed:', e);
        }
        ElMessage.info('当前 OnlyOffice 版本未开放搜索接口,请手动在左侧编辑器中查找:「' + anchor.text.slice(0, 40) + '...」');
    };

    // 3.3 证据链联动:查看法条弹窗
    const handleViewLaw = (ref) => {
        currentLawRef.value = ref;
        viewLawDialogVisible.value = true;
    };

    // 3.2 印章分析 UI 辅助:卡片整体样式
    const sealItemClass = (item) => {
        if (item?.source === 'vision') {
            if (item.ps_suspect) return 'bg-red-50 border-red-300 border-l-4 border-l-red-500';
            if (item.position_compliant) return 'bg-green-50 border-green-200 border-l-4 border-l-green-500';
            return 'bg-amber-50 border-amber-200 border-l-4 border-l-amber-500';
        }
        return 'bg-gray-50 border-gray-200';
    };

    // 3.2 印章分析 UI 辅助:状态文字样式
    const sealStatusClass = (item) => {
        if (item?.source === 'vision') {
            if (item.ps_suspect) return 'text-red-700';
            if (item.position_compliant) return 'text-green-700';
            return 'text-amber-700';
        }
        return item?.status === '正常' ? 'text-green-600' : 'text-orange-600';
    };

    // 4.1 谈判推演:展开/收起面板,首次展开时调用后端模拟
    const toggleNegotiation = async (item) => {
        // 已有结果:仅切换显示
        if (item._negotiation || item._negotiationError) {
            item._showNegotiation = !item._showNegotiation;
            return;
        }
        // 首次推演
        item._showNegotiation = true;
        item._negotiationLoading = true;
        try {
            const response = await api.simulateNegotiation(contract.id, {
                suggestionIds: item.id ? [item.id] : [],
            });
            const data = response.data || {};
            const results = Array.isArray(data.results) ? data.results : [];
            // 后端按 suggestion_id 关联,未指定 id 时返回单条
            const matched = results.length > 0 ? results[0] : null;
            if (matched?.simulation) {
                item._negotiation = {
                    counterparty_perspective: data.counterparty_perspective || matched.simulation.counterparty_perspective,
                    ...matched.simulation,
                };
            } else if (matched?.error) {
                item._negotiationError = matched.error;
            } else {
                item._negotiationError = '未返回推演结果';
            }
        } catch (error) {
            item._negotiationError = error.response?.data?.error || error.message || '请求失败';
        } finally {
            item._negotiationLoading = false;
        }
    };

    // 4.1 谈判推演:采纳折中方案,替换 suggested_text
    const adoptFallbackOption = (item, opt) => {
        if (!opt?.text) return;
        // 记录原始 suggested_text 以便撤销(若未采纳过)
        if (!item.adopted && !item.adopted_original) {
            item.adopted_original = item.suggested_text || item.modification || '';
        }
        item.suggested_text = opt.text;
        if ('modification' in item) item.modification = opt.text;
        item.adopted = true;
        item._negotiation._adoptedFallback = true;
        ElMessage.success('已采纳折中方案,可在文档中应用');
    };
    const reviewTemplates = ref([]);
    const selectedTemplateId = ref('');

    const allSuggestedReviewPoints = ref([]);
    const allPotentialParties = ref([]);
    const allSuggestedCorePurposes = ref([]);

    const initialContractState = {
      id: null,
      original_filename: '',
      editorConfig: null,
    };
    const contract = reactive({ ...initialContractState });

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
                // 后端推送的是单步进度事件，更新对应步骤的状态
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

        // 长合同分层审查：条款级进度推送（Task 2.5）
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
            ElMessage.error(data?.error || '分析失败，请稍后重试');
        });

        // 3.1 增量审查:监听合同保存后变更通知
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
            // 断线时启动轮询恢复
            if (analysisActive.value) startStatusPolling();
        });
    };

    const preAnalysisData = reactive({
      contract_type: '',
      potential_parties: [],
      suggested_review_points: [],
      suggested_core_purposes: [],
      template_id: '',
      template_name: '',
    });
    const showContractPreview = ref(false);
    const contractPreviewText = computed(() => {
        const preview = preAnalysisData.text_stats?.preview;
        if (preview) return preview;
        return '暂无预览内容。';
    });
    // --- Inline Q&A Chat Widget ---
    const qaPanelOpen = ref(false);
    const qaInput = ref('');
    const qaMessages = ref([]);
    const qaLoading = ref(false);
    const qaChatBody = ref(null);
    const qaSessionId = ref(localStorage.getItem('qa_session_id') || uuidv4());
    if (!localStorage.getItem('qa_session_id')) {
        localStorage.setItem('qa_session_id', qaSessionId.value);
    }
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
        // 使用索引通过响应式数组修改消息，确保打字机效果实时渲染
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
                        // 通过响应式数组索引修改，触发 Vue 响应式更新
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
    const selectedReviewPoints = ref([]);
    const customPurposes = ref([{ value: '' }]);

    const reviewData = reactive({
      dispute_points: [],
      missing_clauses: [],
      party_review: [],
      modification_suggestions: [],
      breach_cost_analysis: [],
      seal_analysis: [],
      relevant_laws: [],
      incremental_reviews: [],
      standard_comparison: [],
    });

    // 3.1 增量审查状态
    const contractModifiedNotice = ref(null);
    const incrementalReviewLoading = ref(false);
    const incrementalReviews = computed(() => reviewData.incremental_reviews || []);
    // 3.3 证据链联动:法条查看弹窗
    const viewLawDialogVisible = ref(false);
    const currentLawRef = ref(null);

    const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim()) || '';

    const joinLines = (...values) => values.filter(value => typeof value === 'string' && value.trim()).join('\n');

    const disputeTitle = (item, index) => firstText(item.title, item.type, item.original_clause, `风险点 ${index + 1}`);

    const disputeDescription = (item) => firstText(
      item.description,
      joinLines(
        item.original_clause && `原文：${item.original_clause}`,
        item.legal_reference && `法律依据：${item.legal_reference}`,
        item.dispute_rationale && `风险说明：${item.dispute_rationale}`,
      )
    );

    const missingClauseTitle = (item, index) => firstText(item.title, item.clause_type, `缺失条款 ${index + 1}`);

    const partyReviewTitle = (item, index) => firstText(item.title, item.review_point, `主体审查 ${index + 1}`);

    const partyReviewDescription = (item) => firstText(
      item.description,
      joinLines(
        item.party_A && `甲方：${item.party_A}`,
        item.party_B && `乙方：${item.party_B}`,
        item.status && `状态：${item.status}`,
        item.issue && `问题：${item.issue}`,
      )
    );

    const suggestionTitle = (item, index) => firstText(item.title, item.clause, `修改建议 ${index + 1}`);

    const suggestionOriginal = (item) => {
      const direct = firstText(item.original_text, item.original_clause);
      if (direct) return direct;
      const title = firstText(item.clause, item.title);
      const relatedRisk = (reviewData.dispute_points || []).find((risk) => {
        return firstText(risk.type, risk.title).includes(title) || title.includes(firstText(risk.type, risk.title));
      });
      return firstText(relatedRisk?.original_clause, title);
    };

    const suggestionText = (item) => firstText(item.suggested_text, item.modification);

    const suggestionReason = (item) => firstText(item.reason, item.rationale);

    const onlyOfficeUrl = import.meta.env.VITE_APP_ONLYOFFICE_URL;

    const loadReviewTemplates = async () => {
      try {
        const response = await api.getReviewTemplates();
        const list = response.data.items || response.data || [];
        reviewTemplates.value = list;
        // 若当前未选择模板,或所选模板不在列表中,自动选第一个
        if (list.length) {
          const exists = list.some((t) => t.id === selectedTemplateId.value);
          if (!selectedTemplateId.value || !exists) {
            selectedTemplateId.value = list[0].id;
          }
        } else {
          ElMessage.warning('审查模板列表为空,请联系管理员初始化模板数据。');
        }
      } catch (error) {
        console.error('Failed to load review templates:', error);
        ElMessage.error('审查模板加载失败,请检查后端服务是否正常。');
      }
    };

    const handleBeforeUpload = (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const isValid = ['docx', 'pdf'].includes(ext);
        if (!isValid) {
            ElMessage.error('只能上传 DOCX 或 PDF 格式的文件！');
            return false;
        }
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            ElMessage.error('文件大小超过 50MB 限制，请压缩或拆分后上传。');
            return false;
        }
        loading.value = true;
        loadingMessage.value = '正在上传并为您准备编辑器...';
        return isValid;
    };

    const handleUploadSuccess = async (res) => {
        contract.id = res.contractId;
        contract.editorConfig = res.editorConfig;
        contract.original_filename = res.editorConfig.document.title;
        setupSocket(contract.id);

        // Start pre-analysis immediately after upload
        loading.value = true;
        loadingMessage.value = 'AI正在进行初步分析，请稍候...';
        try {
            const preAnalysisRes = await api.preAnalyzeContract({ contractId: contract.id });
            Object.assign(preAnalysisData, preAnalysisRes.data);
            selectedTemplateId.value = preAnalysisData.template_id || selectedTemplateId.value || '';
            allSuggestedReviewPoints.value = [...preAnalysisData.suggested_review_points];
            allPotentialParties.value = [...preAnalysisData.potential_parties];
            allSuggestedCorePurposes.value = [...preAnalysisData.suggested_core_purposes];
            // Pre-select all suggested review points by default
            selectedReviewPoints.value = [...preAnalysisData.suggested_review_points];
            // Pre-fill core purposes from AI suggestions
            if (preAnalysisData.suggested_core_purposes && preAnalysisData.suggested_core_purposes.length > 0) {
              customPurposes.value = preAnalysisData.suggested_core_purposes.map(p => ({ value: p }));
            } else {
              customPurposes.value = [{ value: '示例：确保权利与义务对等' }];
            }
            activeStep.value = 1;
        } catch (err) {
            ElMessage.error(err.response?.data?.error || '预分析失败，请重试。');
            resetState(); // Go back to upload if pre-analysis fails
        } finally {
            loading.value = false;
        }
    };

    const handleUploadError = () => {
        loading.value = false;
        ElMessage.error('上传失败，请检查后端服务是否正常。');
    };

    const validateContractFile = (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['docx', 'pdf'].includes(ext);
    };

    const openLinkedFilePicker = () => {
        linkedFileInput.value?.click();
    };

    const setLinkedProgress = (key, status, message) => {
        const labels = {
            select: '选择文件',
            group: '创建分析记录',
            upload: '上传关联合同',
            analyze: 'AI 关联分析',
            save: '保存分析结果',
        };
        const existing = linkedAnalysisProgress.value.find(item => item.key === key);
        const payload = { key, label: labels[key] || key, status, message };
        if (existing) {
            Object.assign(existing, payload);
        } else {
            linkedAnalysisProgress.value.push(payload);
        }
    };

    const handleLinkedFilesChange = (event) => {
        const files = Array.from(event.target.files || []);
        const validFiles = files.filter(validateContractFile);
        if (validFiles.length !== files.length) {
            ElMessage.warning('已忽略非 DOCX / PDF 格式文件。');
        }
        linkedGroupFiles.value = validFiles;
        linkedAnalysisResult.value = null;
        linkedAnalysisProgress.value = [];
        if (validFiles.length) {
            setLinkedProgress('select', validFiles.length >= 2 ? 'done' : 'running', `已选择 ${validFiles.length} 份合同。`);
        }
    };

    const uploadContractToGroup = async (file, groupId, userId) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);
        formData.append('groupId', groupId);
        return api.uploadContract(formData);
    };

    const startLinkedContractAnalysis = async () => {
        const userId = getUserId();
        if (!userId) {
            ElMessage.error('无法获取用户身份，请刷新页面重试。');
            return;
        }
        if (linkedGroupFiles.value.length < 2) {
            ElMessage.warning('请至少选择 2 份合同文件。');
            return;
        }

        linkedAnalysisLoading.value = true;
        linkedAnalysisResult.value = null;
        try {
            setLinkedProgress('group', 'running', '正在创建关联合同分析记录。');
            const groupName = `关联合同组 ${new Date().toLocaleString('zh-CN')}`;
            const groupRes = await api.createContractGroup({ name: groupName });
            const groupId = groupRes.data.id;
            setLinkedProgress('group', 'done', '分析记录已创建。');
            setLinkedProgress('upload', 'running', '正在上传所选合同。');
            await Promise.all(linkedGroupFiles.value.map((file) => uploadContractToGroup(file, groupId, userId)));
            setLinkedProgress('upload', 'done', '合同上传完成。');
            setLinkedProgress('analyze', 'running', 'AI 正在识别条款冲突与共同风险。');
            const analysisRes = await api.analyzeContractGroup(groupId);
            linkedAnalysisResult.value = analysisRes.data.result || {};
            setLinkedProgress('analyze', 'done', '关联分析完成。');
            setLinkedProgress('save', 'done', '分析结果已保存，可在历史记录中查看。');
            ElMessage.success('多合同关联分析已完成。');
        } catch (error) {
            setLinkedProgress('analyze', 'failed', error.response?.data?.error || '多合同关联分析失败。');
            ElMessage.error(error.response?.data?.error || '多合同关联分析失败，请稍后重试。');
        } finally {
            linkedAnalysisLoading.value = false;
        }
    };

    const uploadAndGo = async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const userId = getUserId();
        if (!userId) {
            ElMessage.error("无法获取用户身份，请刷新页面重试。");
            loading.value = false;
            return;
        }
        formData.append('userId', userId);

        try {
            const res = await api.uploadContract(formData);
            handleUploadSuccess(res.data);
        } catch (err) {
            handleUploadError();
        }
    };

    const goBackToUpload = () => {
        console.log('[DEBUG] goBackToUpload clicked.');
        resetState();
    };

    const goBackToConfirm = () => {
      activeStep.value = 1;
      isEditorReady.value = false;
    };

    const startStatusPolling = () => {
        if (statusPollTimer.value) return;
        statusPollTimer.value = setInterval(async () => {
            if (!contract.id) return;
            try {
                const res = await api.getAnalyzeStatus(contract.id);
                const data = res.data;
                if (typeof data.percent === 'number') analysisPercent.value = data.percent;
                if (Array.isArray(data.steps)) analysisSteps.value = data.steps;
                if (typeof data.elapsedSeconds === 'number') analysisElapsed.value = data.elapsedSeconds;
                if (data.status === 'completed' && data.result) {
                    Object.assign(reviewData, data.result);
                    analysisActive.value = false;
                    loading.value = false;
                    reAnalyzing.value = false;
                    activeStep.value = 2;
                    stopStatusPolling();
                    ElMessage.success('审查完成。');
                } else if (data.status === 'failed') {
                    analysisActive.value = false;
                    loading.value = false;
                    reAnalyzing.value = false;
                    stopStatusPolling();
                    ElMessage.error(data.error || '分析失败，请稍后重试');
                }
            } catch (err) {
                console.warn('[Status Poll] Failed to fetch analysis status:', err.message);
            }
        }, 3000);
    };

    const stopStatusPolling = () => {
        if (statusPollTimer.value) {
            clearInterval(statusPollTimer.value);
            statusPollTimer.value = null;
        }
    };

    const startAnalysis = async () => {
        if (!perspective.value) {
            ElMessage.warning('请输入您的审查立场。');
            return;
        }
        loading.value = true;
        analysisActive.value = true;
        analysisPercent.value = 0;
        analysisEta.value = 0;
        analysisElapsed.value = 0;
        analysisProgress.value = [];
        analysisSteps.value = [];
        clauseProgress.value = { reviewed: 0, total: 0, current_clause_id: '' };
        loadingMessage.value = 'AI 正在深度审查合同，请通过下方进度追踪实时查看状态...';
        try {
            const analysisPayload = {
                contractId: contract.id,
                userPerspective: perspective.value,
                preAnalysisData: {
                    contract_type: preAnalysisData.contract_type,
                    potential_parties: allPotentialParties.value,
                    suggested_review_points: allSuggestedReviewPoints.value,
                    suggested_core_purposes: allSuggestedCorePurposes.value,
                    reviewPoints: selectedReviewPoints.value,
                    core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                    template_id: selectedTemplateId.value,
                },
            };
            // 异步启动：后端立即返回 jobId，实际结果通过 socket 推送
            const res = await api.analyzeContract(analysisPayload);
            analysisJobId.value = res.data.jobId;
            if (Array.isArray(res.data.steps)) {
                analysisSteps.value = res.data.steps.map((s) => ({ ...s, status: 'pending', message: '' }));
            }
            // 若 socket 未连接，启动轮询作为兜底
            if (!socket.value || !socket.value.connected) {
                startStatusPolling();
            }
        } catch(err) {
            const errorMessage = err.response?.data?.error || '启动分析失败，请稍后重试';
            ElMessage.error(errorMessage);
            analysisActive.value = false;
            loading.value = false;
        }
    };

    const addPurpose = () => {
      customPurposes.value.push({ value: '' });
    };

    const removePurpose = (index) => {
      customPurposes.value.splice(index, 1);
    };

    const forceSaveCurrentDocument = async (silent = true) => {
      if (!contract.id || forceSaveInFlight.value) return false;
      forceSaveInFlight.value = true;
      try {
        const editor = getEditor();
        if (typeof editor?.serviceCommand === 'function') {
          editor.serviceCommand('forcesave', {});
        }
        await api.forceSaveContract(contract.id, {
          documentKey: contract.editorConfig?.document?.key,
        });
        hasPendingEditorChanges.value = false;
        if (!silent) ElMessage.success('已触发文档保存同步');
        return true;
      } catch (error) {
        console.warn('[OnlyOffice] force-save failed', error.response?.data || error.message);
        if (!silent) ElMessage.warning(error.response?.data?.error || '触发文档保存同步失败');
        return false;
      } finally {
        forceSaveInFlight.value = false;
      }
    };

    const scheduleForceSave = (delay = 1200) => {
      if (!contract.id) return;
      if (forceSaveDebounceTimer.value) {
        clearTimeout(forceSaveDebounceTimer.value);
      }
      forceSaveDebounceTimer.value = setTimeout(() => {
        forceSaveDebounceTimer.value = null;
        forceSaveCurrentDocument(true);
      }, delay);
    };

    const stopAutoForceSave = () => {
      if (forceSaveTimer.value) {
        clearInterval(forceSaveTimer.value);
        forceSaveTimer.value = null;
      }
      if (forceSaveDebounceTimer.value) {
        clearTimeout(forceSaveDebounceTimer.value);
        forceSaveDebounceTimer.value = null;
      }
    };

    const startAutoForceSave = () => {
      stopAutoForceSave();
      forceSaveTimer.value = setInterval(() => {
        if (hasPendingEditorChanges.value) {
          forceSaveCurrentDocument(true);
        }
      }, 30000);
    };

    const onDocumentStateChange = (event) => {
      const changed = typeof event === 'boolean' ? event : Boolean(event?.data);
      hasPendingEditorChanges.value = changed;
      if (changed) {
        scheduleForceSave();
      }
    };

    const onDocumentReady = () => {
      console.log("[INFO] OnlyOffice document is ready.");
      setTimeout(() => {
        isEditorReady.value = Boolean(window?.DocEditor?.instances?.docEditorComponent);
        if (isEditorReady.value) startAutoForceSave();
      }, 300);
    };

    const startReAnalysis = async () => {
      if (!perspective.value) {
        ElMessage.warning('请选择您的审查立场。');
        return;
      }
      reAnalyzing.value = true;
      loading.value = true;
      analysisActive.value = true;
      analysisPercent.value = 0;
      analysisEta.value = 0;
      analysisElapsed.value = 0;
      analysisProgress.value = [];
      analysisSteps.value = [];
      clauseProgress.value = { reviewed: 0, total: 0, current_clause_id: '' };
      loadingMessage.value = '正在重新审查合同，请通过进度追踪查看状态...';
      try {
        const analysisPayload = {
          contractId: contract.id,
          userPerspective: perspective.value,
          preAnalysisData: {
                contract_type: preAnalysisData.contract_type,
                potential_parties: allPotentialParties.value,
                suggested_review_points: allSuggestedReviewPoints.value,
                suggested_core_purposes: allSuggestedCorePurposes.value,
                reviewPoints: selectedReviewPoints.value,
                core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                template_id: selectedTemplateId.value,
            },
        };
        const res = await api.analyzeContract(analysisPayload);
        analysisJobId.value = res.data.jobId;
        if (Array.isArray(res.data.steps)) {
            analysisSteps.value = res.data.steps.map((s) => ({ ...s, status: 'pending', message: '' }));
        }
        if (!socket.value || !socket.value.connected) {
            startStatusPolling();
        }
        // 结果通过 socket analysis-complete 事件或轮询更新，此处不等待
      } catch(err) {
        const errorMessage = err.response?.data?.error || '重审失败，请稍后重试';
        ElMessage.error(errorMessage);
        reAnalyzing.value = false;
        loading.value = false;
        analysisActive.value = false;
      }
    };

    const loadContractFromServer = async (contractId) => {
        loading.value = true;
        loadingMessage.value = '正在从历史记录加载合同...';
        try {
            // This endpoint needs to be created in the backend
            // It should return the full state needed for the review page
            const response = await api.getContractDetails(contractId);
            const contractData = response.data;

            // Populate all the relevant states from the fetched data
            activeStep.value = 2; // Directly go to the review step
            Object.assign(contract, contractData.contract);
            setupSocket(contract.id);
            perspective.value = contractData.perspective;
            Object.assign(preAnalysisData, contractData.preAnalysisData || {});
            selectedTemplateId.value = preAnalysisData.template_id || '';
            // The server now returns the complete list, so we can trust it.
            // Add defensive checks to prevent crashes if preAnalysisData or its keys are missing.
            allSuggestedReviewPoints.value = contractData.preAnalysisData?.suggested_review_points || [];
            allPotentialParties.value = contractData.preAnalysisData?.potential_parties || [];
            allSuggestedCorePurposes.value = contractData.preAnalysisData?.suggested_core_purposes || [];
            // The server also returns the specific selections for this historical review
            selectedReviewPoints.value = contractData.selectedReviewPoints || [];
            customPurposes.value = contractData.customPurposes || [{ value: '' }];
            Object.assign(reviewData, contractData.reviewData || {});

            // Save this loaded state to localStorage so a refresh works correctly
            saveState();

            // 加载该合同的专项审查历史
            loadFocusedReviewHistory();

        } catch (error) {
            console.error(`Failed to load contract ${contractId} from server:`, error);
            ElMessage.error('加载历史记录失败，将返回首页。');
            router.push('/');
            resetState(); // Clear any partial state
        } finally {
            loading.value = false;
        }
    };

    // --- State Persistence Logic ---

    const saveState = () => {
        if (isResetting) return; // Prevent saving state during a programmatic reset

        const stateToSave = {
            activeStep: activeStep.value,
            contract: toRaw(contract),
            perspective: perspective.value,
            preAnalysisData: toRaw(preAnalysisData),
            selectedReviewPoints: selectedReviewPoints.value,
            customPurposes: customPurposes.value,
            reviewData: toRaw(reviewData),
            activeAiTab: activeAiTab.value,
            cameFromHistory: cameFromHistory.value,
            allSuggestedReviewPoints: allSuggestedReviewPoints.value,
            allPotentialParties: allPotentialParties.value,
            allSuggestedCorePurposes: allSuggestedCorePurposes.value,
            selectedTemplateId: selectedTemplateId.value,
        };
        // Only save if a contract has been uploaded to avoid storing empty sessions
        if (stateToSave.contract && stateToSave.contract.id) {
            localStorage.setItem('review_session', JSON.stringify(stateToSave));
        }
    };

    const querySearchCorePurposes = (queryString, cb) => {
        const results = queryString
            ? allSuggestedCorePurposes.value.filter(p => p.toLowerCase().includes(queryString.toLowerCase()))
            : allSuggestedCorePurposes.value;
        // The autocomplete component expects an array of objects with a `value` key.
        cb(results.map(p => ({ value: p })));
    };

    // Watch for any state changes and save them
    watch([activeStep, perspective, activeAiTab, selectedTemplateId], saveState);
    watch([
        contract,
        preAnalysisData,
        reviewData,
        selectedReviewPoints,
        customPurposes,
        allSuggestedReviewPoints,
        allPotentialParties,
        allSuggestedCorePurposes,
    ], saveState, { deep: true });

    const restoreSessionFromSavedState = async (savedState) => {
        // Fetch fresh contract editorConfig from the server to get a new, valid token.
        const response = await api.getContractDetails(savedState.contract.id);
        const serverEditorConfig = response.data.contract.editorConfig;

        // Restore UI state from localStorage, as it's the source of truth for user's work.
        activeStep.value = savedState.activeStep;
        activeAiTab.value = savedState.activeAiTab || 'suggestions';
        if (!['summary', 'suggestions', 'knowledge', 'workspace'].includes(activeAiTab.value)) {
          activeAiTab.value = 'summary';
        }

        // Restore data objects from savedState
        Object.assign(contract, savedState.contract);
        // CRITICAL: Overwrite with the fresh editor config from the server.
        contract.editorConfig = serverEditorConfig;
        setupSocket(contract.id);

        perspective.value = savedState.perspective;
        Object.assign(preAnalysisData, savedState.preAnalysisData || {});
        selectedTemplateId.value = savedState.selectedTemplateId || preAnalysisData.template_id || '';
        Object.assign(reviewData, savedState.reviewData || {});

        // Restore lists from savedState
        selectedReviewPoints.value = savedState.selectedReviewPoints || [];
        customPurposes.value = savedState.customPurposes || [{ value: '' }];
        allSuggestedReviewPoints.value = savedState.allSuggestedReviewPoints || [];
        allPotentialParties.value = savedState.allPotentialParties || [];
        allSuggestedCorePurposes.value = savedState.allSuggestedCorePurposes || [];

        // 恢复会话后加载该合同的专项审查历史
        loadFocusedReviewHistory();
    };

    const loadState = async () => {
        const savedStateJSON = localStorage.getItem('review_session');
        if (savedStateJSON) {
            try {
                const savedState = JSON.parse(savedStateJSON);
                if (savedState.contract && savedState.contract.id) {
                    loading.value = true;
                    loadingMessage.value = '正在恢复您的会话...';
                    sessionLoadFailed.value = false;

                    try {
                        await restoreSessionFromSavedState(savedState);
                    } catch (error) {
                         console.error(`Failed to refresh session for contract ${savedState.contract.id}:`, error);
                         // 不再直接 resetState()，保留 localStorage 会话，提供重试入口
                         sessionLoadFailed.value = true;
                         ElMessage.error('恢复会话失败（可能是网络问题）。可点击"重试"重新加载，您的工作进度已保留。');
                    } finally {
                        loading.value = false;
                    }
                }
            } catch (e) {
                console.error("Failed to parse saved state, clearing invalid session.", e);
                localStorage.removeItem('review_session');
            }
        }
    };

    // 重试恢复会话（不丢失工作进度）
    const retryLoadSession = async () => {
        const savedStateJSON = localStorage.getItem('review_session');
        if (!savedStateJSON) {
            sessionLoadFailed.value = false;
            return;
        }
        loading.value = true;
        loadingMessage.value = '正在重试恢复会话...';
        try {
            const savedState = JSON.parse(savedStateJSON);
            await restoreSessionFromSavedState(savedState);
            sessionLoadFailed.value = false;
            ElMessage.success('会话恢复成功。');
        } catch (error) {
            ElMessage.error('重试失败，请检查网络后再次点击重试。');
        } finally {
            loading.value = false;
        }
    };

    const resetState = () => {
      console.log('[DEBUG] resetState called.');
      isResetting = true; // Lock the saving mechanism
      activeStep.value = 0;
      loading.value = false;
      loadingMessage.value = '';
      Object.assign(contract, initialContractState);
      perspective.value = '';
      Object.assign(reviewData, {
        dispute_points: [],
        missing_clauses: [],
        party_review: [],
        company_review: [],
        modification_suggestions: [],
        breach_cost_analysis: [],
        seal_analysis: [],
        relevant_laws: [],
        hard_violations: [],
        incremental_reviews: [],
        standard_comparison: [],
      });
      contractModifiedNotice.value = null;
      incrementalReviewLoading.value = false;
      viewLawDialogVisible.value = false;
      currentLawRef.value = null;
      isEditorReady.value = false;
      // Reset new states
      Object.assign(preAnalysisData, { contract_type: '', potential_parties: [], suggested_review_points: [], suggested_core_purposes: [], template_id: '', template_name: '' });
      selectedTemplateId.value = 'general';
      selectedReviewPoints.value = [];
      customPurposes.value = [{ value: '' }];
      allSuggestedReviewPoints.value = [];
      allPotentialParties.value = [];
      allSuggestedCorePurposes.value = [];
      selectedSuggestionPreview.value = null;
      focusedReviewText.value = '';
      focusedReviewQuestion.value = '';
      focusedReviewResult.value = null;
      focusedReviewLoading.value = false;
      // Clear the session from localStorage
      localStorage.removeItem('review_session');
      console.log('[DEBUG] review_session removed from localStorage.');

      // Use nextTick to ensure the DOM has updated and state changes have propagated
      // before we unlock the saving mechanism.
      nextTick(() => {
        isResetting = false;
        console.log('[DEBUG] resetState finished and lock released.');
      });
    };

    // This is the correct guard for handling navigation that reuses the same component instance.
    onBeforeRouteUpdate((to, from) => {
      console.log(`[DEBUG] onBeforeRouteUpdate: from ${from.fullPath} to ${to.fullPath}`);
      // When navigating from a history-loaded review page (which has a contract_id)
      // back to the main 'start' page (which does not), we must reset the entire state
      // to ensure a completely fresh start.
      if (from.query.contract_id && !to.query.contract_id) {
          console.log('[DEBUG] Route condition met. Calling resetState.');
          resetState();
      }
    });

    // Load state from localStorage or from server if contract_id is in query
    onMounted(() => {
      loadReviewTemplates();
      const contractIdFromQuery = route.query.contract_id;
      if (contractIdFromQuery) {
        // If a contract_id is specified in the URL, it takes precedence.
        resetState();
        cameFromHistory.value = true; // Mark that we are in history-viewing mode
        loadContractFromServer(contractIdFromQuery);
      } else {
        // Otherwise, just try to load a session from localStorage.
        cameFromHistory.value = false;
        loadState();
      }
    });

    const goBackSmart = () => {
        if (cameFromHistory.value) {
            forceSaveCurrentDocument(true);
            router.push('/history');
        } else {
            forceSaveCurrentDocument(true);
            goBackToConfirm(); // Keep the original behavior for normal flow
        }
    };

    // 在当前页面打开智能问答浮窗，不再跳转页面
    const goToQnA = () => {
        forceSaveCurrentDocument(true);
        qaPanelOpen.value = true;
        scrollQaToBottom();
    };

    onUnmounted(() => {
        stopAutoForceSave();
        forceSaveCurrentDocument(true);
        stopStatusPolling();
        if (socket.value) socket.value.disconnect();
    });

    // --- OnlyOffice Connector Methods ---

    const getEditor = () => window?.DocEditor?.instances?.docEditorComponent || null;

    const executeEditorMethod = (method, args = []) => {
      const editor = getEditor();
      if (!editor || typeof editor.executeMethod !== 'function') {
        return Promise.reject(new Error('EDITOR_NOT_READY'));
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, 2500);
        try {
          editor.executeMethod(method, args, (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
          });
        } catch (error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    };

    const findTextRange = async (text) => {
        const result = await executeEditorMethod('Search', [text]);
        if (Array.isArray(result) && result.length > 0) return result[0];
        return null;
    };

    const normalizeCandidate = (text) => String(text || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, '')
        .trim();

    const splitCandidateSentences = (text) => String(text || '')
        .split(/(?<=[。！？；;.!?])|\n+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 6);

    const buildSuggestionCandidates = (originalText, item = {}) => {
        const candidates = [
            originalText,
            item.anchor_hint,
            item.original_clause,
            item.clause,
            ...splitCandidateSentences(originalText),
        ];
        const compact = normalizeCandidate(originalText);
        if (compact && compact !== originalText) candidates.push(compact);
        if (originalText && originalText.length > 80) {
            candidates.push(originalText.slice(0, 80));
            candidates.push(originalText.slice(-80));
        }
        const seen = new Set();
        return candidates
            .map((candidate) => String(candidate || '').trim())
            .filter((candidate) => candidate.length >= 4)
            .filter((candidate) => {
                const key = normalizeCandidate(candidate);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    };

    const findTextRangeByCandidates = async (candidates) => {
        for (const candidate of candidates) {
            const range = await findTextRange(candidate);
            if (range) return { range, matchedText: candidate };
        }
        return null;
    };

    const ensureEditorReady = () => {
        if (!getEditor()) {
            ElMessage.warning('编辑器尚未就绪，请等待左侧文档加载完成。');
            return false;
        }
        return true;
    };

    const previewSuggestion = (item, status = '待采纳') => {
        selectedSuggestionPreview.value = {
            before: suggestionOriginal(item) || 'AI 未返回可直接定位的原文。',
            after: suggestionText(item) || 'AI 未返回建议替换文本。',
            status,
        };
    };

    const locateText = async (text) => {
        if (!text) {
            ElMessage.info('AI 未返回可定位的原文，请在文档中手动核对该建议。');
            return;
        }
        if (!ensureEditorReady()) return;
        try {
            const range = await findTextRange(text);
            if (!range) {
                ElMessage.info('未在文档中找到对应条款原文。');
                return;
            }
            await executeEditorMethod('SelectRange', [range]);
            ElMessage.success('已定位到文档中的对应条款。');
        } catch (error) {
            ElMessage.error('文档定位失败，请检查 OnlyOffice 是否已完全加载。');
        }
    };

    const replaceTextOnServer = async (originalText, suggestedText, item = {}) => {
        const response = await api.replaceContractText(contract.id, {
            originalText,
            suggestedText,
            originalCandidates: buildSuggestionCandidates(originalText, item),
        });
        return response.data.replacements || 0;
    };

    const markAdoptedText = async (originalText, suggestedText) => {
        try {
            const replacement = await findTextRangeByCandidates([suggestedText, suggestedText.slice(0, 80), suggestedText.slice(-80)]);
            if (!replacement?.range) return;
            await executeEditorMethod('SelectRange', [replacement.range]);
            const highlightMethods = [
                ['SetHighlightColor', ['#FFF2A8']],
                ['SetTextHighlightColor', ['#FFF2A8']],
                ['SetHighlight', ['#FFF2A8']],
            ];
            for (const [method, args] of highlightMethods) {
                try {
                    await executeEditorMethod(method, args);
                    break;
                } catch {
                    // Try the next OnlyOffice build-specific method name.
                }
            }
            await executeEditorMethod('AddComment', [`采纳前原文：${originalText}`, 'AI 审查']).catch(() => null);
        } catch {
            // Highlight/comment support depends on the deployed OnlyOffice build.
        }
    };

    const replaceTextInEditor = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        const runServerFallback = async (statusPrefix = 'OnlyOffice 未开放当前编辑方法，已更新源文件') => {
            try {
                const replacements = await replaceTextOnServer(originalText, suggestedText, item);
                onSuccess?.({ fallback: true, replacements });
                ElMessage.success(`${statusPrefix}；当前编辑器不刷新，重新打开该合同后可见。`);
            } catch (serverError) {
                const message = serverError.response?.data?.error || '服务器替换失败，请缩短原文片段后重试。';
                ElMessage.error(message);
                onFailure?.(message);
            }
        };

        if (!ensureEditorReady()) {
            onFailure?.('编辑器尚未就绪，请稍候');
            return;
        }
        try {
            const matched = await findTextRangeByCandidates(buildSuggestionCandidates(originalText, item));
            if (!matched?.range) {
                await runServerFallback('编辑器未匹配到原文，已尝试从 DOCX 源文件替换');
                return;
            }
            await executeEditorMethod('SelectRange', [matched.range]);
            try {
                await executeEditorMethod('PasteText', [suggestedText]);
            } catch {
                await executeEditorMethod('ReplaceText', [matched.range, suggestedText]);
            }
            await markAdoptedText(originalText, suggestedText);
            onSuccess?.();
        } catch (error) {
            await runServerFallback();
        }
    };

    const refreshEditorDocument = async () => {
        const editor = getEditor();
        if (!editor) return false;

        try {
            const res = await api.getFreshEditorConfig(contract.id);
            const editorConfig = res.data?.editorConfig;
            if (editorConfig && typeof editor.refreshFile === 'function') {
                editor.refreshFile(editorConfig.document || editorConfig);
                contract.editorConfig = editorConfig;
                return true;
            }
            if (editorConfig && typeof editor.setConfig === 'function') {
                editor.setConfig(editorConfig);
                contract.editorConfig = editorConfig;
                return true;
            }
        } catch {
            // Some OnlyOffice builds do not allow changing config after init.
        }

        try {
            await executeEditorMethod('ForceSave', []);
            return true;
        } catch {
            return false;
        }
    };

    const serverFallback = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        try {
            const replacements = await replaceTextOnServer(originalText, suggestedText, item);
            const refreshed = await refreshEditorDocument();
            if (refreshed) {
                onSuccess?.({ fallback: true, refreshed: true, replacements });
                ElMessage.success('已更新源文件并尝试自动刷新编辑器');
            } else {
                onSuccess?.({ fallback: true, replacements });
                ElMessage.success('已更新源文件，刷新页面后可查看变更');
            }
        } catch (err) {
            const msg = err.response?.data?.error || '替换失败';
            ElMessage.error(msg);
            onFailure?.(msg);
        }
    };

    const replaceTextInEditorFinal = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        if (!ensureEditorReady()) {
            await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
            return;
        }

        let success = false;
        const editor = getEditor();

        try {
            const canUseLiveApi = typeof editor.executeMethod === 'function'
                || typeof editor.createConnector === 'function'
                || Boolean(window.Asc?.plugin?.callCommand);
            if (!canUseLiveApi) {
                await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
                return;
            }

            const matched = await findTextRangeByCandidates(buildSuggestionCandidates(originalText, item));
            if (matched?.range) {
                await executeEditorMethod('SelectRange', [matched.range]);
            }

            if (matched?.range && typeof editor.createConnector === 'function') {
                const connector = editor.createConnector();
                if (connector?.callCommand) {
                    const asc = window.Asc || (window.Asc = {});
                    asc.scope = asc.scope || {};
                    asc.scope.suggestedText = suggestedText;
                    await new Promise((resolve) => {
                        connector.callCommand(function() {
                            try {
                                const oDocument = Api.GetDocument();
                                const oRange = oDocument.GetRangeBySelect?.() || null;
                                if (oRange) oRange.Delete();
                                const oParagraph = Api.CreateParagraph();
                                oParagraph.AddText(Asc.scope.suggestedText);
                                oDocument.InsertContent([oParagraph], false, { KeepTextOnly: false });
                            } catch (e) {}
                        }, true);
                        setTimeout(resolve, 800);
                    });
                    success = true;
                }
            }

            if (!success && matched?.range && window.Asc?.plugin?.callCommand) {
                window.Asc.scope = window.Asc.scope || {};
                window.Asc.scope.suggestedText = suggestedText;
                await new Promise((resolve) => {
                    window.Asc.plugin.callCommand(function() {
                        try {
                            const oDocument = Api.GetDocument();
                            const oRange = oDocument.GetRangeBySelect?.() || null;
                            if (oRange) oRange.Delete();
                            const oParagraph = Api.CreateParagraph();
                            oParagraph.AddText(Asc.scope.suggestedText);
                            oDocument.InsertContent([oParagraph], false, { KeepTextOnly: false });
                        } catch (e) {}
                    }, true);
                    setTimeout(resolve, 800);
                });
                success = true;
            }

            if (!success && matched?.range) {
                await executeEditorMethod('SelectRange', [matched.range]);
                try {
                    await executeEditorMethod('PasteText', [suggestedText]);
                    success = true;
                } catch {}
                if (!success) {
                    try {
                        await executeEditorMethod('ReplaceText', [matched.range, suggestedText]);
                        success = true;
                    } catch {}
                }
            }

            if (success) {
                await markAdoptedText(originalText, suggestedText);
                onSuccess?.({ realTime: true });
                ElMessage.success('建议已实时采纳并更新到文档');
                return;
            }
        } catch (error) {
            console.warn('实时替换失败，进入服务器兜底', error);
        }

        await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
    };

    const prepareFocusedReviewFromSelection = async () => {
        activeAiTab.value = 'workspace';
        if (!ensureEditorReady()) return;

        try {
            const text = await executeEditorMethod('GetSelectedText', []);
            if (text && String(text).trim()) {
                focusedReviewText.value = String(text).trim();
                ElMessage.success('已读取左侧选中文本。');
            } else {
                ElMessage.info('未读取到选中文本，可在专项审查框中手动粘贴条款。');
            }
        } catch (error) {
            ElMessage.info('当前 OnlyOffice 版本未暴露选中文本接口，请手动粘贴条款进行专项审查。');
        }
    };

    const submitFocusedReview = async () => {
        if (!focusedReviewText.value.trim()) return;
        focusedReviewLoading.value = true;
        try {
            const response = await api.reviewSelectedText({
                text: focusedReviewText.value,
                question: focusedReviewQuestion.value,
                perspective: perspective.value,
                contractType: preAnalysisData.contract_type,
                templateId: selectedTemplateId.value,
                contractId: contract.id,
            });
            focusedReviewResult.value = response.data;
            // 重新加载历史列表以包含新保存的记录
            if (contract.id) loadFocusedReviewHistory();
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '专项审查失败，请稍后重试。');
        } finally {
            focusedReviewLoading.value = false;
        }
    };

    const loadFocusedReviewHistory = async () => {
        if (!contract.id) return;
        focusedReviewHistoryLoading.value = true;
        try {
            const response = await api.getFocusedReviews(contract.id);
            focusedReviewHistory.value = response.data.items || [];
        } catch (error) {
            // 静默失败，不影响主流程
            console.warn('Failed to load focused review history:', error);
        } finally {
            focusedReviewHistoryLoading.value = false;
        }
    };

    const loadFocusedReviewFromHistory = (item) => {
        focusedReviewText.value = item.source_text || '';
        focusedReviewQuestion.value = item.question || '';
        focusedReviewResult.value = item.result || null;
        ElMessage.success('已加载历史专项审查记录。');
    };

    const deleteFocusedReviewFromHistory = async (reviewId) => {
        try {
            await api.deleteFocusedReview(reviewId);
            focusedReviewHistory.value = focusedReviewHistory.value.filter((i) => i.id !== reviewId);
            ElMessage.success('已删除该条历史记录。');
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '删除失败，请稍后重试。');
        }
    };

    const formatHistoryTime = (timeStr) => {
        if (!timeStr) return '';
        try {
            const d = new Date(timeStr);
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch {
            return timeStr;
        }
    };

    const applyFocusedSuggestion = () => {
        if (!focusedReviewResult.value?.suggested_text) return;
        replaceTextInEditorFinal(focusedReviewText.value, focusedReviewResult.value.suggested_text, () => {
            selectedSuggestionPreview.value = {
                before: focusedReviewText.value,
                after: focusedReviewResult.value.suggested_text,
                status: '专项审查建议已替换到左侧文档',
            };
            focusedReviewText.value = focusedReviewResult.value.suggested_text;
            ElMessage.success('专项审查建议已更新到左侧文档。');
        }, (status) => {
            selectedSuggestionPreview.value = {
                before: focusedReviewText.value,
                after: focusedReviewResult.value.suggested_text,
                status,
            };
        });
    };

    const addDocComment = async (text, comment) => {
        if (!text) {
            ElMessage.info('AI 未返回可批注定位的原文，请手动添加批注。');
            return;
        }
        if (!ensureEditorReady()) return;
        try {
            const range = await findTextRange(text);
            if (!range) {
                ElMessage.info('定位原文失败，无法添加批注。');
                return;
            }
            await executeEditorMethod('SelectRange', [range]);
            const bookmark = `ai_review_${Date.now()}`;
            await executeEditorMethod('AddBookmark', [bookmark]).catch(() => null);
            await executeEditorMethod('AddComment', [comment || 'AI 审查建议', 'AI 审查专家']).catch(async () => {
                await executeEditorMethod('AddComment', [comment || 'AI 审查建议']);
            });
            ElMessage.success('已在文档中添加批注，并尝试写入书签锚点。');
        } catch (error) {
            ElMessage.error('添加批注失败：当前 OnlyOffice 未开放批注接口。');
        }
    };

    const adoptSuggestion = (item) => {
        const originalText = suggestionOriginal(item);
        const suggestedText = suggestionText(item);

        if (!originalText || !suggestedText) {
            ElMessage.warning('该建议缺少可自动替换的原文或建议文本，请手动修改。');
            return;
        }

        previewSuggestion(item, '正在采纳');
        replaceTextInEditorFinal(originalText, suggestedText, (result = {}) => {
            item.adopted = true;
            item.adopted_original = originalText;
            adoptedHighlights.value[suggestionTitle(item, 0)] = originalText;
            if (result.fallback) {
                selectedSuggestionPreview.value.status = '已写入源文件，当前页面未刷新';
                ElMessage.success('建议已采纳，源文件已更新；当前页面未刷新。');
            } else {
                selectedSuggestionPreview.value.status = '已实时更新到左侧文档';
                ElMessage.success('建议已采纳，左侧文档已更新。');
            }
        }, (status) => {
            selectedSuggestionPreview.value.status = status;
        }, item);
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const applySelectedSuggestions = async () => {
        const indexes = selectedSuggestionIndexes.value;
        if (!indexes.length) {
            ElMessage.warning('请选择要批量采纳的修改建议。');
            return;
        }
        batchApplying.value = true;
        try {
            const suggestions = indexes.map((index) => {
                const item = reviewData.modification_suggestions[index];
                return {
                    originalText: suggestionOriginal(item),
                    suggestedText: suggestionText(item),
                    originalCandidates: buildSuggestionCandidates(suggestionOriginal(item), item),
                };
            });
            const response = await api.batchReplaceContractText(contract.id, { suggestions });
            if (response.data.editorConfig) contract.editorConfig = response.data.editorConfig;
            indexes.forEach((index) => {
                if (reviewData.modification_suggestions[index]) reviewData.modification_suggestions[index].adopted = true;
            });
            ElMessage.success(`批量采纳完成，成功替换 ${response.data.totalReplacements || 0} 处。`);
            await loadLatestDiff();
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '批量采纳失败。');
        } finally {
            batchApplying.value = false;
        }
    };

    const loadLatestDiff = async () => {
        if (!contract.id) return;
        diffLoading.value = true;
        try {
            const response = await api.getContractDiff(contract.id);
            diffItems.value = response.data.diff || [];
            activeAiTab.value = 'workspace';
        } catch (error) {
            ElMessage.info(error.response?.data?.error || '暂无可对比的合同版本。');
        } finally {
            diffLoading.value = false;
        }
    };

    const exportReport = async (format = 'html') => {
        try {
            const response = await api.exportReviewReport(contract.id, format);
            downloadBlob(response.data, `合同审查报告.${format === 'word' ? 'doc' : format}`);
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '导出审查报告失败。');
        }
    };

    const downloadPdfAnnotations = async () => {
        try {
            const response = await api.downloadPdfAnnotations(contract.id);
            downloadBlob(response.data, 'PDF批注意见.txt');
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '导出 PDF 批注意见失败。');
        }
    };

    return {
      activeStep,
      loading,
      loadingMessage,
      sessionLoadFailed,
      retryLoadSession,
      contract,
      perspective,
      reviewData,
      activeAiTab,
      handleBeforeUpload,
      handleUploadSuccess,
      handleUploadError,
      handleLinkedFilesChange,
      openLinkedFilePicker,
      startLinkedContractAnalysis,
      linkedGroupFiles,
      linkedAnalysisLoading,
      linkedAnalysisResult,
      linkedAnalysisProgress,
      linkedFileInput,
      goBackToUpload,
      goBackToConfirm,
      startAnalysis,
      analysisPercent,
      analysisEta,
      analysisElapsed,
      analysisActive,
      analysisSteps,
      analysisJobId,
      formatDuration,
      docEditorComponent,
      isEditorReady,
      preAnalysisData,
      selectedReviewPoints,
      customPurposes,
      showContractPreview,
      contractPreviewText,
      qaPanelOpen,
      qaInput,
      qaMessages,
      qaLoading,
      qaChatBody,
      toggleQaPanel,
      sendQaMessage,
      handleQaEnter,
      clearQaChat,
      renderQaMarkdown,
      addPurpose,
      removePurpose,
      reAnalyzing,
      startReAnalysis,
      uploadAndGo,
      cameFromHistory,
      goBackSmart,
      goToQnA,
      onlyOfficeUrl,
      allSuggestedReviewPoints,
      allPotentialParties,
      reviewTemplates,
      selectedTemplateId,
      querySearchCorePurposes,
      onDocumentReady,
      onDocumentStateChange,
      showPlainLanguage,
      selectedSuggestionPreview,
      focusedReviewText,
      focusedReviewQuestion,
      focusedReviewResult,
      focusedReviewLoading,
      focusedReviewHistory,
      focusedReviewHistoryLoading,
      loadFocusedReviewFromHistory,
      deleteFocusedReviewFromHistory,
      formatHistoryTime,
      disputeTitle,
      disputeDescription,
      missingClauseTitle,
      partyReviewTitle,
      partyReviewDescription,
      suggestionTitle,
      suggestionOriginal,
      suggestionText,
      suggestionReason,
      isLawOutdated,
      // 3.1 增量审查
      contractModifiedNotice,
      incrementalReviewLoading,
      incrementalReviews,
      runIncrementalReview,
      formatIncrementalTime,
      // 3.2 印章分析 UI
      sealItemClass,
      sealStatusClass,
      // 3.3 证据链联动
      viewLawDialogVisible,
      currentLawRef,
      handleLocateContract,
      handleViewLaw,
      // 4.1 谈判推演
      toggleNegotiation,
      adoptFallbackOption,
      previewSuggestion,
      prepareFocusedReviewFromSelection,
      submitFocusedReview,
      applyFocusedSuggestion,
      locateText,
      addDocComment,
      adoptSuggestion,
      analysisProgress,
      visibleAnalysisProgress,
      clauseProgress,
      isPdfContract,
      severityFilter,
      filteredAndSortedDisputePoints,
      disputeSeverityStats,
      riskDashboard,
      hardViolations,
      adoptHardViolation,
      normalizeSeverity,
      severityLabel,
      severityClass,
      progressStepLabel,
      progressStatusLabel,
      progressStatusClass,
      selectedSuggestionIndexes,
      batchApplying,
      applySelectedSuggestions,
      diffItems,
      diffLoading,
      loadLatestDiff,
      exportReport,
      downloadPdfAnnotations
    };
  }
};
</script>

<style>
/* Add global overrides for Element Plus components we are keeping */
/* Select Dropdown */
.el-select-dropdown {
  @apply rounded-lg shadow-lg border border-border-color;
}
.el-select-dropdown__item {
  @apply text-text-main;
}
.el-select-dropdown__item.hover, .el-select-dropdown__item:hover {
  @apply bg-primary-light text-primary-dark;
}
.el-select-dropdown__item.selected {
  @apply text-primary-dark font-semibold;
}

/* Checkbox */
.el-checkbox.is-bordered {
 @apply bg-white border-border-color hover:border-primary;
}
.el-checkbox.is-bordered.is-checked {
  @apply border-primary;
}
.el-checkbox__inner {
  @apply border-border-color;
}
.el-checkbox__input.is-checked .el-checkbox__inner, .el-checkbox__input.is-indeterminate .el-checkbox__inner {
  @apply bg-primary border-primary;
}
.el-checkbox__label {
  @apply text-text-main;
}
.el-checkbox__input.is-checked+.el-checkbox__label {
  @apply text-primary;
}

/* Input */
.el-input__wrapper {
  @apply rounded-md border border-border-color shadow-sm transition-colors duration-200 ease-in-out focus-within:border-primary focus-within:ring-1 focus-within:ring-primary;
}

.diff-insert {
  background: #dcfce7;
  color: #166534;
  text-decoration: none;
}

.diff-delete {
  background: #fee2e2;
  color: #991b1b;
  text-decoration: line-through;
}

.analysis-progress {
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
}

.analysis-progress__item {
  position: relative;
  display: flex;
  gap: 10px;
  padding-bottom: 12px;
}

.analysis-progress__item:last-child {
  padding-bottom: 0;
}

.analysis-progress__item::after {
  content: '';
  position: absolute;
  left: 9px;
  top: 22px;
  bottom: 0;
  width: 2px;
  background: #d1d5db;
}

.analysis-progress__item:last-child::after {
  display: none;
}

.analysis-progress__marker {
  position: relative;
  z-index: 1;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 999px;
  border: 2px solid #94a3b8;
  background: #fff;
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
}

.analysis-progress__item--running .analysis-progress__marker {
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.analysis-progress__item--pending .analysis-progress__marker {
  border-color: #cbd5e1;
  background: #f1f5f9;
  color: #94a3b8;
}

.analysis-progress__item--pending .analysis-progress__status {
  color: #94a3b8;
}

.analysis-progress__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(37, 99, 235, 0.3);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: analysis-spin 0.8s linear infinite;
}

@keyframes analysis-spin {
  to { transform: rotate(360deg); }
}

.analysis-progress__item--completed .analysis-progress__marker {
  background: #16a34a;
  border-color: #16a34a;
}

.analysis-progress__item--failed .analysis-progress__marker {
  background: #dc2626;
  border-color: #dc2626;
}

.analysis-progress__content {
  min-width: 0;
  flex: 1;
}

.analysis-progress__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

.analysis-progress__status {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.analysis-progress__item--completed .analysis-progress__status {
  color: #16a34a;
}

.analysis-progress__item--failed .analysis-progress__status {
  color: #dc2626;
}

.analysis-progress__message {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}

.linked-analysis-panel {
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  padding: 20px;
  margin-bottom: 32px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.linked-analysis-panel__picker {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}

.linked-analysis-panel__native-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.linked-analysis-panel__file-button {
  flex: 0 0 auto;
  border: 1px solid #2563eb;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.linked-analysis-panel__file-button:hover {
  background: #dbeafe;
  border-color: #1d4ed8;
}

.linked-analysis-panel__count {
  flex: 1;
  min-width: 0;
  color: #64748b;
  font-size: 12px;
}

.linked-analysis-panel__button {
  flex: 0 0 auto;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.linked-analysis-panel__button:hover:not(:disabled) {
  background: #1d4ed8;
}

.linked-analysis-panel__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.linked-analysis-panel__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.linked-analysis-panel__files span {
  border-radius: 8px;
  background: #e0f2fe;
  color: #075985;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
}

.linked-analysis-panel__progress {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}

.linked-analysis-panel__progress-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.linked-analysis-panel__progress-row strong {
  display: block;
  color: #111827;
  font-size: 12px;
}

.linked-analysis-panel__progress-row p {
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.linked-analysis-panel__progress-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  margin-top: 4px;
  border-radius: 999px;
  background: #94a3b8;
}

.linked-analysis-panel__progress-dot--running {
  background: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.linked-analysis-panel__progress-dot--done {
  background: #16a34a;
}

.linked-analysis-panel__progress-dot--failed {
  background: #dc2626;
}

.linked-analysis-result {
  margin-top: 16px;
  border-top: 1px solid #e5e7eb;
  padding-top: 14px;
}

.linked-analysis-result h3,
.linked-analysis-result h4 {
  color: #111827;
  font-weight: 700;
}

.linked-analysis-result h3 {
  font-size: 15px;
}

.linked-analysis-result h4 {
  margin-top: 12px;
  font-size: 13px;
}

.linked-analysis-result__summary {
  margin-top: 8px;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}

.linked-analysis-result__item {
  margin-top: 8px;
  border-left: 3px solid #2563eb;
  background: #fff;
  padding: 10px 12px;
  border-radius: 6px;
}

.linked-analysis-result__item p,
.linked-analysis-result li {
  margin-top: 4px;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
}

.linked-analysis-result ul {
  margin-top: 6px;
  padding-left: 18px;
}

@media (max-width: 640px) {
  .linked-analysis-panel__picker {
    align-items: stretch;
    flex-direction: column;
  }

  .linked-analysis-panel__button {
    width: 100%;
  }
}

/* --- Inline Q&A Chat Widget --- */
.qa-chat-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
}

.reanalysis-progress .analysis-progress {
  max-height: 280px;
  overflow-y: auto;
}

.qa-chat-widget__fab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
  transition: transform 0.2s, box-shadow 0.2s;
  justify-content: center;
}

.qa-chat-widget__fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.45);
}

.qa-chat-widget__fab-badge {
  display: none;
}

.qa-chat-widget__panel {
  width: 400px;
  height: 520px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 120px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.qa-chat-widget__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
  flex-shrink: 0;
}

.qa-chat-widget__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%);
}

.qa-chat-widget__empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
}

.qa-chat-widget__msg {
  display: flex;
  margin-bottom: 10px;
  min-width: 0;
}

.qa-chat-widget__msg--user {
  justify-content: flex-end;
}

.qa-chat-widget__msg--assistant {
  justify-content: flex-start;
}

.qa-chat-widget__bubble {
  max-width: 85%;
  min-width: 0;
  border-radius: 8px;
  padding: 8px 12px;
  background: #fff;
  box-shadow: inset 0 0 0 1px #e5e7eb;
  word-break: break-word;
  overflow-wrap: break-word;
}

.qa-chat-widget__msg--user .qa-chat-widget__bubble {
  background: #2563eb;
  color: #fff;
  box-shadow: none;
}

.qa-chat-widget__role {
  margin: 0 0 3px;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

.qa-chat-widget__content {
  font-size: 13px;
  line-height: 1.55;
}

.qa-chat-widget__content :deep(p) {
  margin: 0 0 4px;
}

.qa-chat-widget__content :deep(p:last-child) {
  margin-bottom: 0;
}

.qa-chat-widget__typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.qa-chat-widget__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  animation: qa-typing-pulse 1s infinite ease-in-out;
}

.qa-chat-widget__typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.qa-chat-widget__typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes qa-typing-pulse {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}

.qa-chat-widget__footer {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  flex-shrink: 0;
}

.qa-chat-widget__footer .el-input {
  flex: 1;
}

.qa-chat-widget__send {
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 0 16px;
  cursor: pointer;
}

.qa-chat-widget__send:disabled {
  background: #a3a3a3;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .qa-chat-widget__panel {
    width: calc(100vw - 32px);
    height: calc(100vh - 100px);
  }
}
</style>

<style scoped>
/* Using Tailwind utility classes, so scoped styles are minimal. */
/* You can add specific component-level styles here if needed. */

:deep(.text-3xl) {
  font-size: 24px !important;
  line-height: 1.2 !important;
}

:deep(.sm\:text-4xl) {
  font-size: 28px !important;
  line-height: 1.18 !important;
}

:deep(.text-lg) {
  font-size: 15px !important;
  line-height: 1.35 !important;
}

:deep(.text-md),
:deep(.text-base) {
  font-size: 13px !important;
  line-height: 1.45 !important;
}

:deep(.text-sm) {
  font-size: 12px !important;
  line-height: 1.45 !important;
}

:deep(.text-xs) {
  font-size: 11px !important;
  line-height: 1.35 !important;
}

:deep(.p-10) {
  padding: 24px !important;
}

:deep(.p-6) {
  padding: 14px !important;
}

:deep(.p-4) {
  padding: 10px !important;
}

:deep(.p-3) {
  padding: 8px !important;
}

:deep(.py-8) {
  padding-top: 18px !important;
  padding-bottom: 18px !important;
}

:deep(.px-4) {
  padding-left: 10px !important;
  padding-right: 10px !important;
}

:deep(.py-2) {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}

:deep(.mt-10) {
  margin-top: 22px !important;
}

:deep(.mt-8) {
  margin-top: 14px !important;
}

:deep(.mt-6) {
  margin-top: 10px !important;
}

:deep(.mt-4) {
  margin-top: 8px !important;
}

:deep(.mt-3),
:deep(.mt-2) {
  margin-top: 6px !important;
}

:deep(.mb-10) {
  margin-bottom: 16px !important;
}

:deep(.mb-6) {
  margin-bottom: 10px !important;
}

:deep(.mb-4) {
  margin-bottom: 8px !important;
}

:deep(.gap-8) {
  gap: 12px !important;
}

:deep(.gap-4),
:deep(.space-x-4 > :not([hidden]) ~ :not([hidden])) {
  gap: 10px !important;
  margin-left: 10px !important;
}

:deep(.gap-3) {
  gap: 8px !important;
}

:deep(.space-y-6 > :not([hidden]) ~ :not([hidden])) {
  margin-top: 12px !important;
}

:deep(.space-y-4 > :not([hidden]) ~ :not([hidden])) {
  margin-top: 8px !important;
}

:deep(.rounded-lg),
:deep(.rounded-md) {
  border-radius: 8px !important;
}

:deep(.shadow-md) {
  box-shadow: inset 0 0 0 1px #e5e5e5, 0 8px 22px rgba(0, 0, 0, 0.04) !important;
}

:deep(.h-\[calc\(100vh-85px\)\]) {
  height: calc(100vh - 72px) !important;
}

:deep(.el-checkbox.is-bordered) {
  padding: 5px 9px !important;
  height: auto !important;
}

:deep(.el-checkbox-group) {
  gap: 6px !important;
}

.review-page {
  height: calc(100vh - 56px);
  overflow: hidden;
  padding: 8px 10px 10px;
  font-size: 13px;
}

.confirm-step {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  padding-left: 8px;
  padding-right: 8px;
  padding-bottom: 28px !important;
}

.review-options-panel {
  overflow: visible;
}

.review-points-group {
  max-height: none;
  overflow: visible;
  align-items: flex-start;
}

.purpose-row {
  min-width: 0;
}

.purpose-row :deep(.el-autocomplete) {
  min-width: 0;
}

.adopted-suggestion-text {
  background: #fef3c7 !important;
  border-color: #f59e0b !important;
  color: #166534 !important;
  box-shadow: inset 0 0 0 1px #facc15;
  cursor: help;
}

.upload-dragger .el-upload-dragger {
  @apply bg-bg-subtle border-2 border-dashed border-border-color rounded-lg transition-colors duration-200 ease-in-out;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 132px;
  width: 100%;
}

.upload-dragger .el-upload-dragger:hover {
  @apply border-primary;
}
</style>

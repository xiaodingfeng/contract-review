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
            <p class="text-xs leading-5 text-gray-500">支持 .docx 格式</p>
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
            <p class="mt-2 text-md text-text-light">AI初步识别该合同为：<span class="font-semibold text-text-dark">{{ preAnalysisData.contract_type }}</span></p>
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
                <!-- Dispute Points -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.dispute_points && reviewData.dispute_points.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.dispute_points" :key="'dp-' + index" class="p-4 bg-bg-subtle rounded-md border border-border-color">
                            <p class="font-semibold text-text-dark">{{ disputeTitle(item, index) }}</p>
                            <p v-if="!showPlainLanguage" class="mt-2 text-sm text-text-main whitespace-pre-line">{{ disputeDescription(item) }}</p>
                            <div v-else class="mt-2 p-3 bg-blue-50 text-blue-800 rounded-md border-l-4 border-blue-400">
                                <p class="text-xs font-bold mb-1">📢 大白话解释：</p>
                                <p class="text-sm">{{ item.plain_language || disputeDescription(item) }}</p>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现风险点</div>
                </div>
                <!-- Breach Cost Analysis -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.breach_cost_analysis && reviewData.breach_cost_analysis.length > 0" class="space-y-4">
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
                                <p class="text-xs text-gray-500 font-medium">预计赔偿/成本：</p>
                                <p class="text-md font-bold text-danger">{{ item.estimated_cost }}</p>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现明确的违约成本条款</div>
                </div>
                <!-- Seal Analysis -->
                <div v-if="activeAiTab === 'summary'">
                    <div v-if="reviewData.seal_analysis && reviewData.seal_analysis.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.seal_analysis" :key="'seal-' + index" class="p-4 bg-gray-50 rounded-md border border-gray-200">
                            <div class="flex justify-between items-center mb-2">
                                <p class="font-bold text-text-dark">{{ item.seal_name }}</p>
                                <el-tag :type="item.risk_level === '低' ? 'success' : item.risk_level === '中' ? 'warning' : 'danger'" size="small">
                                    风险：{{ item.risk_level }}
                                </el-tag>
                            </div>
                            <div class="mt-2 text-sm flex items-center">
                                <span class="text-gray-500 mr-2">状态:</span>
                                <span :class="item.status === '正常' ? 'text-green-600' : 'text-orange-600'" class="font-medium">{{ item.status }}</span>
                            </div>
                            <p class="mt-2 text-xs text-text-main leading-relaxed">
                                <span class="text-gray-500">检测详情:</span><br/>
                                {{ item.details }}
                            </p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现印章信息或正在分析中</div>
                </div>
                <!-- Relevant Laws -->
                <div v-if="activeAiTab === 'knowledge'">
                    <div v-if="reviewData.relevant_laws && reviewData.relevant_laws.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.relevant_laws" :key="'law-' + index" class="p-4 bg-blue-50 rounded-md border border-blue-100">
                            <div class="flex justify-between gap-3">
                                <p class="font-bold text-blue-900">【{{ item.law }}】第 {{ item.clause }} 条</p>
                                <el-tag :type="item.hasUpdate ? 'warning' : 'success'" size="small">
                                    {{ item.hasUpdate ? '需关注更新' : '当前可参考' }}
                                </el-tag>
                            </div>
                            <p class="mt-2 text-sm text-blue-900 leading-6">{{ item.content }}</p>
                            <p v-if="item.hasUpdate" class="mt-2 text-xs text-orange-700">{{ item.updateNotice }}</p>
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
                        <button @click="applySelectedSuggestions" :disabled="batchApplying || selectedSuggestionIndexes.length === 0" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark disabled:opacity-50">
                            {{ batchApplying ? '批量采纳中...' : '一键采纳所选' }}
                        </button>
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
                            </div>
                            
                            <div class="mt-4 pt-3 border-t border-gray-100 flex justify-end">
                                <button @click="previewSuggestion(item)" class="mr-2 px-3 py-1.5 text-xs font-medium text-primary bg-white border border-primary rounded hover:bg-primary-light transition-colors">
                                    查看变更
                                </button>
                                <button @click="adoptSuggestion(item)" class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark transition-colors flex items-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                    {{ item.adopted ? '已采纳' : '一键采纳建议' }}
                                </button>
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
                    <div v-for="(item, index) in reviewData.company_review" :key="'company-' + index" class="p-4 bg-white rounded-md border border-border-color">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="font-semibold text-text-dark">{{ item.company_name || item.title || '主体审查' }}</p>
                                <p class="mt-1 text-sm text-text-main">{{ item.status || item.evidence_summary }}</p>
                            </div>
                            <el-tag size="small" :type="String(item.authenticity || '').includes('未') ? 'warning' : 'success'">外部检索</el-tag>
                        </div>
                        <p v-if="item.evidence_summary" class="mt-2 text-sm text-text-main whitespace-pre-line">{{ item.evidence_summary }}</p>
                        <p v-if="item.authenticity" class="mt-2 text-xs text-text-light">{{ item.authenticity }}</p>
                        <div v-if="item.sources && item.sources.length" class="mt-2 flex flex-col gap-1">
                            <a v-for="source in item.sources" :key="source" :href="source" target="_blank" rel="noreferrer" class="text-xs text-primary hover:underline truncate">{{ source }}</a>
                        </div>
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
                   </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Loading Overlay - Moved inside the single root element -->
    <div v-if="loading && activeStep < 2" class="fixed inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-50">
        <div class="flex flex-col items-center max-w-md bg-white border border-border-color rounded-md p-4 shadow-sm">
            <p class="text-lg font-semibold text-text-dark">{{ loadingMessage }}</p>
            <div v-if="analysisProgress.length" class="analysis-progress mt-4 w-full">
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
  </div>
</template>

<script>
import { ref, reactive, watch, toRaw, onMounted, nextTick, onUnmounted, computed } from 'vue';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete, ElSwitch, ElTooltip } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';
import { DocumentEditor } from "@onlyoffice/document-editor-vue";
import { io } from "socket.io-client";

export default {
  name: 'ReviewView',
  components: {
    DocumentEditor,
    ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete, ElSwitch, ElTooltip
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const activeStep = ref(0);
    let isResetting = false; // The flag to prevent watchers from firing during reset
    const cameFromHistory = ref(false);
    const loading = ref(false);
    const loadingMessage = ref('');
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
    const progressStepLabels = {
      pre_analysis: '合同预分析',
      extract_text: '提取合同正文',
      knowledge_search: '检索法条与案例',
      company_search: '核验合同主体',
      llm_review: '生成审查结论',
      finalize: '保存审查结果',
      failed: '分析失败',
    };
    const progressStatusLabels = {
      running: '进行中',
      completed: '已完成',
      failed: '失败',
      reviewed: '已审查',
      pre_analyzed: '已预分析',
      processing: '处理中',
    };
    const progressStepLabel = (step) => progressStepLabels[step] || step || '处理中';
    const progressStatusLabel = (status) => progressStatusLabels[status] || status || '处理中';
    const progressStatusClass = (status) => {
      if (status === 'completed' || status === 'reviewed' || status === 'pre_analyzed') return 'completed';
      if (status === 'failed') return 'failed';
      return 'running';
    };
    const focusedReviewText = ref('');
    const focusedReviewQuestion = ref('');
    const focusedReviewResult = ref(null);
    const focusedReviewLoading = ref(false);
    const reviewTemplates = ref([]);
    const selectedTemplateId = ref('general');

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
            ElMessage.success({
                message: `协同审查结果已更新（立场：${data.perspective || '未指定'}）。`,
                duration: 5000
            });
            Object.assign(reviewData, data.results || data);
            if (data.perspective) perspective.value = data.perspective;
        });

        socket.value.on('analysis-progress', (data) => {
            analysisProgress.value.push(data);
            if (data.partialResult) {
                Object.assign(reviewData, data.partialResult);
            }
            loadingMessage.value = data.message || loadingMessage.value;
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
    });

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
        reviewTemplates.value = response.data || [];
        if (!selectedTemplateId.value && reviewTemplates.value.length) {
          selectedTemplateId.value = reviewTemplates.value[0].id;
        }
      } catch (error) {
        console.error('Failed to load review templates:', error);
      }
    };

    const handleBeforeUpload = (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const isValid = ['docx', 'pdf'].includes(ext);
        if (!isValid) {
            ElMessage.error('只能上传 DOCX 或 PDF 格式的文件！');
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
            selectedTemplateId.value = preAnalysisData.template_id || selectedTemplateId.value || 'general';
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

    const startAnalysis = async () => {
        if (!perspective.value) {
            ElMessage.warning('请输入您的审查立场。');
            return;
        }
        loading.value = true;
        loadingMessage.value = 'AI正在深度审查合同，这可能需要1-2分钟...';
        try {
            // This is the new, more complete payload
            const analysisPayload = {
                contractId: contract.id,
                userPerspective: perspective.value,
                preAnalysisData: {
                    contract_type: preAnalysisData.contract_type,
                    potential_parties: allPotentialParties.value,
                    suggested_review_points: allSuggestedReviewPoints.value,
                    suggested_core_purposes: allSuggestedCorePurposes.value,
                    // Pass the *selected* points and purposes for the AI to focus on
                    reviewPoints: selectedReviewPoints.value,
                    core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                    template_id: selectedTemplateId.value,
                },
            };
            const res = await api.analyzeContract(analysisPayload);
            Object.assign(reviewData, res.data);
            activeStep.value = 2;
        } catch(err) {
            // More specific error handling
            const errorMessage = err.response?.data?.error || '分析失败，请稍后重试';
            ElMessage.error(errorMessage);
        } finally {
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
      try {
        // Use the same, new payload structure for re-analysis
        const analysisPayload = {
          contractId: contract.id,
          userPerspective: perspective.value,
          preAnalysisData: {
                contract_type: preAnalysisData.contract_type,
                potential_parties: allPotentialParties.value,
                suggested_review_points: allSuggestedReviewPoints.value,
                suggested_core_purposes: allSuggestedCorePurposes.value,
                // Pass the *selected* points and purposes for the AI to focus on
                reviewPoints: selectedReviewPoints.value,
                core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                template_id: selectedTemplateId.value,
            },
        };
        const res = await api.analyzeContract(analysisPayload);
        Object.assign(reviewData, res.data);
        ElMessage.success('重审完成！');
        activeAiTab.value = 'suggestions'; // Switch to the first tab to show results
      } catch(err) {
        const errorMessage = err.response?.data?.error || '重审失败，请稍后重试';
        ElMessage.error(errorMessage);
      } finally {
        reAnalyzing.value = false;
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
            selectedTemplateId.value = preAnalysisData.template_id || 'general';
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

    const loadState = async () => {
        const savedStateJSON = localStorage.getItem('review_session');
        if (savedStateJSON) {
            try {
                const savedState = JSON.parse(savedStateJSON);
                if (savedState.contract && savedState.contract.id) {
                    loading.value = true;
                    loadingMessage.value = '正在恢复您的会话...';

                    try {
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
                        selectedTemplateId.value = savedState.selectedTemplateId || preAnalysisData.template_id || 'general';
                        Object.assign(reviewData, savedState.reviewData || {});

                        // Restore lists from savedState
                        selectedReviewPoints.value = savedState.selectedReviewPoints || [];
                        customPurposes.value = savedState.customPurposes || [{ value: '' }];
                        allSuggestedReviewPoints.value = savedState.allSuggestedReviewPoints || [];
                        allPotentialParties.value = savedState.allPotentialParties || [];
                        allSuggestedCorePurposes.value = savedState.allSuggestedCorePurposes || [];

                    } catch (error) {
                         console.error(`Failed to refresh session for contract ${savedState.contract.id}:`, error);
                         ElMessage.error('刷新会话失败，将重置状态。');
                         resetState(); // Clear the invalid session
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
      });
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

    onUnmounted(() => {
        stopAutoForceSave();
        forceSaveCurrentDocument(true);
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
            });
            focusedReviewResult.value = response.data;
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '专项审查失败，请稍后重试。');
        } finally {
            focusedReviewLoading.value = false;
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
      docEditorComponent,
      isEditorReady,
      preAnalysisData,
      selectedReviewPoints,
      customPurposes,
      addPurpose,
      removePurpose,
      reAnalyzing,
      startReAnalysis,
      uploadAndGo,
      cameFromHistory,
      goBackSmart,
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
      disputeTitle,
      disputeDescription,
      missingClauseTitle,
      partyReviewTitle,
      partyReviewDescription,
      suggestionTitle,
      suggestionOriginal,
      suggestionText,
      suggestionReason,
      previewSuggestion,
      prepareFocusedReviewFromSelection,
      submitFocusedReview,
      applyFocusedSuggestion,
      locateText,
      addDocComment,
      adoptSuggestion,
      analysisProgress,
      visibleAnalysisProgress,
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

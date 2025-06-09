<template>
  <div class="w-full h-full flex flex-col">
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
    <div v-if="activeStep === 0" class="flex-grow flex flex-col items-center justify-center py-8 px-4 text-center">
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
    </div>

    <!-- Step 1: Pre-analysis & Settings -->
    <div v-if="activeStep === 1" class="w-full max-w-5xl mx-auto py-8">
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
                    <el-select v-model="perspective" placeholder="请选择您的立场" class="w-full">
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
        <div class="bg-white rounded-lg shadow-md p-6 mt-8">
            <h3 class="text-lg font-semibold text-text-dark mb-4">审查点及核心目的</h3>
            <div class="mb-6">
                <h4 class="text-md font-medium text-text-dark mb-2">审查点选择 (可多选)</h4>
                <el-checkbox-group v-model="selectedReviewPoints" class="flex flex-wrap gap-3">
                    <el-checkbox 
                    v-for="point in allSuggestedReviewPoints" 
                    :key="point" 
                    :label="point"
                    border
                    ></el-checkbox>
                </el-checkbox-group>
            </div>
            <div>
                 <h4 class="text-md font-medium text-text-dark mb-2">审查核心目的 (可自定义)</h4>
                 <div v-for="(purpose, index) in customPurposes" :key="index" class="flex items-center mb-2">
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
    <div v-if="activeStep === 2" class="flex-grow flex space-x-4">
        <!-- Left Side: OnlyOffice Editor -->
        <div class="w-2/3 bg-white rounded-lg shadow-md overflow-hidden">
            <DocumentEditor
                v-if="contract.editorConfig"
                id="docEditor"
                ref="docEditorComponent"
                :documentServerUrl="onlyOfficeUrl"
                :config="contract.editorConfig"
                class="h-full"
            />
        </div>
        
        <!-- Right Side: AI Review Panel -->
        <div class="w-1/3 bg-white rounded-lg shadow-md flex flex-col">
            <!-- Panel Header -->
            <div class="p-4 border-b border-border-color flex justify-between items-center flex-shrink-0">
                <h3 class="text-lg font-semibold text-text-dark">AI 审查报告</h3>
                <div>
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
                <nav class="-mb-px flex space-x-6">
                    <button @click="activeAiTab = 'disputes'" :class="[activeAiTab === 'disputes' ? 'border-primary text-primary' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm">争议焦点</button>
                    <button @click="activeAiTab = 'missing'" :class="[activeAiTab === 'missing' ? 'border-primary text-primary' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm">缺失条款</button>
                    <button @click="activeAiTab = 'parties'" :class="[activeAiTab === 'parties' ? 'border-primary text-primary' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm">主体审查</button>
                    <button @click="activeAiTab = 're-review'" :class="[activeAiTab === 're-review' ? 'border-primary text-primary' : 'border-transparent text-text-light hover:text-text-main hover:border-gray-300']" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm">重审</button>
                </nav>
            </div>

            <!-- Tab Content -->
            <div class="p-6 overflow-y-auto flex-grow">
                <!-- Dispute Points -->
                <div v-if="activeAiTab === 'disputes'">
                    <div v-if="reviewData.dispute_points && reviewData.dispute_points.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.dispute_points" :key="'dp-' + index" class="p-4 bg-bg-subtle rounded-md">
                            <p class="font-semibold text-text-dark">{{ item.title }}</p>
                            <p class="mt-1 text-sm text-text-main">{{ item.description }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现争议焦点</div>
                </div>
                <!-- Missing Clauses -->
                <div v-if="activeAiTab === 'missing'">
                    <div v-if="reviewData.missing_clauses && reviewData.missing_clauses.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.missing_clauses" :key="'mc-' + index" class="p-4 bg-bg-subtle rounded-md">
                            <p class="font-semibold text-text-dark">{{ item.title }}</p>
                            <p class="mt-1 text-sm text-text-main">{{ item.description }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">未发现缺失条款</div>
                </div>
                <!-- Party Review -->
                <div v-if="activeAiTab === 'parties'">
                     <div v-if="reviewData.party_review && reviewData.party_review.length > 0" class="space-y-4">
                        <div v-for="(item, index) in reviewData.party_review" :key="'pr-' + index" class="p-4 bg-bg-subtle rounded-md">
                            <p class="font-semibold text-text-dark">{{ item.title }}</p>
                            <p class="mt-1 text-sm text-text-main">{{ item.description }}</p>
                        </div>
                    </div>
                    <div v-else class="text-center text-text-light py-8">主体信息无风险</div>
                </div>
                <!-- Re-review Form -->
                <div v-if="activeAiTab === 're-review'">
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
                                    <el-checkbox v-for="point in allSuggestedReviewPoints" :key="point" :label="point" border></el-checkbox>
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
    <div v-if="loading && activeStep < 2" class="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-50">
        <div class="flex flex-col items-center">
            <p class="text-lg font-semibold text-text-dark">{{ loadingMessage }}</p>
        </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, toRaw, onMounted, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';
import { DocumentEditor } from "@onlyoffice/document-editor-vue";

export default {
  name: 'ReviewView',
  components: {
    DocumentEditor,
    ElUpload, ElSelect, ElOption, ElCheckboxGroup, ElCheckbox, ElInput, ElAutocomplete
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
    const activeAiTab = ref('disputes');
    const docEditorComponent = ref(null);
    const isEditorReady = ref(false);
    const reAnalyzing = ref(false);

    const allSuggestedReviewPoints = ref([]);
    const allPotentialParties = ref([]);
    const allSuggestedCorePurposes = ref([]);

    const initialContractState = {
      id: null,
      original_filename: '',
      editorConfig: null,
    };
    const contract = reactive({ ...initialContractState });

    const preAnalysisData = reactive({
      contract_type: '',
      potential_parties: [],
      suggested_review_points: [],
      suggested_core_purposes: [],
    });
    const selectedReviewPoints = ref([]);
    const customPurposes = ref([{ value: '' }]);

    const reviewData = reactive({
      dispute_points: [],
      missing_clauses: [],
      party_review: [],
    });

    const onlyOfficeUrl = process.env.VUE_APP_ONLYOFFICE_URL;

    const handleBeforeUpload = (file) => {
        const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (!isDocx) {
            ElMessage.error('只能上传 DOCX 格式的文件！');
        }
        loading.value = true;
        loadingMessage.value = '正在上传并为您准备编辑器...';
        return isDocx;
    };

    const handleUploadSuccess = async (res) => {
        contract.id = res.contractId;
        contract.editorConfig = res.editorConfig;
        contract.original_filename = res.editorConfig.document.title;
        
        // Start pre-analysis immediately after upload
        loading.value = true;
        loadingMessage.value = 'AI正在进行初步分析，请稍候...';
        try {
            const preAnalysisRes = await api.preAnalyzeContract({ contractId: contract.id });
            Object.assign(preAnalysisData, preAnalysisRes.data);
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

    // Watch for the editor instance to become available
    watch(() => docEditorComponent.value?.editor, (newEditor) => {
        if (newEditor) {
            console.log("[INFO] Editor instance via watcher is now available.");
            isEditorReady.value = true;
            // ElMessage.success('编辑器已准备就绪，可以开始操作了。');
        }
    });

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
            },
        };
        const res = await api.analyzeContract(analysisPayload);
        Object.assign(reviewData, res.data);
        ElMessage.success('重审完成！');
        activeAiTab.value = 'disputes'; // Switch to the first tab to show results
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
            perspective.value = contractData.perspective;
            Object.assign(preAnalysisData, contractData.preAnalysisData || {});
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
    watch([activeStep, perspective, activeAiTab], saveState);
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
                        activeAiTab.value = savedState.activeAiTab || 'disputes';
                        
                        // Restore data objects from savedState
                        Object.assign(contract, savedState.contract);
                        // CRITICAL: Overwrite with the fresh editor config from the server.
                        contract.editorConfig = serverEditorConfig;
                        
                        perspective.value = savedState.perspective;
                        Object.assign(preAnalysisData, savedState.preAnalysisData || {});
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
      Object.assign(reviewData, { dispute_points: [], missing_clauses: [], party_review: [] });
      isEditorReady.value = false;
      // Reset new states
      Object.assign(preAnalysisData, { contract_type: '', potential_parties: [], suggested_review_points: [], suggested_core_purposes: [] });
      selectedReviewPoints.value = [];
      customPurposes.value = [{ value: '' }];
      allSuggestedReviewPoints.value = [];
      allPotentialParties.value = [];
      allSuggestedCorePurposes.value = [];
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
            router.push('/history');
        } else {
            goBackToConfirm(); // Keep the original behavior for normal flow
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
      querySearchCorePurposes,
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
</style>

<style scoped>
/* Using Tailwind utility classes, so scoped styles are minimal. */
/* You can add specific component-level styles here if needed. */

.upload-dragger .el-upload-dragger {
  @apply bg-bg-subtle border-2 border-dashed border-border-color rounded-lg transition-colors duration-200 ease-in-out;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 180px; /* Or any other fixed height */
  width: 100%;
}

.upload-dragger .el-upload-dragger:hover {
  @apply border-primary;
}
</style> 
<template>
  <div class="review-container">
    <el-steps :active="activeStep" finish-status="success" simple class="compact-steps">
      <el-step title="1. 上传合同" :icon="Upload"></el-step>
      <el-step title="2. 确认信息并分析" :icon="Select"></el-step>
      <el-step title="3. 查看并编辑结果" :icon="Document"></el-step>
    </el-steps>

    <!-- Step 1: Upload -->
    <div v-if="activeStep === 0" class="step-content">
       <el-upload
        class="upload-dragger"
        drag
        action="#"
        :show-file-list="false"
        :before-upload="handleBeforeUpload"
        :http-request="({ file }) => uploadAndGo(file)"
        v-loading.fullscreen.lock="loading"
        :element-loading-text="loadingMessage"
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <div class="el-upload__tip">只能上传.docx文件</div>
      </el-upload>
    </div>

    <!-- Step 2: Confirm & Analyze -->
    <div 
      v-if="activeStep === 1" 
      class="step-content"
      v-loading.fullscreen.lock="loading"
      :element-loading-text="loadingMessage"
    >
      <div v-if="preAnalysisData.contract_type">
        <div class="info-text">
            文件 <span style="color: #409EFF;">{{ contract.original_filename }}</span> 已上传成功。
            <br>
            AI初步分析该合同为：<strong>{{ preAnalysisData.contract_type }}</strong>
        </div>
        <el-form label-width="120px" class="review-setup-form">
          <el-form-item label="您的审查立场">
            <el-select v-model="perspective" placeholder="请选择您的立场">
              <el-option
                v-for="party in preAnalysisData.potential_parties"
                :key="party"
                :label="party"
                :value="party">
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="审查点选择">
            <el-checkbox-group v-model="selectedReviewPoints">
              <el-checkbox 
                v-for="point in preAnalysisData.suggested_review_points" 
                :key="point" 
                :label="point"
                border
                class="review-point-checkbox"
              ></el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="审查核心目的">
             <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-item">
                <el-input v-model="purpose.value" placeholder="例如：确保权利义务对等"></el-input>
                <el-button @click="removePurpose(index)" :icon="Remove" circle plain class="purpose-action-btn"></el-button>
             </div>
             <el-button @click="addPurpose" :icon="Plus" type="primary" plain style="width: 100%; margin-top: 10px;">添加审查核心目的</el-button>
          </el-form-item>
        </el-form>
        <div class="action-buttons">
          <el-button @click="goBackToUpload">重新上传</el-button>
          <el-button type="primary" @click="startAnalysis" :disabled="!perspective || selectedReviewPoints.length === 0">开始分析</el-button>
        </div>
      </div>
    </div>
    
    <!-- Step 3: Review & Edit -->
    <div v-if="activeStep === 2" class="step-content full-height-step">
        <el-row :gutter="20" class="full-height-row">
            <!-- Left Side: OnlyOffice Editor -->
            <el-col :span="14" class="full-height-col">
                 <div id="onlyoffice-editor-container" class="editor-container">
                    <DocumentEditor
                        v-if="contract.editorConfig"
                        id="docEditor"
                        ref="docEditorComponent"
                        documentServerUrl="http://192.168.1.5:8081/"
                        :config="contract.editorConfig"
                    />
                </div>
            </el-col>

            <!-- Right Side: AI Suggestions -->
            <el-col :span="10" class="full-height-col">
                 <el-card class="box-card ai-panel">
                    <template #header>
                        <div class="ai-panel-header">
                            <span>AI 审查报告</span>
                            <div>
                                <template v-if="cameFromHistory">
                                    <el-button @click="goBackToUpload" type="primary" link>重新上传</el-button>
                                    <el-button @click="goBackSmart" type="primary" link style="margin-left: 10px;">返回历史列表</el-button>
                                </template>
                                <template v-else>
                                    <el-button @click="goBackSmart" type="primary" link>返回上一步</el-button>
                                </template>
                            </div>
                        </div>
                    </template>
                    <el-tabs v-model="activeAiTab" type="border-card" class="ai-tabs">
                        <el-tab-pane label="争议焦点" name="disputes">
                            <div class="suggestion-list">
                                <div v-for="(item, index) in reviewData.dispute_points" :key="'dp-' + index" class="suggestion-item">
                                    <p><strong>{{ item.title }}</strong></p>
                                    <p>{{ item.description }}</p>
                                </div>
                                <el-empty v-if="!reviewData.dispute_points || reviewData.dispute_points.length === 0" description="未发现争议焦点"></el-empty>
                            </div>
                        </el-tab-pane>
                        <el-tab-pane label="缺失条款" name="missing">
                             <div class="suggestion-list">
                                <div v-for="(item, index) in reviewData.missing_clauses" :key="'mc-' + index" class="suggestion-item">
                                    <p><strong>{{ item.title }}</strong></p>
                                    <p>{{ item.description }}</p>
                                </div>
                                <el-empty v-if="!reviewData.missing_clauses || reviewData.missing_clauses.length === 0" description="未发现缺失条款"></el-empty>
                             </div>
                        </el-tab-pane>
                        <el-tab-pane label="主体审查" name="parties">
                             <div class="suggestion-list">
                                <div v-for="(item, index) in reviewData.party_review" :key="'pr-' + index" class="suggestion-item">
                                    <p><strong>{{ item.title }}</strong></p>
                                    <p>{{ item.description }}</p>
                                </div>
                                <el-empty v-if="!reviewData.party_review || reviewData.party_review.length === 0" description="主体信息无风险"></el-empty>
                             </div>
                        </el-tab-pane>
                         <el-tab-pane label="重审" name="re-review">
                            <div class="re-review-panel">
                              <el-form label-position="top" class="re-review-form">
                                <el-form-item>
                                  <template #label>
                                    <span class="form-label">合同类型</span>
                                  </template>
                                  <el-input v-model="preAnalysisData.contract_type"></el-input>
                                </el-form-item>
                                <el-form-item>
                                   <template #label>
                                    <span class="form-label">审查立场</span>
                                  </template>
                                  <el-select v-model="perspective" placeholder="请选择您的立场" style="width: 100%;">
                                    <el-option
                                      v-for="party in preAnalysisData.potential_parties"
                                      :key="party"
                                      :label="party"
                                      :value="party">
                                    </el-option>
                                  </el-select>
                                </el-form-item>
                                <el-form-item>
                                  <template #label>
                                    <span class="form-label">审查点选择</span>
                                  </template>
                                  <div class="checkbox-group-wrapper">
                                    <el-checkbox-group v-model="selectedReviewPoints">
                                      <el-checkbox 
                                        v-for="point in preAnalysisData.suggested_review_points" 
                                        :key="point" 
                                        :label="point"
                                        border
                                        class="review-point-checkbox"
                                      ></el-checkbox>
                                    </el-checkbox-group>
                                  </div>
                                </el-form-item>
                                <el-form-item>
                                  <template #label>
                                    <span class="form-label">审查核心目的</span>
                                  </template>
                                   <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-item">
                                      <el-input v-model="purpose.value" placeholder="例如：确保权利义务对等"></el-input>
                                      <el-button @click="removePurpose(index)" :icon="Remove" circle plain class="purpose-action-btn"></el-button>
                                   </div>
                                   <el-button @click="addPurpose" :icon="Plus" type="primary" plain style="width: 100%; margin-top: 10px;">添加审查核心目的</el-button>
                                </el-form-item>
                                <el-form-item>
                                  <el-button 
                                      type="primary" 
                                      @click="startReAnalysis" 
                                      :disabled="!perspective || selectedReviewPoints.length === 0"
                                      style="width: 100%;"
                                      :loading="reAnalyzing"
                                  >
                                      确认重审
                                  </el-button>
                                </el-form-item>
                              </el-form>
                            </div>
                        </el-tab-pane>
                    </el-tabs>
                 </el-card>
            </el-col>
        </el-row>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, toRaw, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import { UploadFilled, Document, Select, Upload, Plus, Remove } from '@element-plus/icons-vue';
import api from '../api';
import { getUserId } from '../user';
import { DocumentEditor } from "@onlyoffice/document-editor-vue";

export default {
  name: 'ReviewView',
  components: {
    DocumentEditor,
    UploadFilled
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
            const analysisPayload = {
                contractId: contract.id,
                contractType: preAnalysisData.contract_type,
                userPerspective: perspective.value,
                reviewPoints: selectedReviewPoints.value,
                corePurposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
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
        const analysisPayload = {
          contractId: contract.id,
          contractType: preAnalysisData.contract_type,
          userPerspective: perspective.value,
          reviewPoints: selectedReviewPoints.value,
          corePurposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
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
            Object.assign(preAnalysisData, contractData.preAnalysisData);
            selectedReviewPoints.value = contractData.selectedReviewPoints || [];
            customPurposes.value = contractData.customPurposes || [{ value: '' }];
            Object.assign(reviewData, contractData.reviewData);
            
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
        };
        // Only save if a contract has been uploaded to avoid storing empty sessions
        if (stateToSave.contract && stateToSave.contract.id) {
            localStorage.setItem('review_session', JSON.stringify(stateToSave));
        }
    };

    // Watch for any state changes and save them
    watch([activeStep, perspective, activeAiTab], saveState);
    watch([contract, preAnalysisData, reviewData, selectedReviewPoints, customPurposes], saveState, { deep: true });

    const loadState = () => {
        const savedStateJSON = localStorage.getItem('review_session');
        if (savedStateJSON) {
            try {
                const savedState = JSON.parse(savedStateJSON);
                // A simple check to ensure the session data is valid before loading
                if (savedState.contract && savedState.contract.id) {
                    activeStep.value = savedState.activeStep;
                    Object.assign(contract, savedState.contract);
                    perspective.value = savedState.perspective;
                    Object.assign(preAnalysisData, savedState.preAnalysisData);
                    selectedReviewPoints.value = savedState.selectedReviewPoints || [];
                    customPurposes.value = savedState.customPurposes || [{ value: '' }];
                    Object.assign(reviewData, savedState.reviewData);
                    activeAiTab.value = savedState.activeAiTab || 'disputes';
                    cameFromHistory.value = savedState.cameFromHistory || false;
                }
            } catch (e) {
                console.error("Failed to parse saved state, clearing invalid session.", e);
                localStorage.removeItem('review_session');
            }
        }
    };

    const resetState = () => {
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
      // Clear the session from localStorage
      localStorage.removeItem('review_session');

      // Use nextTick to ensure the DOM has updated and state changes have propagated
      // before we unlock the saving mechanism.
      nextTick(() => {
        isResetting = false;
      });
    };

    // This is the correct guard for handling navigation that reuses the same component instance.
    onBeforeRouteUpdate((to, from) => {
      // When navigating from a history-loaded review page (which has a contract_id) 
      // back to the main 'start' page (which does not), we must reset the entire state
      // to ensure a completely fresh start.
      if (from.query.contract_id && !to.query.contract_id) {
          console.log('[INFO] Navigating from a history item to main page. Resetting component state.');
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
      Document,
      Select,
      Upload,
      UploadFilled,
      Plus,
      Remove,
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
    };
  }
};
</script>

<style scoped>
.review-container {
  padding: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.compact-steps {
    padding: 8px 0;
    margin: 0;
    flex-shrink: 0;
    border-bottom: 1px solid #e4e7ed;
    background-color: #fafafa;
}

.compact-steps .el-step__title {
    font-size: 13px !important;
}

.step-content {
  margin-top: 15px;
  padding: 0 15px 15px 15px;
  flex-grow: 1;
  min-height: 0;
  box-sizing: border-box;
}
.full-height-step {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.full-height-container {
    height: calc(100vh - 120px); /* Adjust based on header/footer height */
}
.full-height-row {
  flex-grow: 1; /* Allow the row to take up available vertical space */
  min-height: 0; /* Prevent flexbox overflow issues */
  display: flex;
}
.full-height-col {
  display: flex;
  flex-direction: column;
}
.upload-dragger {
  width: 100%;
  border: 1px solid #dcdfe6;
}
.editor-container {
  width: 100%;
  height: 100%;
  border: 1px solid #dcdfe6;
}
.ai-panel {
  flex-grow: 1; /* Allow the panel to take up available vertical space */
  min-height: 0; /* Prevent flexbox overflow issues */
  display: flex;
  flex-direction: column;
}
.ai-panel ::v-deep(.el-card__header) {
  padding: 12px 20px;
  flex-shrink: 0;
}
.ai-panel ::v-deep(.el-card__body) {
  padding: 0;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ai-panel-header {
  font-size: 16px;
  font-weight: bold;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ai-tabs {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  border: none;
}
.ai-tabs ::v-deep(.el-tabs__header) {
    flex-shrink: 0;
    order: 1;
}
.ai-tabs ::v-deep(.el-tabs__content) {
    flex-grow: 1;
    overflow-y: auto;
    padding: 15px;
    order: 2;
}
.review-report h3 {
    margin-bottom: 15px;
    font-size: 18px;
    color: #303133;
    text-align: center;
}

.suggestion-list {
    padding-right: 10px; /* Space for scrollbar */
    border: 1px solid #EBEEF5;
    border-radius: 4px;
}

.suggestion-item {
    padding: 10px 15px;
    border-bottom: 1px solid #EBEEF5;
}
.suggestion-item:last-child {
    border-bottom: none;
}
.suggestion-item p {
    margin: 5px 0;
    font-size: 14px;
}
.info-text {
    color: #606266;
    font-size: 16px;
    margin-bottom: 20px;
    text-align: center;
    line-height: 1.5;
}
.el-icon--upload {
    font-size: 67px;
    color: #c0c4cc;
    margin: 40px 0 16px;
    line-height: 50px;
}

.review-setup-form {
  max-width: 800px;
  margin: 0 auto;
}

.action-buttons {
  max-width: 800px;
  margin: 20px auto 0;
  text-align: right;
}

.review-point-checkbox {
  margin: 5px;
  width: auto;
  min-width: 200px;
  height: auto;
  min-height: 32px;
  white-space: normal;
  display: inline-flex;
  align-items: center;
  padding: 5px 15px;
}

.review-point-checkbox .el-checkbox__label {
  white-space: normal !important;
  word-break: break-all;
  line-height: 1.4;
  text-align: left;
}

.purpose-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.purpose-action-btn {
  margin-left: 10px;
}

.re-review-panel {
  padding: 5px 15px 5px 5px;
}
.re-review-form .el-form-item {
  margin-bottom: 18px;
}
.re-review-form .form-label {
  font-weight: 600;
  color: #606266;
  font-size: 14px;
}
.re-review-form .checkbox-group-wrapper {
  background-color: #fafcff;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eaf2ff;
}
</style> 
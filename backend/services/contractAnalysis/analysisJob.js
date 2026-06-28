/**
 * @file services/contractAnalysis/analysisJob.js
 * @brief 管理合同异步分析任务的生命周期与进度推送
 *
 * 核心职责：
 * - 维护内存级任务存储（Map），跟踪分析状态支持断线恢复
 * - 定义分析步骤及其权重，计算整体进度百分比与 ETA
 * - 通过 Socket.IO 向客户端实时推送分析进度事件
 * - 同步任务状态到数据库 contracts 表
 *
 * 关键实现：
 * - ANALYSIS_STEPS 定义七步流程及各自权重与预估耗时
 * - getStepProgress 按累计权重计算百分比
 * - emitAnalysisProgress 同时更新内存任务、推送事件、写库
 * - 长合同可通过 totalEstSeconds 动态覆盖 ETA
 *
 * 依赖关系：
 * - 上游：../../database、uuid、Socket.IO 实例
 * - 下游：被 backgroundAnalysis、analysisCore 等分析流程调用
 */
const db = require('../../database');
const { v4: uuidv4 } = require('uuid');

// ===== 异步分析任务管理 =====
// 内存级任务存储，用于追踪分析进度并支持断线恢复
const analysisJobs = new Map();
let ioInstance = null;
const setIoInstance = (io) => { ioInstance = io; };
const getIoInstance = () => ioInstance;

// 分析步骤定义：每步的权重（百分比）和预估耗时（秒）
const ANALYSIS_STEPS = [
    { key: 'extract_text', label: '提取合同正文', weight: 5, estSeconds: 3 },
    { key: 'knowledge_search', label: '检索法条与案例依据', weight: 18, estSeconds: 15 },
    { key: 'company_search', label: '核验合同主体信息', weight: 12, estSeconds: 12 },
    { key: 'rule_check', label: '硬性合规检查', weight: 5, estSeconds: 3 },
    { key: 'llm_review', label: 'AI 生成审查结论', weight: 50, estSeconds: 60 },
    { key: 'seal_analysis', label: '印章与签章核验', weight: 7, estSeconds: 8 },
    { key: 'finalize', label: '保存审查结果', weight: 3, estSeconds: 2 },
];
const TOTAL_EST_SECONDS = ANALYSIS_STEPS.reduce((sum, s) => sum + s.estSeconds, 0);

const getStepProgress = (stepKey, status) => {
    const idx = ANALYSIS_STEPS.findIndex((s) => s.key === stepKey);
    if (idx < 0) return { percent: 0, stepIndex: 0, totalSteps: ANALYSIS_STEPS.length };
    let cumulative = 0;
    for (let i = 0; i < idx; i += 1) cumulative += ANALYSIS_STEPS[i].weight;
    const step = ANALYSIS_STEPS[idx];
    const percent = status === 'completed' ? cumulative + step.weight : cumulative + Math.round(step.weight * 0.5);
    return { percent: Math.min(percent, 100), stepIndex: idx, totalSteps: ANALYSIS_STEPS.length };
};

const createAnalysisJob = (contractId, userId) => {
    const job = {
        jobId: uuidv4(),
        contractId: Number(contractId),
        userId,
        status: 'queued',
        currentStep: null,
        percent: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        steps: ANALYSIS_STEPS.map((s) => ({ ...s, status: 'pending', message: '' })),
        error: null,
        result: null,
    };
    analysisJobs.set(Number(contractId), job);
    return job;
};

const updateAnalysisJob = (contractId, updates) => {
    const job = analysisJobs.get(Number(contractId));
    if (!job) return null;
    Object.assign(job, updates, { updatedAt: Date.now() });
    return job;
};

const emitAnalysisProgress = async (reqOrIo, contractId, payload) => {
    const stepKey = payload.step;
    const status = payload.status;
    const { percent, stepIndex, totalSteps } = getStepProgress(stepKey, status);
    const job = analysisJobs.get(Number(contractId));
    // 长合同分层审查时，job 上会设置 totalEstSeconds（基础 60 + 条款数 × 10），用于动态 ETA
    const totalEstSeconds = job?.totalEstSeconds || TOTAL_EST_SECONDS;

    const event = {
        contractId: Number(contractId),
        timestamp: new Date().toISOString(),
        percent,
        stepIndex,
        totalSteps,
        stepLabel: ANALYSIS_STEPS.find((s) => s.key === stepKey)?.label || stepKey,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: Math.max(0, totalEstSeconds - Math.round((totalEstSeconds * percent) / 100)),
        ...payload,
    };

    // 更新内存任务状态
    if (job) {
        job.percent = percent;
        job.currentStep = stepKey;
        job.status = status === 'failed' ? 'failed' : (percent >= 100 ? 'completed' : 'running');
        job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
        event.elapsedSeconds = job.elapsedSeconds;
        const stepEntry = job.steps.find((s) => s.key === stepKey);
        if (stepEntry) {
            stepEntry.status = status;
            stepEntry.message = payload.message || '';
        }
    }

    // 通过 Socket.IO 推送（支持 req 或直接使用 ioInstance）
    const io = reqOrIo?.app?.get?.('io') || ioInstance;
    if (io) io.to(`contract-${contractId}`).emit('analysis-progress', event);

    const partial = payload.partialResult ? JSON.stringify(payload.partialResult) : undefined;
    const update = {
        analysis_status: payload.status || payload.step || 'processing',
        updated_at: db.fn.now(),
    };
    if (partial) update.analysis_partial_result = partial;
    await db('contracts').where({ id: contractId }).update(update).catch(() => null);
};

module.exports = {
    setIoInstance,
    getIoInstance,
    createAnalysisJob,
    updateAnalysisJob,
    emitAnalysisProgress,
    getStepProgress,
    ANALYSIS_STEPS,
    TOTAL_EST_SECONDS,
    analysisJobs,
};

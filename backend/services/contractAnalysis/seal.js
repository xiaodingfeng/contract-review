/**
 * @file services/contractAnalysis/seal.js
 * @brief 印章与签章核验，支持视觉模型与 OCR 双路径
 *
 * 核心职责：
 * - 优先调用视觉模型分析印章类型、PS 疑似、位置合规性
 * - 视觉模型不可用时回退到 tesseract.js OCR 识别印章文字
 * - 将识别结果与合同主体名称匹配，输出风险等级
 *
 * 关键实现：
 * - analyzeSealAndSignature 提取主体候选并构造上下文
 * - 视觉模型失败时降级到 OCR，并按置信度判定风险等级
 * - 多源结果统一映射为 seal_analysis 报告项
 *
 * 依赖关系：
 * - 上游：path、tesseract.js、../webSearch、../sealVision、./knowledge
 * - 下游：被 backgroundAnalysis 印章分析步骤调用
 */
const path = require('path');
const { createWorker } = require('tesseract.js');
const { extractCompanyNames } = require('../webSearch');
const { analyzeSeal } = require('../sealVision');
const { compactText } = require('./knowledge');

const runSealOcr = async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'].includes(ext)) {
        return { text: '', supported: false, reason: '当前 OCR 需要 PDF 中提取出的印章图片，或直接上传印章区域图片。' };
    }

    const worker = await createWorker(process.env.SEAL_OCR_LANG || 'chi_sim+eng');
    try {
        const { data } = await worker.recognize(filePath);
        return { text: data?.text || '', confidence: data?.confidence || 0, supported: true };
    } finally {
        await worker.terminate();
    }
};

const analyzeSealAndSignature = async (contract, plainText) => {
    const companyNames = extractCompanyNames(plainText).slice(0, 3);
    const contractContext = { company_names: companyNames };

    // 优先调用视觉模型分析印章(3.2 多模态印章分析)
    if (process.env.VISION_MODEL_NAME) {
        try {
            const visionResult = await analyzeSeal(contract.storage_path, contractContext, [1]);
            if (visionResult && !visionResult.error && visionResult.seals) {
                const riskLevelMap = { low: '低', medium: '中', high: '高' };
                const overallRisk = riskLevelMap[visionResult.overall_risk_level] || '中';
                return visionResult.seals.map((seal) => ({
                    seal_name: seal.text_on_seal || seal.seal_type || '印章分析',
                    status: seal.position_compliant ? '位置合规' : '位置待核验',
                    risk_level: seal.ps_suspect ? '高' : overallRisk,
                    details: `视觉模型分析:类型=${seal.seal_type || '未知'},PS疑似=${seal.ps_suspect ? '是' : '否'},位置合规=${seal.position_compliant ? '是' : '否'}${seal.issues && seal.issues.length ? ',问题:' + seal.issues.join(';') : ''}`,
                    seal_type: seal.seal_type,
                    ps_suspect: seal.ps_suspect,
                    position_compliant: seal.position_compliant,
                    confidence: seal.confidence,
                    source: 'vision',
                }));
            }
            console.warn('[Seal] Vision analysis returned no seals, falling back to OCR');
        } catch (visionError) {
            console.warn('[Seal] Vision analysis failed, falling back to OCR:', visionError.message);
        }
    }

    // 回退到 tesseract.js OCR(原逻辑)
    try {
        const ocr = await runSealOcr(contract.storage_path);
        if (!ocr.supported) {
            return [{
                seal_name: companyNames[0] || '签章检查',
                status: '待核验',
                risk_level: '中',
                details: `${ocr.reason} 已识别合同主体候选：${companyNames.join('、') || '未识别到明确主体'}。请上传印章区域截图或使用电子签章平台核验。`,
            }];
        }

        const normalizedOcr = ocr.text.replace(/\s+/g, '');
        const matchedCompany = companyNames.find((name) => normalizedOcr.includes(String(name).replace(/\s+/g, '')));
        return [{
            seal_name: matchedCompany || companyNames[0] || '签章检查',
            status: matchedCompany ? '主体名称初步一致' : '待核验',
            risk_level: matchedCompany && ocr.confidence >= 60 ? '低' : '中',
            details: `OCR 置信度 ${Math.round(ocr.confidence || 0)}。${matchedCompany ? `印章文字与主体「${matchedCompany}」初步一致。` : `未在 OCR 文本中匹配到主体候选：${companyNames.join('、') || '无'}。`} OCR 文本摘要：${compactText(ocr.text, 300)}`,
            source: 'ocr',
        }];
    } catch (error) {
        return [{
            seal_name: companyNames[0] || '签章检查',
            status: '待核验',
            risk_level: '中',
            details: `OCR 识别未完成：${error.message}。主体候选：${companyNames.join('、') || '未识别到明确主体'}。`,
            source: 'ocr',
        }];
    }
};

module.exports = {
    runSealOcr,
    analyzeSealAndSignature,
};

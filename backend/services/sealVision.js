/**
 * @file services/sealVision.js
 * @brief 印章与签名多模态视觉分析服务，使用视觉大模型识别并评估合同图片合规性
 *
 * 核心职责：
 * - 从 DOCX（adm-zip）或 PDF（pdfjs-dist）提取内嵌图片
 * - 构造印章/签名分析 prompt，调用视觉模型识别
 * - 输出印章类型、PS 痕迹、位置合规性、签名齐全度与整体风险等级
 *
 * 关键实现：
 * - DOCX：从 word/media/ 提取 PNG/JPEG
 * - PDF：pdfjs-dist + canvas 渲染指定页为图片（依赖缺失时返回空数组告警）
 * - 视觉 API 失败抛错由调用方回退到 tesseract.js
 * - JSON 解析容错：去 markdown 标记后兜底提取首个 JSON 对象
 *
 * 依赖关系：
 * - 上游：path/fs、adm-zip、llmClient（createVisionCompletion）
 * - 下游：印章分析接口调用 analyzeSeal
 */

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { createVisionCompletion } = require('./llmClient');

// 扩展名 → MIME 映射（仅支持 PNG/JPEG）
const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
};

/**
 * 从 DOCX 中提取内嵌图片（word/media/ 目录）
 * @param {string} filePath docx 文件路径
 * @returns {Array<{filename: string, base64: string, mime: string}>}
 */
const extractImagesFromDocx = (filePath) => {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter((entry) => /^word\/media\//.test(entry.entryName));
    const images = [];
    for (const entry of entries) {
        const ext = path.extname(entry.entryName).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime) continue; // 仅保留 PNG/JPEG
        images.push({
            filename: path.basename(entry.entryName),
            base64: entry.getData().toString('base64'),
            mime,
        });
    }
    return images;
};

/**
 * 将 PDF 指定页渲染为图片（base64 PNG）
 * 依赖 pdfjs-dist 与 canvas 包；若未安装则返回空数组并给出告警，由调用方回退到 tesseract.js
 * @param {string} filePath pdf 文件路径
 * @param {number[]} pageNumbers 页码数组（从 1 开始）
 * @returns {Promise<Array<{page: number, base64: string, mime: string}>>}
 */
const extractImagesFromPdf = async (filePath, pageNumbers = [1]) => {
    let pdfjsLib;
    try {
        // 动态加载 pdfjs-dist（项目可能未安装该依赖）
        pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    } catch (error) {
        console.warn('[SealVision] pdfjs-dist 不可用，无法将 PDF 页面渲染为图片：', error.message);
        return [];
    }

    let canvasLib;
    try {
        // pdfjs 在 Node 环境渲染 canvas 需要额外的 canvas 包支持
        canvasLib = require('canvas');
    } catch (error) {
        console.warn('[SealVision] canvas 包不可用，无法将 PDF 页面渲染为图片：', error.message);
        return [];
    }

    // Node 环境下的 Canvas 工厂，供 pdfjs 渲染使用
    const { createCanvas } = canvasLib;
    class NodeCanvasFactory {
        create(width, height) {
            const canvas = createCanvas(width, height);
            const context = canvas.getContext('2d');
            return { canvas, context };
        }
        reset(canvasAndContext, width, height) {
            canvasAndContext.canvas.width = width;
            canvasAndContext.canvas.height = height;
        }
        destroy(canvasAndContext) {
            canvasAndContext.canvas.width = 0;
            canvasAndContext.canvas.height = 0;
        }
    }

    const factory = new NodeCanvasFactory();
    const images = [];
    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const pdfDocument = await pdfjsLib.getDocument({ data }).promise;
        const totalPages = pdfDocument.numPages;
        const pages = (pageNumbers && pageNumbers.length ? pageNumbers : [1])
            .filter((p) => p >= 1 && p <= totalPages);

        for (const pageNumber of pages) {
            const page = await pdfDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 2 });
            const canvasAndContext = factory.create(viewport.width, viewport.height);
            await page.render({
                canvasContext: canvasAndContext.context,
                viewport,
                canvasFactory: factory,
            }).promise;
            const base64 = canvasAndContext.canvas.toBuffer('image/png').toString('base64');
            images.push({ page: pageNumber, base64, mime: 'image/png' });
            factory.destroy(canvasAndContext);
        }
        await pdfDocument.destroy();
    } catch (error) {
        console.warn(`[SealVision] PDF 页面渲染失败：${error.message}`);
    }
    return images;
};

/**
 * 根据文件扩展名提取图片
 * @param {string} filePath 文件路径
 * @param {number[]} pageNumbers PDF 页码数组（从 1 开始）
 * @returns {Promise<Array<{page?: number, filename?: string, base64: string, mime: string}>>}
 */
const extractImages = async (filePath, pageNumbers = [1]) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
        return extractImagesFromDocx(filePath);
    }
    if (ext === '.pdf') {
        return extractImagesFromPdf(filePath, pageNumbers);
    }
    return [];
};

// 构造印章与签名分析的系统 prompt
const buildSealVisionPrompt = (contractContext = {}) => {
    const parties = contractContext.parties || contractContext.party_names || [];
    const contextLines = [];
    if (contractContext.title) contextLines.push(`合同名称：${contractContext.title}`);
    if (contractContext.contract_type) contextLines.push(`合同类型：${contractContext.contract_type}`);
    if (Array.isArray(parties) && parties.length) {
        contextLines.push(`合同主体：${parties.join('、')}`);
    } else if (typeof parties === 'string' && parties) {
        contextLines.push(`合同主体：${parties}`);
    }
    const contextText = contextLines.length ? contextLines.join('\n') : '（未提供合同主体信息）';

    return [
        '你是一名专业的合同印章与签名审核专家。请仔细分析提供的合同图片，识别其中的印章和签名，并评估其合规性。',
        '',
        contextText,
        '',
        '请重点检查：',
        '1. 印章类型（公章、合同章、财务章、法人章）及印章上的文字',
        '2. 印章文字与合同主体是否一致',
        '3. 是否存在伪造或 PS 痕迹（颜色异常、边缘模糊、像素不一致等）',
        '4. 印章位置是否合规（通常需压在单位名称或日期上）',
        '5. 各方签名是否齐全',
        '',
        '请严格以如下 JSON 格式输出（不要输出 JSON 以外的任何内容）：',
        '{',
        '  "seals": [',
        '    {',
        '      "seal_type": "公章|合同章|财务章|法人章|未知",',
        '      "text_on_seal": "OCR文字",',
        '      "confidence": 0.8,',
        '      "ps_suspect": false,',
        '      "position_compliant": true,',
        '      "issues": []',
        '    }',
        '  ],',
        '  "signatures": [',
        '    {',
        '      "signatory_role": "甲方/乙方",',
        '      "present": true,',
        '      "confidence": 0.9',
        '    }',
        '  ],',
        '  "overall_risk_level": "high|medium|low",',
        '  "summary": "整体评估"',
        '}',
    ].join('\n');
};

// 解析 LLM 返回的 JSON（去掉 ```json 标记）
const parseVisionJson = (raw) => {
    const cleaned = String(raw || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        // 尝试提取第一个 JSON 对象
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {
                // 忽略，抛出下面的错误
            }
        }
        throw new Error(`视觉模型返回内容无法解析为 JSON：${cleaned.substring(0, 200)}`);
    }
};

/**
 * 调用视觉模型分析图片中的印章与签名
 * @param {Array<{base64: string, mime: string}>} images 图片列表
 * @param {object} contractContext 合同上下文（主体名称等）
 * @returns {Promise<object>} 解析后的分析结果
 */
const analyzeWithVision = async (images, contractContext = {}) => {
    const systemPrompt = buildSealVisionPrompt(contractContext);
    const userContent = [
        { type: 'text', text: '请分析以下合同图片中的印章与签名。' },
        ...images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
        })),
    ];

    const response = await createVisionCompletion({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ],
    });

    const raw = response?.choices?.[0]?.message?.content || '';
    return parseVisionJson(raw);
};

/**
 * 印章与签名分析主入口
 * @param {string} filePath 合同文件路径（.docx / .pdf）
 * @param {object} contractContext 合同上下文（主体名称等）
 * @param {number[]} pageNumbers PDF 页码数组（从 1 开始）
 * @returns {Promise<object>} 分析结果
 */
const analyzeSeal = async (filePath, contractContext = {}, pageNumbers = [1]) => {
    const images = await extractImages(filePath, pageNumbers);
    if (!images || images.length === 0) {
        return {
            error: 'NO_IMAGES',
            message: '未能从文件中提取到可分析的图片，请回退到 tesseract.js 或其他方式。',
        };
    }

    // 统计实际分析的页码；DOCX 无页码时回退到请求的 pageNumbers
    const pageSet = new Set(images.map((img) => img.page).filter((p) => p != null));
    const pagesAnalyzed = pageSet.size ? Array.from(pageSet) : [...pageNumbers];

    // 视觉 API 失败时抛出错误，由调用方回退
    const result = await analyzeWithVision(images, contractContext);

    return {
        pages_analyzed: pagesAnalyzed,
        seals: result.seals || [],
        signatures: result.signatures || [],
        overall_risk_level: result.overall_risk_level || 'low',
        summary: result.summary || '',
        source: 'vision',
    };
};

module.exports = {
    extractImagesFromDocx,
    extractImagesFromPdf,
    extractImages,
    analyzeWithVision,
    analyzeSeal,
};

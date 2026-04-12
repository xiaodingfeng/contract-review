const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const unidecode = require('unidecode');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const iconv = require('iconv-lite');
const AdmZip = require('adm-zip');
const db = require('../database');
const { searchVectorDocuments } = require('../services/vectorStore');
const { getTemplateById, matchTemplate } = require('../services/reviewTemplates');
const { extractCompanyNames, searchCompanyInfo } = require('../services/webSearch');
const { createChatCompletion } = require('../services/llmClient');

const router = express.Router();

const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET;
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://localhost:8081';
const APP_HOST = process.env.APP_HOST;
const BACKEND_URL_FOR_DOCKER = process.env.BACKEND_URL_FOR_DOCKER || APP_HOST;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        const sanitizedOriginalName = unidecode(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${uniqueSuffix}-${sanitizedOriginalName}`);
    },
});
const upload = multer({ storage });

const extractTextFromFile = async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
        const { value } = await mammoth.extractRawText({ path: filePath });
        return value;
    }
    if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(filePath));
        return data.text;
    }
    throw new Error(`Unsupported file extension: ${ext}`);
};

const cleanJsonResponse = (text) => {
    const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
};

const callJsonLLM = async (prompt) => {
    const completion = await createChatCompletion({
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    });
    return cleanJsonResponse(completion.choices[0].message.content);
};

const buildOnlyOfficeConfig = (contractRecord, ext = 'docx') => {
    const isPdf = ext === 'pdf';
    const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/uploads/${path.basename(contractRecord.storage_path)}`;
    const callbackUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;
    const payload = {
        document: {
            fileType: ext,
            key: contractRecord.document_key,
            title: contractRecord.original_filename,
            url: fileUrl,
            permissions: {
                comment: !isPdf,
                download: true,
                edit: !isPdf,
                print: true,
                review: !isPdf,
            },
        },
        documentType: isPdf ? 'pdf' : 'word',
        editorConfig: {
            callbackUrl,
            lang: 'zh-CN',
            mode: isPdf ? 'view' : 'edit',
            user: {
                id: `user-${contractRecord.user_id || 1}`,
                name: 'Reviewer',
            },
            customization: {
                forcesave: !isPdf,
                comments: true,
                compactHeader: true,
                compactToolbar: true,
                toolbarHideFileName: true,
                toolbarNoTabs: true,
                features: {
                    tabStyle: 'line',
                    tabBackground: 'toolbar',
                    spellcheck: false,
                },
                hideRightMenu: true,
                hideRulers: true,
                help: false,
                plugins: false,
                chat: false,
                feedback: false,
                goback: false,
            },
        },
    };
    return { ...payload, token: jwt.sign(payload, ONLYOFFICE_JWT_SECRET) };
};

const postOnlyOfficeCommand = async (payload) => {
    const commandPayload = ONLYOFFICE_JWT_SECRET
        ? { ...payload, token: jwt.sign(payload, ONLYOFFICE_JWT_SECRET) }
        : payload;

    const headers = { 'Content-Type': 'application/json' };
    if (ONLYOFFICE_JWT_SECRET) {
        headers.Authorization = `Bearer ${commandPayload.token}`;
    }

    const response = await axios.post(
        `${ONLYOFFICE_URL.replace(/\/$/, '')}/coauthoring/CommandService.ashx`,
        commandPayload,
        { headers, timeout: 10000 },
    );
    return response.data;
};

const escapeXmlText = (text) => String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const unescapeXmlText = (text) => String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const normalizeForDocxMatch = (text) => {
    const normalized = [];
    const indexMap = [];
    for (let index = 0; index < String(text || '').length; index += 1) {
        const char = String(text)[index]
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[：]/g, ':')
            .replace(/[，]/g, ',')
            .replace(/[。]/g, '.');
        if (/\s/.test(char)) continue;
        normalized.push(char);
        indexMap.push(index);
    }
    return { value: normalized.join(''), indexMap };
};

const findDocxTextRange = (fullText, candidate) => {
    const exactIndex = fullText.indexOf(candidate);
    if (exactIndex >= 0) {
        return { start: exactIndex, end: exactIndex + candidate.length };
    }

    const normalizedFull = normalizeForDocxMatch(fullText);
    const normalizedCandidate = normalizeForDocxMatch(candidate).value;
    if (!normalizedCandidate) return null;

    const normalizedIndex = normalizedFull.value.indexOf(normalizedCandidate);
    if (normalizedIndex < 0) return null;

    const start = normalizedFull.indexMap[normalizedIndex];
    const end = normalizedFull.indexMap[normalizedIndex + normalizedCandidate.length - 1] + 1;
    return { start, end };
};

const replaceTextInXmlRuns = (xml, candidate, suggestedText) => {
    const textRunPattern = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    const runs = [];
    let match;
    let fullText = '';

    while ((match = textRunPattern.exec(xml)) !== null) {
        const decodedText = unescapeXmlText(match[2]);
        runs.push({
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
            attrs: match[1],
            rawText: match[2],
            text: decodedText,
            start: fullText.length,
            end: fullText.length + decodedText.length,
        });
        fullText += decodedText;
    }

    const range = findDocxTextRange(fullText, candidate);
    if (!range) return { xml, replaced: false };

    let inserted = false;
    const safeSuggestion = String(suggestedText || '').replace(/\r?\n+/g, ' ');
    const parts = [];
    let cursor = 0;

    for (const run of runs) {
        parts.push(xml.slice(cursor, run.matchStart));
        cursor = run.matchEnd;

        if (run.end <= range.start || run.start >= range.end) {
            parts.push(`<w:t${run.attrs}>${run.rawText}</w:t>`);
            continue;
        }

        const overlapStart = Math.max(range.start, run.start) - run.start;
        const overlapEnd = Math.min(range.end, run.end) - run.start;
        const before = run.text.slice(0, overlapStart);
        const after = run.text.slice(overlapEnd);
        let nextText = '';

        if (!inserted) {
            nextText = before + safeSuggestion;
            inserted = true;
        }
        if (run.end >= range.end) {
            nextText += after;
        }

        const attrs = /^\s/.test(nextText) || /\s$/.test(nextText)
            ? (run.attrs.includes('xml:space=') ? run.attrs : `${run.attrs} xml:space="preserve"`)
            : run.attrs;
        parts.push(`<w:t${attrs}>${escapeXmlText(nextText)}</w:t>`);
    }

    parts.push(xml.slice(cursor));
    return { xml: parts.join(''), replaced: true };
};

const normalizeReplacementCandidates = (originalText, originalCandidates = []) => {
    const candidates = [originalText, ...originalCandidates]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    const seen = new Set();
    return candidates.filter((candidate) => {
        const key = normalizeForDocxMatch(candidate).value;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const replaceTextInDocx = (filePath, originalText, suggestedText, originalCandidates = []) => {
    const zip = new AdmZip(filePath);
    const xmlEntries = zip.getEntries().filter((entry) => /^word\/.*\.xml$/.test(entry.entryName));
    const escapedSuggestion = escapeXmlText(suggestedText);
    const candidates = normalizeReplacementCandidates(originalText, originalCandidates);
    let replacements = 0;

    for (const entry of xmlEntries) {
        let xml = entry.getData().toString('utf8');
        let updated = false;

        for (const candidate of candidates) {
            const escapedOriginal = escapeXmlText(candidate);
            const exactCount = xml.split(escapedOriginal).length - 1;
            if (exactCount > 0) {
                xml = xml.split(escapedOriginal).join(escapedSuggestion);
                replacements += exactCount;
                updated = true;
                break;
            }

            const runReplacement = replaceTextInXmlRuns(xml, candidate, suggestedText);
            if (runReplacement.replaced) {
                xml = runReplacement.xml;
                replacements += 1;
                updated = true;
                break;
            }
        }

        if (updated) {
            zip.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
        }
    }

    if (replacements === 0) {
        throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
    }

    zip.writeZip(filePath);
    return replacements;
};

const ensureUploadUser = async (trx, userId) => {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        throw new Error('INVALID_USER_ID');
    }

    const existing = await trx('users').where({ id: numericUserId }).first();
    if (existing) return numericUserId;

    await trx('users')
        .insert({
            id: numericUserId,
            fingerprint_id: `legacy-upload-user-${numericUserId}`,
        })
        .onConflict('id')
        .ignore();

    await trx.raw("select setval(pg_get_serial_sequence('users', 'id'), greatest((select coalesce(max(id), 0) from users), 1), true)");
    return numericUserId;
};

const compactText = (value, maxLength = 4000) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const buildKnowledgeSearchQuery = ({
    text = '',
    contractType = '',
    reviewPoints = [],
    corePurposes = [],
    question = '',
    perspective = '',
} = {}) => {
    const focusedTerms = [
        contractType,
        perspective ? `${perspective} 立场 风险 责任 权利义务` : '',
        ...reviewPoints,
        ...corePurposes,
        question,
    ].filter(Boolean).join('\n');

    return [
        focusedTerms,
        compactText(text, focusedTerms ? 3500 : 6000),
    ].filter(Boolean).join('\n');
};

const getRelevantKnowledge = async (options, limit = 8) => {
    const query = typeof options === 'string'
        ? buildKnowledgeSearchQuery({ text: options })
        : buildKnowledgeSearchQuery(options);
    const matches = await searchVectorDocuments(query, {
        limit,
        sourceTypes: ['law', 'case'],
        rerank: true,
    });

    return matches.map((item) => ({
        source_type: item.source_type,
        law: item.title,
        clause: item.clause_id || item.source_id,
        content: item.content,
        score: item.rerank_score ?? item.score,
        source_name: item.source_name,
        source_url: item.source_url,
        metadata: item.metadata || {},
    }));
};

const annotateKnowledgeUpdates = (items) => items.map((item) => ({
    ...item,
    hasUpdate: false,
    updateNotice: '当前知识库未标记该依据存在更新；正式出具意见前仍应核对最新法律、司法解释和裁判文书。',
}));

const normalizeAnalysisResult = (result) => ({
    dispute_points: Array.isArray(result.dispute_points) ? result.dispute_points : [],
    missing_clauses: Array.isArray(result.missing_clauses) ? result.missing_clauses : [],
    party_review: Array.isArray(result.party_review) ? result.party_review : [],
    modification_suggestions: Array.isArray(result.modification_suggestions) ? result.modification_suggestions : [],
    breach_cost_analysis: Array.isArray(result.breach_cost_analysis) ? result.breach_cost_analysis : [],
    seal_analysis: Array.isArray(result.seal_analysis) ? result.seal_analysis : [],
    relevant_laws: Array.isArray(result.relevant_laws) ? result.relevant_laws : [],
    company_review: Array.isArray(result.company_review) ? result.company_review : [],
});

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required for upload.' });

    try {
        const contractRecord = await db.transaction(async (trx) => {
            const safeUserId = await ensureUploadUser(trx, userId);
            const originalFilenameDecoded = iconv.decode(Buffer.from(req.file.originalname, 'binary'), 'utf-8');
            const documentKey = uuidv4();
            const [newContract] = await trx('contracts').insert({
                user_id: safeUserId,
                original_filename: originalFilenameDecoded,
                storage_path: req.file.path,
                document_key: documentKey,
                status: 'Uploaded',
            }).returning(['id', 'original_filename', 'document_key', 'storage_path', 'user_id']);

            return newContract || await trx('contracts').where({ document_key: documentKey }).first();
        });
        const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '');
        res.status(201).json({
            message: 'File uploaded, editor config generated.',
            contractId: contractRecord.id,
            editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
        });
    } catch (error) {
        if (error.message === 'INVALID_USER_ID') {
            return res.status(400).json({ error: 'Invalid user ID for upload.' });
        }
        console.error('[ERROR] Error processing upload for OnlyOffice:', error);
        res.status(500).json({ error: 'Server error during file upload.' });
    }
});

router.post('/save-callback', async (req, res) => {
    try {
        const body = req.body;
        console.log('[OnlyOffice] save callback:', {
            status: body.status,
            key: body.key,
            hasUrl: Boolean(body.url),
            forcesavetype: body.forcesavetype,
        });
        if (body.status === 2 || body.status === 6) {
            const contract = await db('contracts').where({ document_key: body.key }).first();
            if (contract && body.url) {
                const response = await axios.get(body.url, { responseType: 'stream' });
                const writer = fs.createWriteStream(contract.storage_path);
                response.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                await db('contracts').where({ id: contract.id }).update({ updated_at: db.fn.now() });
                console.log(`[OnlyOffice] saved file for contract ${contract.id} from status ${body.status}`);
            } else {
                console.warn('[OnlyOffice] save callback skipped: contract or download url missing');
            }
        }
        res.status(200).json({ error: 0 });
    } catch (error) {
        console.error('[ERROR] Save callback failed:', error);
        res.status(200).json({ error: 0 });
    }
});

router.post('/pre-analyze', async (req, res) => {
    const { contractId } = req.body;
    if (!contractId) return res.status(400).json({ error: 'Contract ID is required.' });

    try {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const plainText = await extractTextFromFile(contract.storage_path);
        const prompt = `你是专业法务助手。阅读合同后只输出 JSON：
{
  "contract_type": "合同类型",
  "potential_parties": ["可选审查立场"],
  "suggested_review_points": ["关键审查点"],
  "suggested_core_purposes": ["核心审查目的"]
}

要求：
- 审查点和目的必须具体，优先贴合合同类型。
- 不输出自然语言解释。

合同原文：
---
${plainText}
---`;
        const analysisResult = await callJsonLLM(prompt);
        const template = matchTemplate(analysisResult.contract_type, plainText);
        analysisResult.template_id = template?.id || 'general';
        analysisResult.template_name = template?.name || '通用合同审查模板';
        analysisResult.available_templates = undefined;
        analysisResult.suggested_review_points = Array.from(new Set([
            ...(template?.review_points || []),
            ...(analysisResult.suggested_review_points || []),
        ]));
        analysisResult.suggested_core_purposes = Array.from(new Set([
            ...(template?.core_purposes || []),
            ...(analysisResult.suggested_core_purposes || []),
        ]));

        await db('contracts').where({ id: contractId }).update({
            status: 'PreAnalyzed',
            pre_analysis_data: JSON.stringify(analysisResult),
        });
        res.json(analysisResult);
    } catch (error) {
        console.error(`[ERROR] Pre-analysis failed for contract ${contractId}:`, error);
        res.status(500).json({ error: '预分析失败，请稍后重试。' });
    }
});

router.post('/analyze', async (req, res) => {
    const { contractId, userPerspective, preAnalysisData } = req.body;
    if (!contractId || !userPerspective || !preAnalysisData?.contract_type) {
        return res.status(400).json({ error: 'Incomplete analysis request. A full preAnalysisData object is required.' });
    }

    try {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const plainText = await extractTextFromFile(contract.storage_path);
        const template = getTemplateById(preAnalysisData.template_id) || matchTemplate(preAnalysisData.contract_type, plainText);
        const reviewPoints = preAnalysisData.reviewPoints?.length ? preAnalysisData.reviewPoints : template.review_points;
        const corePurposes = preAnalysisData.core_purposes?.length ? preAnalysisData.core_purposes : template.core_purposes;
        const relevantKnowledge = await getRelevantKnowledge({
            text: plainText,
            contractType: preAnalysisData.contract_type,
            reviewPoints,
            corePurposes,
            perspective: userPerspective,
        });
        const companySearchResults = await Promise.all(
            extractCompanyNames(plainText).slice(0, 3).map((name) => searchCompanyInfo(name)),
        );
        const companySearchContext = companySearchResults.map((company, index) => {
            const evidence = company.results.slice(0, 5).map((item, resultIndex) => (
                `${resultIndex + 1}. [${item.engine}] ${item.title} ${item.url} 可信度:${item.authenticity_score} ${item.verified ? '已通过初步真实性检测' : '未通过真实性检测'} 摘要:${item.snippet}`
            )).join('\n');
            return `${index + 1}. ${company.companyName}\n${evidence || '未检索到可用外部证据'}`;
        }).join('\n');

        const prompt = `你是一名资深法务专家，请按审查模板对合同进行深度审查，并只输出 JSON。

审查模板：
- 模板名称：${template.name}
- 合同类型：${preAnalysisData.contract_type}
- 用户立场：${userPerspective}
- 审查点：${reviewPoints.join('；')}
- 审查目的：${corePurposes.join('；')}
- 模板规则：${(template.prompt_rules || []).join('；')}
- 报告结构偏好：${(template.report_sections || []).join('；')}

法律与裁判依据（向量 RAG + rerank 检索结果，只能引用以下内容，不得虚构法条、案号或裁判观点）：
${relevantKnowledge.map((item, index) => `[${index + 1}] [${item.source_type}] ${item.law} ${item.clause || ''}：${item.content}`).join('\n') || '未检索到直接依据。'}

输出 JSON 结构：
{
  "dispute_points": [{"title":"风险标题","original_clause":"合同原文","legal_reference":"依据","dispute_rationale":"风险说明","plain_language":"大白话说明","severity":"高/中/低"}],
  "missing_clauses": [{"title":"缺失条款","description":"为什么缺失","suggested_clause":"可补充条款"}],
  "party_review": [{"title":"主体审查项","description":"审查结论","plain_language":"大白话说明"}],
  "modification_suggestions": [{"title":"建议标题","original_text":"合同中可定位的完整原文句子或段落","suggested_text":"可直接替换 original_text 的完整文本","reason":"修改理由","plain_language":"大白话说明","anchor_hint":"用于定位的短语"}],
  "breach_cost_analysis": [{"scenario":"违约场景","legal_basis":"依据","estimated_cost":"预计成本"}]
}

硬性要求：
- modification_suggestions 每一项必须包含 original_text 和 suggested_text。
- original_text 必须尽量逐字摘录合同原文中的完整句子或段落，用于 OnlyOffice 定位、书签和批注锚点。
- 如果没有检索依据，不得编造法条或案例，只能说明“当前知识库未检索到直接依据”。
- 不输出自然语言解释，不输出 markdown。

合同原文：
---
${plainText}
---`;

        const subjectSearchPrompt = `\n\n主体外部检索证据（来自 Bing/Baidu 搜索，已做基础真实性评分；只能把 verified=true 或可信度较高的结果作为主体审查线索，不能当作最终工商登记结论）：\n${companySearchContext || '未识别到可检索的公司主体名称。'}\n\n请额外输出 company_review 字段，结构为 [{"company_name":"公司名称","status":"已检索/未检索到可靠证据","evidence_summary":"基于外部搜索证据的主体核验摘要","authenticity":"真实性检测结论","sources":["URL"]}]。`;
        const analysisResult = normalizeAnalysisResult(await callJsonLLM(prompt + subjectSearchPrompt));
        analysisResult.relevant_laws = annotateKnowledgeUpdates(relevantKnowledge);
        analysisResult.company_search = companySearchResults;
        if (!analysisResult.company_review.length && companySearchResults.length) {
            analysisResult.company_review = companySearchResults.map((company) => ({
                company_name: company.companyName,
                status: company.verifiedResults.length ? '已检索到可初步核验的主体线索' : '未检索到足够可靠的主体证据',
                evidence_summary: company.verifiedResults[0]?.snippet || company.results[0]?.snippet || '外部搜索未返回足够证据。',
                authenticity: company.verifiedResults.length ? '存在官方或多源交叉线索，仍需以国家企业信用信息公示系统等正式渠道为准。' : '搜索结果未通过基础真实性检测，不能据此下结论。',
                sources: (company.verifiedResults.length ? company.verifiedResults : company.results).slice(0, 3).map((item) => item.url),
            }));
        }
        analysisResult.template = {
            id: template.id,
            name: template.name,
            report_sections: template.report_sections || [],
        };
        analysisResult.seal_analysis = analysisResult.seal_analysis.length ? analysisResult.seal_analysis : [
            { seal_name: '签章检查', status: '待核验', risk_level: '中', details: '当前版本未接入真实印章识别服务，请结合原件或电子签章平台核验。' },
        ];

        await db('contracts').where({ id: contractId }).update({
            status: 'Reviewed',
            analysis_result: JSON.stringify(analysisResult),
            pre_analysis_data: JSON.stringify(preAnalysisData),
            perspective: userPerspective,
        });

        const io = req.app.get('io');
        if (io) io.to(`contract-${contractId}`).emit('analysis-complete', { results: analysisResult, perspective: userPerspective });
        res.json(analysisResult);
    } catch (error) {
        console.error('Error during AI analysis:', error);
        res.status(500).json({ error: 'AI分析过程中发生错误。' });
    }
});

router.post('/review-text', async (req, res) => {
    const { text, question, perspective, contractType, templateId } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text is required for focused review.' });

    try {
        const template = getTemplateById(templateId) || matchTemplate(contractType || '', text);
        const relevantKnowledge = await getRelevantKnowledge({
            text,
            contractType: contractType || template.name,
            reviewPoints: template.review_points || [],
            corePurposes: template.core_purposes || [],
            question,
            perspective,
        }, 6);
        const prompt = `你是专业合同审查助手。用户选中了合同中的一段文本，请进行专项审查，只输出 JSON。

审查模板：${template.name}
审查立场：${perspective || '未指定'}
专项问题：${question || '识别该段文本的法律风险、可修改点，并给出可替换文本。'}

可引用依据（只能引用以下内容，不得虚构）：
${relevantKnowledge.map((item, index) => `[${index + 1}] [${item.source_type}] ${item.law} ${item.clause || ''}：${item.content}`).join('\n') || '未检索到直接依据。'}

待审查文本：
---
${text}
---

输出 JSON：
{
  "risk_summary": "风险结论",
  "suggested_text": "可直接替换原文的完整文本；如无需修改则为空字符串",
  "reason": "专业理由",
  "plain_language": "大白话说明",
  "citations": [{"source_type":"law/case","title":"依据名称","clause":"条号或片段","content":"引用内容"}]
}`;
        const parsed = await callJsonLLM(prompt);
        parsed.relevant_laws = annotateKnowledgeUpdates(relevantKnowledge);
        res.json(parsed);
    } catch (error) {
        console.error('[ERROR] Focused review failed:', error);
        res.status(500).json({ error: 'Focused review failed.' });
    }
});

router.post('/:id/replace-text', async (req, res) => {
    const userId = req.header('X-User-ID');
    const { originalText, suggestedText, originalCandidates = [] } = req.body || {};
    if (!originalText || !suggestedText) {
        return res.status(400).json({ error: 'originalText and suggestedText are required.' });
    }

    try {
        const query = db('contracts').where({ id: req.params.id });
        if (userId) query.andWhere({ user_id: userId });
        const contract = await query.first();
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
        if (ext !== 'docx') {
            return res.status(400).json({ error: 'Only DOCX files support server-side replacement.' });
        }

        const replacements = replaceTextInDocx(contract.storage_path, originalText, suggestedText, originalCandidates);
        const nextKey = uuidv4();
        await db('contracts').where({ id: contract.id }).update({
            document_key: nextKey,
            updated_at: db.fn.now(),
        });
        const updatedContract = { ...contract, document_key: nextKey };
        res.json({
            replacements,
            editorConfig: buildOnlyOfficeConfig(updatedContract, ext),
        });
    } catch (error) {
        if (error.message === 'DOCX_EXACT_TEXT_NOT_FOUND') {
            return res.status(409).json({
                error: '未能在 DOCX 源文件中精确匹配原文，请先定位原文或缩短替换片段后重试。',
            });
        }
        console.error('[ERROR] Server-side DOCX replacement failed:', error);
        res.status(500).json({ error: 'Server-side DOCX replacement failed.' });
    }
});

router.post('/:id/force-save', async (req, res) => {
    const userId = req.header('X-User-ID');
    const { documentKey } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

    try {
        const contract = await db('contracts').where({ id: req.params.id, user_id: userId }).first();
        if (!contract) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });
        const key = String(documentKey || contract.document_key || '').trim();
        if (!key) return res.status(400).json({ error: 'Document key is required for force-save.' });

        const result = await postOnlyOfficeCommand({
            c: 'forcesave',
            key,
        });

        if (result?.error && result.error !== 0) {
            return res.status(502).json({ error: `OnlyOffice force-save failed: ${result.error}`, result });
        }

        res.json({ ok: true, result });
    } catch (error) {
        console.error(`[ERROR] Failed to force-save contract ${req.params.id}:`, error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to trigger OnlyOffice force-save.' });
    }
});

router.get('/:id/editor-config', async (req, res) => {
    const { id } = req.params;
    const userId = req.header('X-User-ID');
    if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

    try {
        const contractRecord = await db('contracts').where({ id, user_id: userId }).first();
        if (!contractRecord) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });

        const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '') || 'docx';
        res.json({
            editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
        });
    } catch (error) {
        console.error(`[ERROR] Failed to fetch fresh editor config for id ${id}:`, error);
        res.status(500).json({ error: 'Server error while fetching editor config.' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.header('X-User-ID');
    if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

    try {
        const contractRecord = await db('contracts').where({ id, user_id: userId }).first();
        if (!contractRecord) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });

        const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '') || 'docx';
        const preAnalysisData = contractRecord.pre_analysis_data ? JSON.parse(contractRecord.pre_analysis_data) : {};
        const reviewData = contractRecord.analysis_result ? JSON.parse(contractRecord.analysis_result) : {};
        res.json({
            contract: {
                id: contractRecord.id,
                original_filename: contractRecord.original_filename,
                editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
            },
            preAnalysisData,
            reviewData,
            perspective: contractRecord.perspective,
            selectedReviewPoints: preAnalysisData.reviewPoints || preAnalysisData.suggested_review_points || [],
            customPurposes: preAnalysisData.core_purposes ? preAnalysisData.core_purposes.map((value) => ({ value })) : [],
        });
    } catch (error) {
        console.error(`[ERROR] Failed to fetch contract details for id ${id}:`, error);
        res.status(500).json({ error: 'Server error while fetching contract details.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const contract = await db('contracts').where({ id }).first();
        if (!contract) return res.status(404).json({ error: 'Contract not found, cannot delete.' });
        if (contract.storage_path) await fs.promises.unlink(contract.storage_path).catch(() => {});
        await db('contracts').where({ id }).del();
        res.status(200).json({ message: 'Contract deleted successfully.' });
    } catch (error) {
        console.error(`[ERROR] Failed to delete contract with ID ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete contract.' });
    }
});

router.get('/', async (req, res) => {
    const userId = req.header('X-User-ID');
    if (!userId) return res.status(401).json({ error: 'User ID is required to fetch history.' });

    try {
        const contracts = await db('contracts')
            .where({ user_id: userId })
            .select('id', 'original_filename', 'created_at', 'status')
            .orderBy('created_at', 'desc');
        res.json(contracts);
    } catch (error) {
        console.error(`[ERROR] Failed to fetch contract history for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to fetch contract history.' });
    }
});

module.exports = router;

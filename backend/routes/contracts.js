const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const axios = require('axios');
const mammoth = require('mammoth');
const unidecode = require('unidecode');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { OpenAI } = require('openai');
const iconv = require('iconv-lite');

// --- AI Provider Configuration ---
const AI_PROVIDER = process.env.AI_PROVIDER; // 'ollama' or 'siliconflow'

// --- Ollama Configuration ---
const OLLAMA_GENERATE_URL = process.env.OLLAMA_GENERATE_URL;

// --- SiliconFlow Configuration ---
// Note: The user must set the SILICONFLOW_API_KEY environment variable.
const siliconflow = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: 'https://api.siliconflow.cn/v1',
});

const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET;
const APP_HOST = process.env.APP_HOST;
// Use a specific, reachable URL for containers. Defaults to APP_HOST if not set.
const BACKEND_URL_FOR_DOCKER = process.env.BACKEND_URL_FOR_DOCKER || APP_HOST;

// --- Multer Setup for file uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Sanitize the filename to be URL-friendly and ASCII-only
        const sanitizedOriginalName = unidecode(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, uniqueSuffix + '-' + sanitizedOriginalName);
    }
});
const upload = multer({ storage: storage });

// POST /api/contracts/upload
// Handles file upload, saves metadata to DB, and returns OnlyOffice config
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required for upload.' });
    }

    const documentKey = uuidv4();

    try {
        // Decode filename correctly FIRST, before any other operation
        const originalFilenameDecoded = iconv.decode(Buffer.from(req.file.originalname, 'binary'), 'utf-8');

        const [newContract] = await db('contracts')
            .insert({
                user_id: userId,
                original_filename: originalFilenameDecoded, // Use the DECODED name for the database
                storage_path: req.file.path,
                document_key: documentKey,
                status: 'Uploaded'
            })
            .returning(['id', 'original_filename', 'document_key']);

        if (!newContract) {
            return res.status(500).json({ error: 'Failed to insert contract into database.' });
        }

        // Use the specific URL for Docker containers
        const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/uploads/${req.file.filename}`;
        const callbackUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;

        // Log the generated URL for diagnostics
        console.log(`[DEBUG] Generated file URL for OnlyOffice to download: ${fileUrl}`);

        // This is the entire configuration object that will be signed
        const payloadObject = {
            document: {
                fileType: 'docx',
                key: documentKey,
                title: newContract.original_filename, // Now using the clean name from the DB
                url: fileUrl,
            },
            documentType: 'word',
            editorConfig: {
                callbackUrl: callbackUrl,
                mode: 'edit',
                user: {
                    id: "user-1",
                    name: "Reviewer"
                },
                customization: {
                    forcesave: true, // Forces the editor to save the document when the user clicks the save button
                },
            },
        };

        // Generate JWT token by signing the entire payload
        const token = jwt.sign(payloadObject, ONLYOFFICE_JWT_SECRET);

        // The final config sent to the frontend includes the token
        const editorConfigWithToken = { ...payloadObject, token: token };

        res.status(201).json({
            message: 'File uploaded, editor config generated.',
            contractId: newContract.id,
            editorConfig: editorConfigWithToken,
        });

    } catch (error) {
        console.error('[ERROR] Error processing upload for OnlyOffice:', error);
        res.status(500).json({ error: 'Server error during file upload.' });
    }
});

// POST /api/contracts/save-callback
// A single endpoint for OnlyOffice to notify about saving the document
router.post('/save-callback', async (req, res) => {
    try {
        const body = req.body;
        console.log('[INFO] Save callback received:', JSON.stringify(body, null, 2));

        // Status 2 means the document is edited and ready for saving.
        // See OnlyOffice API docs for all status meanings.
        if (body.status === 2 || body.status === 6) { // 6 means must-save
            const downloadUrl = body.url;
            const documentKey = body.key;

            if (!downloadUrl) {
                console.warn(`[WARN] No download URL provided for key ${documentKey} in callback.`);
                // Still need to respond with success, so we just return here.
                return res.status(200).json({ error: 0 });
            }

            const contract = await db('contracts').where({ document_key: documentKey }).first();
            if (!contract) {
                // This is a critical error on our side, but we must not tell OnlyOffice about it.
                // Log it and return success to the editor.
                console.error(`[ERROR] Save callback failed: Contract with key ${documentKey} not found in the database.`);
                return res.status(200).json({ error: 0 });
            }

            const response = await axios.get(downloadUrl, { responseType: 'stream' });
            const writer = fs.createWriteStream(contract.storage_path);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(`[INFO] Document ${contract.original_filename} (key: ${documentKey}) updated successfully.`);
        }

        res.status(200).json({ error: 0 }); // Must return { "error": 0 } for success
    } catch (error) {
        console.error('[ERROR] Save callback failed:', error);
        // Important: Even on server error, OnlyOffice expects a { "error": 0 } response.
        // Otherwise, it will show an error to the user.
        res.status(200).json({ error: 0 });
    }
});


// POST /api/contracts/analyze
// Runs AI analysis using Ollama by reading the DOCX file
router.post('/analyze', async (req, res) => {
    // We now expect a more detailed payload that includes the full pre-analysis state
    const { contractId, userPerspective, preAnalysisData } = req.body;

    // Validate the new payload structure
    if (!contractId || !userPerspective || !preAnalysisData || !preAnalysisData.contract_type || !preAnalysisData.suggested_review_points) {
        return res.status(400).json({ error: 'Incomplete analysis request. A full preAnalysisData object is required.' });
    }

    // Extract details from the preAnalysisData object
    const { contract_type: contractType, suggested_review_points: reviewPoints, core_purposes: corePurposes } = preAnalysisData;

    try {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found.' });
        }

        const { value: plainText } = await mammoth.extractRawText({ path: contract.storage_path });

        const analyzePrompt = `
        你是一名资深法务专家，你的任务是根据用户提供的审查框架，对一份合同进行深度、定制化的审查。
        
        **审查框架:**
        **合同类型:** ${contractType}
        **我的立场:** ${userPerspective}
        **我重点关注的审查点:**
            - ${reviewPoints.join('\n            - ')}
        **我希望达成的核心审查目的:**
            - ${corePurposes.join('\n            - ')}
            
        **审查要求:**
        请严格围绕上述框架，对以下合同文本进行全面分析。你的分析报告需要清晰、专业，并直接回应我关注的每一个审查点和核心目的。请将你的分析结果，严格按照下面的JSON格式返回，不需要任何额外的解释或开场白。
        **特别指示：** "修改建议"是你本次分析的核心产出之一。请你主动、全面地审查合同全文，找出所有你认为可以改进的条款，并尽可能多地提供具体的修改建议。不要局限于用户选择的审查点。
        1. 仅输出一个纯JSON对象，禁止包含任何自然语言解释、标题或额外文
        2. 不要添加解释性文字、开场白或结束语
        3. 如果某项审查结果为空，请返回空数组
        4. 每个字段的描述必须完整且专业
        5. 如违反格式要求，必须重新生成
        6. 所有字段必须使用英文命名且保持如下大小写：dispute_points, missing_clauses, party_review, modification_suggestions
        7. 每个字段必须是数组类型（即使只有一项或空数组）

        **输出格式(JSON):**
        {
          "dispute_points": [
            {
              "title": "审查点标题",
              "description": "针对该审查点的详细分析、发现的风险、以及基于我方立场的具体建议。"
            }
          ],
          "missing_clauses": [
            {
              "title": "建议补充的条款标题",
              "description": "说明为什么需要补充这个条款，以及它如何帮助实现我的核心审查目的。"
            }
          ],
          "party_review": [
            {
              "title": "主体相关审查发现",
              "description": "关于合同主体的审查结论，例如名称是否准确、权利义务是否清晰等。"
            }
          ],
          "modification_suggestions": [
            {
              "title": "一个简短的总结，说明这个条款的问题。例如：'入职时间及逾期失效条款不明确'",
              "original_text": "合同中的原始文字片段。例如：'入职时间：您的入职时间是2021年07月01日前（以具体报到时间为准）；如无异议，请您于2021年3月12日之前确认签名。逾期，则自动失效。'",
              "suggested_text": "建议修改后的文字片段。例如：'入职时间：您的入职时间是2021年07月01日前，具体报到时间以公司通知为准。如无异议，请您于2021年3月12日之前确认签名。逾期未确认签名的，本录用通知书自动失效。'",
              "reason": "解释为什么这样修改，以及修改后的好处。例如：'明确入职时间和确认签名的截止日期，避免因日期不明确导致的纠纷。'"
            }
          ]
        }
        输出字段描述：
            dispute_points：审查点
            missing_clauses：补充条款
            party_review：主体检查
            modification_suggestions：修改建议
        **特别指令:**
        - 不要添加任何JSON格式之外的文字
        - 确保所有特殊字符正确转义
        - 数组元素尽可能多
        - 基于合同原文逐点分析，不添加未提及内容
        - 如无相关内容，返回空数组（例如："dispute_points": []）
        - modification_suggestions必须包含原文具体位置的行号或段落标识
        - 所有描述使用法律术语，禁止口语化表达

        **合同原文:**
        ---
        ${plainText}
        ---
        `;

        const aiProvider = process.env.AI_PROVIDER || 'siliconflow';

        let analysisResult;
        let httpData;
        if (aiProvider === 'siliconflow') {
            const chatCompletion = await siliconflow.chat.completions.create({
                model: process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V3",
                messages: [{ role: "user", content: analyzePrompt }],
                response_format: { type: "json_object" },
            });
            httpData = chatCompletion.choices[0].message.content;
        } else { // ollama
            const response = await fetch(process.env.OLLAMA_GENERATE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.OLLAMA_GENERATE_MODEL || "deepseek-r1:32b",
                    prompt: analyzePrompt,
                    stream: false
                })
            });
            const result = await response.json();
            httpData = result.response;
        }
        console.log(httpData)
        let cleanJson = httpData.replace(/<think>[\s\S]*<\/think>/, "").trim();
        const jsonMatch = cleanJson.match(/```json\n([\s\S]*?)\n```/);
        if (!jsonMatch) {
            cleanJson = cleanJson.replace('```json', "").trim();
            cleanJson = cleanJson.replace('```', "").trim();
        }
        analysisResult = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(cleanJson);
        // Before sending the response, update the database with the full context
        await db('contracts').where({ id: contractId }).update({
            status: 'Reviewed',
            analysis_result: JSON.stringify(analysisResult),
            pre_analysis_data: JSON.stringify(preAnalysisData), // Save the entire pre-analysis object
            perspective: userPerspective, // Save the perspective used for this analysis
        });

        res.json(analysisResult);

    } catch (error) {
        console.error('Error during AI analysis:', error.message);
        if (error.response) {
            console.error('AI Provider Response:', error.response.data);
        }
        res.status(500).json({ error: 'AI分析过程中发生未知错误。' });
    }
});

// GET /api/contracts/:id
// Fetches full details for a single contract, designed to hydrate the review page
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.header('X-User-ID'); // 从请求头中获取 userId

    if (!userId) {
        return res.status(401).json({ error: 'User ID is required for access.' });
    }

    try {
        // 在查询时，同时验证合同ID和用户ID
        const contractRecord = await db('contracts').where({ id, user_id: userId }).first();
        if (!contractRecord) {
            return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });
        }

        // The pre-analysis data and analysis results are stored as JSON strings
        const preAnalysisData = contractRecord.pre_analysis_data ? JSON.parse(contractRecord.pre_analysis_data) : {};
        const reviewData = contractRecord.analysis_result ? JSON.parse(contractRecord.analysis_result) : {};

        // Use the specific URL for Docker containers
        const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/uploads/${path.basename(contractRecord.storage_path)}`;
        const callbackUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;

        console.log(`[DEBUG] Re-generating file URL for history view: ${fileUrl}`);

        const payloadObject = {
            document: {
                fileType: 'docx',
                key: contractRecord.document_key,
                title: contractRecord.original_filename,
                url: fileUrl,
            },
            documentType: 'word',
            editorConfig: {
                callbackUrl: callbackUrl,
                mode: 'edit',
                user: { id: `user-${contractRecord.user_id}`, name: 'Reviewer' },
                 customization: { forcesave: true },
            },
        };

        const token = jwt.sign(payloadObject, ONLYOFFICE_JWT_SECRET);
        const editorConfigWithToken = { ...payloadObject, token };

        res.json({
            contract: {
                id: contractRecord.id,
                original_filename: contractRecord.original_filename,
                editorConfig: editorConfigWithToken,
            },
            preAnalysisData: preAnalysisData,
            reviewData: reviewData,
            perspective: contractRecord.perspective,
            // We need to construct these based on the saved pre-analysis data
            // This part might need adjustment if the saved preAnalysisData doesn't contain all required fields.
            selectedReviewPoints: preAnalysisData.reviewPoints || [],
            customPurposes: preAnalysisData.core_purposes ? preAnalysisData.core_purposes.map(p => ({ value: p })) : [],
        });

    } catch (error) {
        console.error(`[ERROR] Failed to fetch contract details for id ${id}:`, error);
        res.status(500).json({ error: 'Server error while fetching contract details.' });
    }
});

// DELETE /api/contracts/:id
// Deletes a specific contract record and its associated file.
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // First, find the contract to get its file path
        const contract = await db('contracts').where({ id }).first();

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found, cannot delete.' });
        }

        // Delete the file from the filesystem
        if (contract.storage_path) {
            try {
                await fs.promises.unlink(contract.storage_path);
                console.log(`[INFO] Successfully deleted file: ${contract.storage_path}`);
            } catch (fileError) {
                // If the file doesn't exist, we can still proceed to delete the DB record.
                console.error(`[WARNING] Could not delete file ${contract.storage_path}. It may have been already deleted. Error: ${fileError.message}`);
            }
        }

        // Then, delete the record from the database
        await db('contracts').where({ id }).del();

        console.log(`[INFO] Successfully deleted contract record with ID: ${id}`);
        res.status(200).json({ message: 'Contract deleted successfully.' });

    } catch (error) {
        console.error(`[ERROR] Failed to delete contract with ID ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete contract.' });
    }
});

// New endpoint for pre-analysis
router.post('/pre-analyze', async (req, res) => {
    const { contractId } = req.body;
    if (!contractId) {
        return res.status(400).json({ error: 'Contract ID is required.' });
    }

    try {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found.' });
        }

        const { value: plainText } = await mammoth.extractRawText({ path: contract.storage_path });

        const preAnalyzePrompt = `
        你是一个专业的法务助理AI。请快速阅读以下合同文本，并严格按照下面的JSON格式返回你的分析结果，不要有任何多余的解释。
        {
          "contract_type": "...",
          "potential_parties": ["...", "..."],
          "suggested_review_points": ["...", "..."],
          "suggested_core_purposes": ["...", "..."]
        }

        "contract_type": 识别合同的核心类型，例如 "劳动合同", "房屋租赁合同", "软件开发合同"。
        "potential_parties": 列出合同中可能的当事方角色，例如 "甲方", "乙方", "用人单位", "劳动者", "出租方", "承租方"。
        "suggested_review_points": 根据合同类型，推荐10-15个最关键、最常见的审查要点。
        "suggested_core_purposes": 根据合同类型和内容，设身处地地推荐10-15个用户最可能希望达成的核心审查目的。

        合同原文如下：
        ---
        ${plainText}
        ---
        `;
        const aiProvider = process.env.AI_PROVIDER || 'siliconflow';
        let httpData;
        if (aiProvider === 'siliconflow') {
            const chatCompletion = await siliconflow.chat.completions.create({
                model: process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V3",
                messages: [{ role: "user", content: preAnalyzePrompt }],
                response_format: { type: "json_object" },
            });
            httpData = chatCompletion.choices[0].message.content;
        } else { // ollama
            const response = await fetch(process.env.OLLAMA_GENERATE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.OLLAMA_GENERATE_MODEL || "deepseek-r1:32b",
                    prompt: preAnalyzePrompt,
                    stream: false
                })
            });
            const result = await response.json();
            httpData = result.response;
        }
        console.log(httpData)
        let cleanJson = httpData.replace(/<think>[\s\S]*<\/think>/, "").trim();
        const jsonMatch = cleanJson.match(/```json\n([\s\S]*?)\n```/);
        if (!jsonMatch) {
            cleanJson = cleanJson.replace('```json', "").trim();
            cleanJson = cleanJson.replace('```', "").trim();
        }
        let analysisResult = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(cleanJson);
        res.json(analysisResult);

    } catch (error) {
        console.error(`[ERROR] Pre-analysis failed for contract ${contractId}:`, error);
        res.status(500).json({ error: '预分析失败，请稍后重试。' });
    }
});

// GET /api/contracts/history (Example, can be expanded)
router.get('/', async (req, res) => {
    const userId = req.header('X-User-ID'); // 从请求头中获取 userId

    if (!userId) {
        return res.status(401).json({ error: 'User ID is required to fetch history.' });
    }

    try {
        const contracts = await db('contracts')
            .where({ user_id: userId }) // 只选择属于该用户的合同
            .select('id', 'original_filename', 'created_at', 'status')
            .orderBy('created_at', 'desc');
        res.json(contracts);
    } catch (error) {
        console.error(`[ERROR] Failed to fetch contract history for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to fetch contract history.' });
    }
});

module.exports = router;

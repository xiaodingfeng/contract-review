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
        const [newContract] = await db('contracts')
            .insert({
                user_id: userId,
                original_filename: req.file.originalname,
                storage_path: req.file.path,
                document_key: documentKey,
                status: 'Uploaded'
            })
            .returning(['id', 'original_filename', 'document_key']);

        if (!newContract) {
            return res.status(500).json({ error: 'Failed to insert contract into database.' });
        }

        // Decode filename correctly for use in editor config
        const originalFilenameDecoded = iconv.decode(Buffer.from(req.file.originalname, 'binary'), 'utf-8');
        
        // Use the specific URL for Docker containers
        const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/uploads/${req.file.filename}`;
        const callbackUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;
        
        // Log the generated URL for diagnostics
        console.log(`[DEBUG] Generated file URL for OnlyOffice to download: ${fileUrl}`);

        // This is the entire configuration object that will be signed
        const payloadObject = {
            document: {
                fileType: 'docx',
                key: documentKey,
                title: originalFilenameDecoded, // Use decoded filename for a better user experience
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
    // We now expect a more detailed payload
    const { contractId, contractType, userPerspective, reviewPoints, corePurposes } = req.body;

    if (!contractId || !contractType || !userPerspective || !reviewPoints || !corePurposes) {
        return res.status(400).json({ error: 'Incomplete analysis request. All parameters are required.' });
    }

    try {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found.' });
        }

        const { value: plainText } = await mammoth.extractRawText({ path: contract.storage_path });

        const analyzePrompt = `
        你是一名资深法务专家，你的任务是根据用户提供的审查框架，对一份合同进行深度、定制化的审查。

        **审查框架:**
        1.  **合同类型:** ${contractType}
        2.  **我的立场:** ${userPerspective}
        3.  **我重点关注的审查点:**
            - ${reviewPoints.join('\n            - ')}
        4.  **我希望达成的核心审查目的:**
            - ${corePurposes.join('\n            - ')}

        **你的任务:**
        请严格围绕上述框架，对以下合同文本进行全面分析。你的分析报告需要清晰、专业，并直接回应我关注的每一个审查点和核心目的。请将你的分析结果，严格按照下面的JSON格式返回，不需要任何额外的解释或开场白。

        **输出格式 (JSON):**
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
          ]
        }
        
        **合同原文:**
        ---
        ${plainText}
        ---
        `;

        const aiProvider = process.env.AI_PROVIDER || 'siliconflow';

        let chatCompletion;
        let analysisResult;

        if (aiProvider === 'siliconflow') {
            chatCompletion = await siliconflow.chat.completions.create({
                model: "deepseek-ai/DeepSeek-V3",
                messages: [{ role: "user", content: analyzePrompt }],
                response_format: { type: "json_object" },
            });
            analysisResult = JSON.parse(chatCompletion.choices[0].message.content);
        } else { // ollama
            const response = await ollama.chat({
                model: "deepseek-v2",
                messages: [{ role: "user", content: analyzePrompt }],
                format: "json"
            });
            analysisResult = JSON.parse(response.message.content);
        }

        // Save analysis result to the database
        await db('contracts')
            .where({ id: contractId })
            .update({
                analysis_result: JSON.stringify(analysisResult),
                pre_analysis_data: JSON.stringify(req.body), // Save the entire setup payload
                perspective: userPerspective,
                status: 'Reviewed'
            });

        res.json(analysisResult);

    } catch (error) {
        console.error(`[ERROR] Analysis failed for contract ${contractId}:`, error);
        if (error.response) {
            console.error('AI Provider Response:', error.response.data);
        }
        res.status(500).json({ error: 'AI分析过程中发生未知错误。' });
    }
});

// GET /api/contracts/:id
// Gets all details for a specific contract to reconstruct the review state.
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[DIAGNOSTICS] Received request for contract details with ID: ${id} (Type: ${typeof id})`);
    try {
        const contract = await db('contracts').where({ id: parseInt(id, 10) }).first();
        console.log('[DIAGNOSTICS] Database query result for contract:', contract);

        if (!contract) {
            console.error(`[DIAGNOSTICS] Query for contract with ID ${id} returned nothing. Not found.`);
            return res.status(404).json({ error: 'Contract not found' });
        }

        // We need to reconstruct the state as it was on the review page.
        // This means we need the pre-analysis data, final analysis, perspective, etc.
        // For simplicity, we'll assume these are stored in the analysis_result JSON
        // or in separate fields. Here, we retrieve the main analysis result and perspective.
        // A more robust solution might store the pre-analysis data as well.

        const analysisResult = JSON.parse(contract.analysis_result || '{}');
        const perspective = contract.perspective;
        const documentKey = contract.document_key;
        const preAnalysisPayload = JSON.parse(contract.pre_analysis_data || '{}');

        // Decode filename from DB correctly
        const originalFilenameDecoded = iconv.decode(Buffer.from(contract.original_filename, 'binary'), 'utf-8');
        
        const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/uploads/${path.basename(contract.storage_path)}`;
        const callbackUrl = `http://${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;

        const payloadObject = {
            document: {
                fileType: "docx",
                key: documentKey,
                title: originalFilenameDecoded,
                url: fileUrl,
            },
            documentType: 'word',
            editorConfig: {
                callbackUrl: callbackUrl,
                lang: "zh-CN",
                mode: "edit",
                user: {
                    id: `user-${contract.user_id || 'unknown'}`,
                    name: "Reviewer"
                },
                customization: {
                    forcesave: true,
                },
            },
        };

        const token = jwt.sign(payloadObject, ONLYOFFICE_JWT_SECRET);
        const editorConfigWithToken = { ...payloadObject, token: token };

        const contractState = {
            contract: { id: contract.id, original_filename: originalFilenameDecoded, editorConfig: editorConfigWithToken },
            reviewData: analysisResult,
            perspective: perspective,
            preAnalysisData: { 
                contract_type: preAnalysisPayload.contractType || '未知', 
                potential_parties: [perspective, ...(preAnalysisPayload.potential_parties || [])].filter((v, i, a) => a.indexOf(v) === i),
                suggested_review_points: preAnalysisPayload.reviewPoints || [], 
                suggested_core_purposes: preAnalysisPayload.corePurposes || [] 
            },
            selectedReviewPoints: preAnalysisPayload.reviewPoints || [], 
            customPurposes: (preAnalysisPayload.corePurposes || []).map(p => ({value: p})),
        };

        res.json(contractState);

    } catch (error) {
        console.error(`[ERROR] Failed to get contract details for ${id}:`, error);
        res.status(500).json({ error: 'Failed to retrieve contract details.' });
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

        // Using SiliconFlow for this task as it's generally better at structured data extraction
        const chatCompletion = await siliconflow.chat.completions.create({
            model: "deepseek-ai/DeepSeek-V3",
            messages: [{
                role: "user",
                content: preAnalyzePrompt,
            }],
            response_format: { type: "json_object" },
        });

        const preAnalysisResult = JSON.parse(chatCompletion.choices[0].message.content);
        res.json(preAnalysisResult);

    } catch (error) {
        console.error(`[ERROR] Pre-analysis failed for contract ${contractId}:`, error);
        res.status(500).json({ error: '预分析失败，请稍后重试。' });
    }
});

// GET /api/contracts/history (Example, can be expanded)
router.get('/', async (req, res) => {
    try {
        const contracts = await db('contracts').select('id', 'original_filename', 'created_at').orderBy('created_at', 'desc');
        res.json(contracts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch contract history.' });
    }
});

module.exports = router; 
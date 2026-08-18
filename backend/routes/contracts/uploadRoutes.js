/**
 * @file routes/contracts/uploadRoutes.js
 * @brief 合同文件上传与 OnlyOffice 保存回调路由
 *
 * 核心职责：
 * - 处理合同文件上传（限 .docx/.pdf，最大 50MB）
 * - 接收 OnlyOffice 保存回调并更新源文件
 *
 * 关键实现：
 * - 使用 multer 进行磁盘存储与文件过滤
 * - 保存后计算条款 diff_summary 并通过 Socket.IO 推送 contract-modified 事件
 * - 上传时生成 OnlyOffice 编辑器配置返回前端
 *
 * 依赖关系：
 * - 上游：multer、database、services/contractAnalysis（fileExtraction、onlyoffice、knowledge）、services/incrementalReview
 * - 下游：被 routes/contracts/index.js 注册
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const iconv = require('iconv-lite');
const { v4: uuidv4 } = require('uuid');
const unidecode = require('unidecode');
const db = require('../../database');
const { ensureUploadUser } = require('../../services/contractAnalysis/knowledge');
const { buildOnlyOfficeConfig } = require('../../services/contractAnalysis/onlyoffice');
const { extractTextFromFile } = require('../../services/contractAnalysis/fileExtraction');
const { getIoInstance } = require('../../services/contractAnalysis/analysisJob');
const { diffClauses } = require('../../services/incrementalReview');

const ALLOWED_EXTENSIONS = ['.docx', '.pdf'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', '..', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        const sanitizedOriginalName = unidecode(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${uniqueSuffix}-${sanitizedOriginalName}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error(`UNSUPPORTED_FILE_TYPE:${ext}`));
        }
        cb(null, true);
    },
});

module.exports = function (router) {
    router.post('/upload', upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).send('No file uploaded.');
        const { userId, groupId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID is required for upload.' });

        try {
            const uploadResult = await db.transaction(async (trx) => {
                const safeUserId = await ensureUploadUser(trx, userId);
                const originalFilenameDecoded = iconv.decode(Buffer.from(req.file.originalname, 'binary'), 'utf-8');
                const documentKey = uuidv4();
                const [newContract] = await trx('contracts').insert({
                    user_id: safeUserId,
                    original_filename: originalFilenameDecoded,
                    storage_path: req.file.path,
                    document_key: documentKey,
                    group_id: groupId || null,
                    status: 'Uploaded',
                }).returning(['id', 'original_filename', 'document_key', 'storage_path', 'user_id']);

                const contractRecord = newContract || await trx('contracts').where({ document_key: documentKey }).first();
                const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '');
                // Build the editor configuration before the transaction commits. If the
                // ONLYOFFICE/JWT configuration is incomplete, the contract row is rolled
                // back instead of leaving an orphaned upload record.
                return {
                    contractRecord,
                    editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
                };
            });
            res.status(201).json({
                message: '文件已上传，编辑器配置已生成。',
                contractId: uploadResult.contractRecord.id,
                editorConfig: uploadResult.editorConfig,
            });
        } catch (error) {
            if (error.message === 'INVALID_USER_ID') {
                return res.status(400).json({ error: 'Invalid user ID for upload.' });
            }
            console.error('[ERROR] Error processing upload for OnlyOffice:', error);
            res.status(500).json({
                error: error.message?.includes('secretOrPrivateKey')
                    ? '在线文档服务配置不完整，请联系管理员检查 ONLYOFFICE JWT。'
                    : 'Server error during file upload.',
            });
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

                    // 3.1 增量审查:保存后计算 diff_summary 并推送 contract-modified 事件
                    try {
                        const newText = await extractTextFromFile(contract.storage_path);
                        const lastVersion = await db('contract_versions')
                            .where({ contract_id: contract.id })
                            .orderBy('version_no', 'desc')
                            .first();
                        const oldText = lastVersion?.plain_text || '';
                        const diffResult = diffClauses(oldText, newText);
                        const needsReviewCount = diffResult.filter((d) => d.needs_review).length;
                        const diffSummary = {
                            contract_id: contract.id,
                            modified: diffResult.filter((d) => d.change_type === 'modified').length,
                            added: diffResult.filter((d) => d.change_type === 'added').length,
                            deleted: diffResult.filter((d) => d.change_type === 'deleted').length,
                            total_changes: needsReviewCount,
                            saved_at: new Date().toISOString(),
                        };
                        const io = req.app?.get?.('io') || getIoInstance();
                        if (io && needsReviewCount > 0) {
                            io.to(`contract-${contract.id}`).emit('contract-modified', diffSummary);
                            console.log(`[OnlyOffice] contract-modified emitted for contract ${contract.id}: ${needsReviewCount} clauses need review`);
                        }
                    } catch (diffError) {
                        console.warn('[OnlyOffice] diff summary failed:', diffError.message);
                    }
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
};

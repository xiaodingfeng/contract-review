/**
 * @file routes/contracts/crudRoutes.js
 * @brief 合同基础 CRUD 路由（详情、删除、历史列表）
 *
 * 核心职责：
 * - 获取单个合同详情（含编辑器配置、预分析数据、审查数据）
 * - 删除合同及其本地存储文件
 * - 获取用户合同历史列表（合并普通合同与分组合同）
 *
 * 关键实现：
 * - 必须最后注册（包含 /:id 和 / 通配路由）
 * - 历史列表从 pre_analysis_data 和 analysis_result 解析元数据
 * - 删除时级联清理本地文件
 *
 * 依赖关系：
 * - 上游：database、services/contractAnalysis（auth、onlyoffice、reportRendering）
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const fs = require('fs');
const path = require('path');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { buildOnlyOfficeConfig } = require('../../services/contractAnalysis/onlyoffice');
const { parseJsonField } = require('../../services/contractAnalysis/reportRendering');

module.exports = function (router) {
    router.get('/:id', async (req, res) => {
        const { id } = req.params;
        const userId = req.header('X-User-ID');
        if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

        try {
            const contractRecord = await db('contracts').where({ id, user_id: userId }).first();
            if (!contractRecord) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });

            const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '') || 'docx';
            const preAnalysisData = contractRecord.pre_analysis_data ? JSON.parse(contractRecord.pre_analysis_data) : {};
            const reviewData = contractRecord.analysis_result
                ? JSON.parse(contractRecord.analysis_result)
                : parseJsonField(contractRecord.analysis_partial_result, {});
            res.json({
                contract: {
                    id: contractRecord.id,
                    original_filename: contractRecord.original_filename,
                    editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
                },
                preAnalysisData,
                reviewData,
                analysisStatus: contractRecord.analysis_status,
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
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        try {
            const contract = await findOwnedContract(id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found, cannot delete.' });
            if (contract.storage_path) await fs.promises.unlink(contract.storage_path).catch(() => {});
            await db('contracts').where({ id, user_id: userId }).del();
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
                .whereNull('group_id')
                .select('id', 'original_filename', 'created_at', 'status', 'perspective', 'pre_analysis_data', 'analysis_result')
                .orderBy('created_at', 'desc');
            const groups = await db('contract_groups')
                .where({ user_id: userId })
                .select('id', 'name', 'created_at', 'updated_at', 'status')
                .orderBy('created_at', 'desc');

            const extractMeta = (contract) => {
                let contractType = '';
                try {
                    const pre = typeof contract.pre_analysis_data === 'string'
                        ? JSON.parse(contract.pre_analysis_data) : contract.pre_analysis_data;
                    contractType = pre?.contract_type || '';
                } catch { /* ignore */ }
                let riskCount = 0;
                try {
                    const result = typeof contract.analysis_result === 'string'
                        ? JSON.parse(contract.analysis_result) : contract.analysis_result;
                    riskCount = Array.isArray(result?.dispute_points) ? result.dispute_points.length : 0;
                } catch { /* ignore */ }
                return {
                    contract_type: contractType,
                    perspective: contract.perspective || '',
                    risk_count: riskCount,
                };
            };

            const records = [
                ...contracts.map((contract) => ({
                    id: contract.id,
                    original_filename: contract.original_filename,
                    created_at: contract.created_at,
                    status: contract.status,
                    record_type: 'contract',
                    ...extractMeta(contract),
                })),
                ...groups.map((group) => ({
                    id: group.id,
                    original_filename: group.name,
                    created_at: group.created_at,
                    updated_at: group.updated_at,
                    status: group.status || 'Reviewed',
                    record_type: 'group',
                    contract_type: '',
                    perspective: '',
                    risk_count: 0,
                })),
            ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            res.json(records);
        } catch (error) {
            console.error(`[ERROR] Failed to fetch contract history for user ${userId}:`, error);
            res.status(500).json({ error: 'Failed to fetch contract history.' });
        }
    });
};

// Review.vue 显示辅助：标题/描述构建、公司/印章/数据源样式、法条时效性
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewHelpers(state) {
    const {
        reviewData, contract, firstText, joinLines, companyRiskLevel,
        docEditorComponent, currentLawRef, viewLawDialogVisible,
        selectedTemplateId, incrementalReviewLoading, contractModifiedNotice,
    } = state;

    const expandedCompanyCards = ref([]);

    // --- 标题/描述构建 ---
    const disputeTitle = (item, index) => firstText(item.title, item.type, item.original_clause, `风险点 ${index + 1}`);

    const disputeDescription = (item) => firstText(
        item.description,
        joinLines(
            item.original_clause && `原文：${item.original_clause}`,
            item.legal_reference && `法律依据：${item.legal_reference}`,
            item.dispute_rationale && `风险说明：${item.dispute_rationale}`,
        )
    );

    const missingClauseTitle = (item, index) => firstText(item.title, item.clause_type, `缺失条款 ${index + 1}`);

    const partyReviewTitle = (item, index) => firstText(item.title, item.review_point, `主体审查 ${index + 1}`);

    const partyReviewDescription = (item) => firstText(
        item.description,
        joinLines(
            item.party_A && `甲方：${item.party_A}`,
            item.party_B && `乙方：${item.party_B}`,
            item.status && `状态：${item.status}`,
            item.issue && `问题：${item.issue}`,
        )
    );

    const suggestionTitle = (item, index) => firstText(item.title, item.clause, `修改建议 ${index + 1}`);

    const suggestionOriginal = (item) => {
        const direct = firstText(
            item.original_text,
            item.original_clause,
            item.current_clause,
            item.contract_clause,
            item.before,
        );
        if (direct) return direct;
        const title = firstText(item.clause, item.title);
        const relatedRisk = (reviewData.dispute_points || []).find((risk) => {
            return firstText(risk.type, risk.title).includes(title) || title.includes(firstText(risk.type, risk.title));
        });
        return firstText(relatedRisk?.original_clause, title);
    };

    const suggestionText = (item) => firstText(
        item.suggested_text,
        item.modification,
        item.suggestion,
        item.proposed_clause,
        item.corrected_clause,
        item.after,
    );

    const isMissingClauseSuggestion = (item) => {
        const operation = String(item?.operation || item?.action || '').trim().toLowerCase();
        if (['append', 'insert', 'add'].includes(operation)) return true;
        if (item?.is_missing === true || item?.missing_clause === true) return true;

        const original = String(suggestionOriginal(item) || '').trim();
        return /^(?:合同(?:全文)?|本合同)?\s*(?:未|没有)(?:约定|提及|包含|明确|设置|规定|涉及)|^(?:无相关条款|缺少相关条款)/.test(original);
    };

    const suggestionCitations = (item) => {
        if (Array.isArray(item.citations) && item.citations.length) return item.citations;
        if (Array.isArray(item.basis) && item.basis.length) return item.basis;
        if (Array.isArray(item.legal_basis) && item.legal_basis.length) return item.legal_basis;
        return [];
    };

    const suggestionReason = (item) => firstText(
        item.reason,
        item.rationale,
        item.reasoning,
        item.risk_description,
        typeof item.basis === 'string' ? item.basis : '',
        typeof item.legal_basis === 'string' ? item.legal_basis : '',
        suggestionCitations(item).map((citation) => firstText(
            citation.content,
            citation.text,
            citation.title,
        )).filter(Boolean).join('；'),
    );

    // --- 公司风险画像辅助 ---
    const companyRiskLabel = (level) => ({
        red: '高风险', yellow: '中风险', green: '低风险',
    })[level] || '低风险';

    const companyRiskBadgeClass = (level) => ({
        red: 'bg-red-100 text-red-700 border-red-300',
        yellow: 'bg-amber-100 text-amber-700 border-amber-300',
        green: 'bg-green-100 text-green-700 border-green-300',
    })[level] || 'bg-green-100 text-green-700 border-green-300';

    const companyCardBorderClass = (level) => ({
        red: 'border-l-4 border-l-red-500',
        yellow: 'border-l-4 border-l-amber-500',
        green: '',
    })[level] || '';

    const toggleCompanyCard = (index) => {
        const i = expandedCompanyCards.value.indexOf(index);
        if (i >= 0) expandedCompanyCards.value.splice(i, 1);
        else expandedCompanyCards.value.push(index);
    };

    // --- 数据来源标识 ---
    const dataSourceLabel = (authenticity) => {
        const text = String(authenticity || '');
        if (/mock/i.test(text)) return '模拟数据';
        if (/web_search_fallback|fallback/i.test(text)) return '网页搜索回退';
        if (/tiyanji|qichacha|gsxt/i.test(text)) return '已核验';
        if (text) return '外部检索';
        return '';
    };

    const dataSourceClass = (authenticity) => {
        const text = String(authenticity || '');
        if (/mock/i.test(text)) return 'bg-gray-100 text-gray-500';
        if (/web_search_fallback|fallback/i.test(text)) return 'bg-gray-100 text-gray-500';
        if (/tiyanji|qichacha|gsxt/i.test(text)) return 'bg-blue-50 text-blue-600';
        if (text) return 'bg-gray-100 text-gray-500';
        return '';
    };

    // --- 法条时效性 ---
    const isLawOutdated = (item) => {
        if (!item) return false;
        if (item.hasUpdate === true) return true;
        const status = item.law_status;
        return !!status && status !== '现行';
    };

    // --- 印章分析 UI 辅助 ---
    const sealItemClass = (item) => {
        if (item?.source === 'vision') {
            if (item.ps_suspect) return 'bg-red-50 border-red-300 border-l-4 border-l-red-500';
            if (item.position_compliant) return 'bg-green-50 border-green-200 border-l-4 border-l-green-500';
            return 'bg-amber-50 border-amber-200 border-l-4 border-l-amber-500';
        }
        return 'bg-gray-50 border-gray-200';
    };

    const sealStatusClass = (item) => {
        if (item?.source === 'vision') {
            if (item.ps_suspect) return 'text-red-700';
            if (item.position_compliant) return 'text-green-700';
            return 'text-amber-700';
        }
        return item?.status === '正常' ? 'text-green-600' : 'text-orange-600';
    };

    // --- 增量审查时间格式化 ---
    const formatIncrementalTime = (iso) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch {
            return iso;
        }
    };

    // --- 硬性违规采纳 ---
    const adoptHardViolation = (violation) => {
        if (!violation || !violation.fix_template) return;
        reviewData.modification_suggestions.push({
            title: violation.description,
            original_text: violation.clause_excerpt || '',
            suggested_text: violation.fix_template,
            reason: violation.legal_basis || '',
            plain_language: violation.fix_template,
            anchor_hint: '',
        });
        ElMessage.success('已将硬性违规修改建议加入修改列表。');
    };

    // --- 证据链联动：定位合同原文 ---
    const handleLocateContract = (anchor) => {
        if (!anchor?.text) return;
        const editor = docEditorComponent.value?.editorInstance || docEditorComponent.value;
        try {
            const inst = editor?.editorInstance ? editor.editorInstance() : (typeof editor === 'function' ? editor() : editor);
            if (inst && typeof inst.searchAndReplace === 'function') {
                inst.searchAndReplace({ searchText: anchor.text, replaceText: anchor.text, lookAt: 'all' });
                ElMessage.success('已定位到合同原文');
                return;
            }
            if (inst && typeof inst.search === 'function') {
                inst.search(anchor.text);
                ElMessage.success('已定位到合同原文');
                return;
            }
        } catch (e) {
            console.warn('OnlyOffice search failed:', e);
        }
        ElMessage.info('当前 OnlyOffice 版本未开放搜索接口,请手动在左侧编辑器中查找:「' + anchor.text.slice(0, 40) + '...」');
    };

    // --- 证据链联动：查看法条弹窗 ---
    const handleViewLaw = (ref) => {
        currentLawRef.value = ref;
        viewLawDialogVisible.value = true;
    };

    // --- 增量审查 ---
    const runIncrementalReview = async () => {
        if (!contract.id || incrementalReviewLoading.value) return;
        incrementalReviewLoading.value = true;
        try {
            const payload = {};
            if (selectedTemplateId.value) payload.templateId = selectedTemplateId.value;
            const response = await api.reviewIncremental(contract.id, payload);
            const result = response.data || {};
            if (result.message && !result.diff_clauses?.length) {
                ElMessage.info(result.message);
                contractModifiedNotice.value = null;
                return;
            }
            const newRisks = Array.isArray(result.new_risks) ? result.new_risks : [];
            const resolvedRisks = Array.isArray(result.resolved_risks) ? result.resolved_risks : [];
            reviewData.dispute_points = reviewData.dispute_points.map((dp) => (
                resolvedRisks.includes(dp.title) ? { ...dp, resolved: true } : dp
            ));
            const enrichedNewRisks = newRisks.map((r) => ({ ...r, isNewIncremental: true }));
            reviewData.dispute_points = [...enrichedNewRisks, ...reviewData.dispute_points];
            const reviewRecord = {
                reviewed_at: result.reviewed_at,
                diff_summary: {
                    modified: result.diff_clauses?.filter((d) => d.change_type === 'modified').length || 0,
                    added: result.diff_clauses?.filter((d) => d.change_type === 'added').length || 0,
                    deleted: result.diff_clauses?.filter((d) => d.change_type === 'deleted').length || 0,
                },
                new_risks: newRisks,
                resolved_risks: resolvedRisks,
            };
            if (!reviewData.incremental_reviews) reviewData.incremental_reviews = [];
            reviewData.incremental_reviews.push(reviewRecord);
            contractModifiedNotice.value = null;
            ElMessage.success(`增量审查完成:新增风险 ${newRisks.length} 项,已解决 ${resolvedRisks.length} 项`);
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '增量审查失败,请稍后重试');
        } finally {
            incrementalReviewLoading.value = false;
        }
    };

    // --- 谈判推演 ---
    const toggleNegotiation = async (item) => {
        if (item._negotiation) {
            item._showNegotiation = !item._showNegotiation;
            return;
        }
        if (item._negotiationLoading) return;
        item._showNegotiation = true;
        item._negotiationLoading = true;
        item._negotiationError = '';
        try {
            const response = await api.simulateNegotiation(contract.id, {
                suggestionIds: item.id ? [item.id] : [],
                suggestion: {
                    id: item.id || '',
                    title: suggestionTitle(item, 0),
                    original_text: suggestionOriginal(item),
                    suggested_text: suggestionText(item),
                    reason: suggestionReason(item),
                },
            });
            const data = response.data || {};
            const results = Array.isArray(data.results) ? data.results : [];
            const matched = results.length > 0 ? results[0] : null;
            if (matched?.simulation) {
                item._negotiation = {
                    counterparty_perspective: data.counterparty_perspective || matched.simulation.counterparty_perspective,
                    ...matched.simulation,
                };
            } else if (matched?.error) {
                item._negotiationError = matched.error;
            } else {
                item._negotiationError = '未返回推演结果';
            }
        } catch (error) {
            item._negotiationError = error.response?.data?.error || error.message || '请求失败';
        } finally {
            item._negotiationLoading = false;
        }
    };

    const adoptFallbackOption = (item, opt) => {
        if (!opt?.text) return;
        if (!item.adopted && !item.adopted_original) {
            item.adopted_original = item.suggested_text || item.modification || '';
        }
        item.suggested_text = opt.text;
        if ('modification' in item) item.modification = opt.text;
        item.adopted = true;
        item._negotiation._adoptedFallback = true;
        ElMessage.success('已采纳折中方案,可在文档中应用');
    };

    return {
        expandedCompanyCards,
        disputeTitle, disputeDescription, missingClauseTitle,
        partyReviewTitle, partyReviewDescription,
        suggestionTitle, suggestionOriginal, suggestionText, suggestionReason, suggestionCitations,
        isMissingClauseSuggestion,
        companyRiskLabel, companyRiskBadgeClass, companyCardBorderClass, toggleCompanyCard,
        dataSourceLabel, dataSourceClass, isLawOutdated,
        sealItemClass, sealStatusClass, formatIncrementalTime,
        adoptHardViolation, handleLocateContract, handleViewLaw,
        runIncrementalReview, toggleNegotiation, adoptFallbackOption,
    };
}

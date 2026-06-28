<template>
  <div>
    <!-- 硬性合规检查 -->
    <div class="mb-4">
      <div v-if="hardViolations.length > 0" class="p-4 bg-red-50 rounded-md border-2 border-red-400">
        <div class="flex items-center justify-between mb-3">
          <p class="font-bold text-red-800 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            硬性合规检查：检出 {{ hardViolations.length }} 项违规
          </p>
        </div>
        <div class="space-y-3">
          <div v-for="(item, index) in hardViolations" :key="'hv-' + index" class="p-3 bg-white rounded border border-red-200">
            <div class="flex justify-between items-start gap-2">
              <p class="font-semibold text-text-dark">{{ item.description }}</p>
              <span :class="item.severity === 'high' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-amber-100 text-amber-700 border-amber-300'" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ item.severity === 'high' ? '高' : '中' }}</span>
            </div>
            <p class="mt-1 text-xs text-text-light">依据：{{ item.legal_basis }}</p>
            <p class="mt-1 text-sm">合同值：<span class="font-bold text-red-700">{{ item.contract_value }}</span> ／ 限值：<span class="font-bold text-green-700">{{ item.limit_value }}</span></p>
            <p class="mt-1 text-sm text-text-main">修改建议：{{ item.fix_template }}</p>
            <div class="mt-2 flex justify-end">
              <button @click="adoptHardViolation(item)" class="px-3 py-1 text-xs font-medium text-white bg-primary rounded hover:bg-primary-dark">一键采纳</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="p-3 bg-green-50 rounded-md border border-green-200 text-sm text-green-700 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
        硬性合规检查通过
      </div>
    </div>
    <!-- 风险仪表盘 -->
    <div v-if="riskDashboard.total > 0" class="mb-4 p-4 bg-white rounded-md border border-border-color">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-text-dark">整体风险等级</span>
          <span :class="riskDashboard.overallClass" class="px-3 py-1 text-sm font-bold rounded-full border">{{ riskDashboard.overallLabel }}</span>
        </div>
        <div class="flex items-center gap-4 text-xs">
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-red-500"></span><span class="text-text-main">高危 {{ riskDashboard.stats.high }}</span></div>
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-amber-500"></span><span class="text-text-main">中危 {{ riskDashboard.stats.medium }}</span></div>
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-blue-500"></span><span class="text-text-main">低危 {{ riskDashboard.stats.low }}</span></div>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
        <div class="p-2 bg-bg-subtle rounded"><p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.disputes }}</p><p class="text-xs text-text-light">风险点</p></div>
        <div class="p-2 bg-bg-subtle rounded"><p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.suggestions }}</p><p class="text-xs text-text-light">修改建议</p></div>
        <div class="p-2 bg-bg-subtle rounded"><p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.missing }}</p><p class="text-xs text-text-light">缺失条款</p></div>
        <div class="p-2 bg-bg-subtle rounded"><p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.breach }}</p><p class="text-xs text-text-light">违约场景</p></div>
        <div class="p-2 bg-bg-subtle rounded"><p class="text-lg font-bold text-text-dark">{{ riskDashboard.moduleCounts.party }}</p><p class="text-xs text-text-light">主体审查</p></div>
      </div>
    </div>
    <!-- Dispute Points -->
    <div>
      <div v-if="reviewData.truncated_clauses && reviewData.truncated_clauses.length > 0" class="mb-4 p-4 bg-yellow-50 border border-yellow-400 border-l-4 rounded-md">
        <p class="font-bold text-yellow-800 flex items-center mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          部分条款因过长未完整审查，建议人工复核
        </p>
        <ul class="text-sm text-yellow-800 space-y-1">
          <li v-for="(tc, idx) in reviewData.truncated_clauses" :key="'tc-' + idx">
            <span class="font-medium">{{ tc.clause_id }}</span>
            <span v-if="tc.char_count" class="text-yellow-700 ml-1">（{{ tc.char_count }} 字）</span>
            <span class="text-yellow-700 ml-1">— {{ tc.reason }}</span>
          </li>
        </ul>
      </div>
      <div v-if="reviewData.dispute_points && reviewData.dispute_points.length > 0">
        <div v-if="contractModifiedNotice" class="mb-3 p-3 bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-md flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm text-red-800">
            <span class="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            <span class="font-semibold">变更待审:</span>
            <span>检测到合同修订 {{ contractModifiedNotice.total_changes }} 处变更(修改 {{ contractModifiedNotice.modified }} / 新增 {{ contractModifiedNotice.added }} / 删除 {{ contractModifiedNotice.deleted }}),建议执行增量审查</span>
          </div>
          <button @click="runIncrementalReview" :disabled="incrementalReviewLoading" class="px-3 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-50 whitespace-nowrap">
            {{ incrementalReviewLoading ? '审查中...' : '执行增量审查' }}
          </button>
        </div>
        <div v-if="incrementalReviews.length > 0" class="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p class="text-sm font-semibold text-blue-800 mb-2">增量审查记录({{ incrementalReviews.length }} 次)</p>
          <div v-for="(review, idx) in incrementalReviews" :key="'inc-' + idx" class="text-xs text-blue-700 mb-1 last:mb-0">
            <span class="font-medium">{{ formatIncrementalTime(review.reviewed_at) }}</span>
            <span class="ml-2">变更:修{{ review.diff_summary?.modified || 0 }} / 增{{ review.diff_summary?.added || 0 }} / 删{{ review.diff_summary?.deleted || 0 }}</span>
            <span v-if="review.new_risks?.length" class="ml-2 text-red-700">新增风险 {{ review.new_risks.length }} 项</span>
            <span v-if="review.resolved_risks?.length" class="ml-2 text-green-700">已解决 {{ review.resolved_risks.length }} 项</span>
          </div>
        </div>
        <div class="mb-3 flex items-center gap-2 flex-wrap">
          <span class="text-xs text-text-light">风险等级筛选：</span>
          <button @click="severityFilter = 'all'" :class="severityFilter === 'all' ? 'bg-primary text-white' : 'bg-white text-text-main border border-border-color'" class="px-2 py-0.5 text-xs rounded">全部 ({{ reviewData.dispute_points.length }})</button>
          <button v-if="disputeSeverityStats.high" @click="severityFilter = 'high'" :class="severityFilter === 'high' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 border border-red-300'" class="px-2 py-0.5 text-xs rounded">高 ({{ disputeSeverityStats.high }})</button>
          <button v-if="disputeSeverityStats.medium" @click="severityFilter = 'medium'" :class="severityFilter === 'medium' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'" class="px-2 py-0.5 text-xs rounded">中 ({{ disputeSeverityStats.medium }})</button>
          <button v-if="disputeSeverityStats.low" @click="severityFilter = 'low'" :class="severityFilter === 'low' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-700 border border-blue-300'" class="px-2 py-0.5 text-xs rounded">低 ({{ disputeSeverityStats.low }})</button>
          <span class="text-xs text-text-light ml-2">已按严重程度从高到低排序</span>
        </div>
        <div class="space-y-4">
          <div v-for="(item, index) in filteredAndSortedDisputePoints" :key="'dp-' + index" :class="['p-4 bg-bg-subtle rounded-md border border-border-color', item.resolved ? 'opacity-50 border-gray-300' : (normalizeSeverity(item.severity) === 'high' ? 'border-l-4 border-l-red-500' : normalizeSeverity(item.severity) === 'medium' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-blue-500')]">
            <div class="flex justify-between items-start gap-2">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-semibold text-text-dark" :class="item.resolved ? 'line-through text-gray-500' : ''">{{ disputeTitle(item, index) }}</p>
                <span v-if="item.clause_id" class="px-2 py-0.5 text-xs font-medium rounded border bg-blue-100 text-blue-700 border-blue-300 whitespace-nowrap">{{ item.clause_id }}</span>
                <el-tag v-if="item.resolved" type="info" size="small" effect="plain">已解决</el-tag>
                <el-tag v-if="item.isNewIncremental" type="danger" size="small">新增风险</el-tag>
              </div>
              <span v-if="item.severity && !item.resolved" :class="severityClass(item.severity)" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ severityLabel(item.severity) }}</span>
            </div>
            <p v-if="!showPlainLanguage" class="mt-2 text-sm text-text-main whitespace-pre-line">{{ disputeDescription(item) }}</p>
            <div v-else class="mt-2 p-3 bg-blue-50 text-blue-800 rounded-md border-l-4 border-blue-400">
              <p class="text-xs font-bold mb-1">📢 大白话解释：</p>
              <p class="text-sm">{{ item.plain_language || disputeDescription(item) }}</p>
            </div>
            <EvidenceCard v-if="!item.resolved && item.evidence" :evidence="item.evidence" :title="`证据链`" class="mt-3" @locate-contract="handleLocateContract" @view-law="handleViewLaw" />
          </div>
        </div>
      </div>
      <div v-else class="text-center text-text-light py-8">未发现风险点</div>
    </div>
    <!-- Breach Cost Analysis -->
    <div>
      <div v-if="reviewData.breach_cost_analysis && reviewData.breach_cost_analysis.length > 0" class="space-y-4">
        <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-xs text-yellow-800 flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span>以下违约成本由 AI 基于合同文本和法律依据估算，仅供参考，不构成法律意见或赔偿承诺。实际赔偿金额以法院判决或双方协商为准。</span>
        </div>
        <div v-for="(item, index) in reviewData.breach_cost_analysis" :key="'bc-' + index" class="p-4 bg-orange-50 rounded-md border border-orange-200">
          <p class="font-bold text-orange-900 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            违约场景：{{ item.scenario }}
          </p>
          <div class="mt-2 text-sm"><p class="text-orange-700 font-medium">依据：</p><p class="text-orange-800">{{ item.legal_basis }}</p></div>
          <div class="mt-3 p-2 bg-white rounded border border-orange-100"><p class="text-xs text-gray-500 font-medium">预计赔偿/成本（仅供参考）：</p><p class="text-md font-bold text-danger">{{ item.estimated_cost }}</p></div>
        </div>
      </div>
      <div v-else class="text-center text-text-light py-8">未发现明确的违约成本条款</div>
    </div>
    <!-- Seal Analysis -->
    <div>
      <div v-if="reviewData.seal_analysis && reviewData.seal_analysis.length > 0" class="space-y-4">
        <div v-for="(item, index) in reviewData.seal_analysis" :key="'seal-' + index" :class="['p-4 rounded-md border', sealItemClass(item)]">
          <div class="flex justify-between items-center mb-2">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-bold text-text-dark">{{ item.seal_name }}</p>
              <el-tag v-if="item.source === 'vision'" type="primary" size="small" effect="plain">视觉模型</el-tag>
              <el-tag v-else-if="item.source === 'ocr'" type="info" size="small" effect="plain">OCR</el-tag>
            </div>
            <el-tag :type="item.risk_level === '低' ? 'success' : item.risk_level === '中' ? 'warning' : 'danger'" size="small">风险：{{ item.risk_level }}</el-tag>
          </div>
          <div class="mt-2 text-sm flex items-center"><span class="text-gray-500 mr-2">状态:</span><span :class="sealStatusClass(item)" class="font-medium">{{ item.status }}</span></div>
          <div v-if="item.source === 'vision'" class="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div :class="['p-2 rounded border', item.ps_suspect ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700']"><p class="font-semibold">PS 疑似</p><p>{{ item.ps_suspect ? '是' : '否' }}</p></div>
            <div :class="['p-2 rounded border', item.position_compliant ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700']"><p class="font-semibold">位置合规</p><p>{{ item.position_compliant ? '是' : '否' }}</p></div>
            <div class="p-2 rounded border bg-blue-50 border-blue-200 text-blue-700"><p class="font-semibold">印章类型</p><p>{{ item.seal_type || '未知' }}</p></div>
          </div>
          <p class="mt-2 text-xs text-text-main leading-relaxed"><span class="text-gray-500">检测详情:</span><br/>{{ item.details }}</p>
        </div>
      </div>
      <div v-else class="text-center text-text-light py-8">未发现印章信息或正在分析中</div>
    </div>
    <!-- Standard Comparison -->
    <div>
      <div v-if="reviewData.standard_comparison && reviewData.standard_comparison.length > 0" class="space-y-3">
        <div v-for="(cmp, idx) in reviewData.standard_comparison" :key="'std-cmp-' + idx" class="p-4 bg-amber-50 rounded-md border border-amber-200 border-l-4 border-l-amber-500">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 text-xs font-semibold bg-amber-200 text-amber-900 rounded">{{ cmp.category_label || cmp.category }}</span>
              <p class="font-semibold text-text-dark text-sm">合同 {{ cmp.contract_clause_id || '' }} vs {{ cmp.matched_standard?.title || '行业标准' }}</p>
            </div>
            <span class="text-xs text-amber-700">相似度 {{ (cmp.matched_standard?.score || 0).toFixed(2) }}</span>
          </div>
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div><p class="text-gray-600 font-medium mb-1">合同条款:</p><p class="text-text-main bg-white p-2 rounded border border-amber-100 leading-relaxed">{{ cmp.contract_clause_text }}</p></div>
            <div><p class="text-gray-600 font-medium mb-1">标准条款{{ cmp.matched_standard?.industry ? '(' + cmp.matched_standard.industry + ')' : '' }}:</p><p class="text-text-main bg-white p-2 rounded border border-amber-100 leading-relaxed">{{ cmp.matched_standard?.clause_text }}</p></div>
          </div>
          <p class="mt-2 text-xs text-amber-800">{{ cmp.diff_description }}</p>
        </div>
      </div>
    </div>
    <!-- Missing Clauses -->
    <div>
      <div v-if="reviewData.missing_clauses && reviewData.missing_clauses.length > 0" class="space-y-4">
        <div v-for="(item, index) in reviewData.missing_clauses" :key="'mc-' + index" class="p-4 bg-bg-subtle rounded-md">
          <p class="font-semibold text-text-dark">{{ missingClauseTitle(item, index) }}</p>
          <p class="mt-1 text-sm text-text-main">{{ item.description }}</p>
        </div>
      </div>
      <div v-else class="text-center text-text-light py-8">未发现缺失条款</div>
    </div>
    <!-- Party Review -->
    <div>
      <div v-if="reviewData.party_review && reviewData.party_review.length > 0" class="space-y-4">
        <div v-for="(item, index) in reviewData.party_review" :key="'pr-' + index" class="p-4 bg-bg-subtle rounded-md">
          <p class="font-semibold text-text-dark">{{ partyReviewTitle(item, index) }}</p>
          <p class="mt-1 text-sm text-text-main whitespace-pre-line">{{ partyReviewDescription(item) }}</p>
        </div>
      </div>
      <div v-else class="text-center text-text-light py-8">主体信息无风险</div>
    </div>
    <!-- Company Review -->
    <div v-if="reviewData.company_review && reviewData.company_review.length > 0" class="mt-4 space-y-4">
      <div v-for="(item, index) in sortedCompanyReview" :key="'company-' + index" :class="['p-4 bg-white rounded-md border border-border-color', companyCardBorderClass(companyRiskLevel(item))]">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-semibold text-text-dark">{{ item.company_name || item.title || '主体审查' }}</p>
            <span :class="companyRiskBadgeClass(companyRiskLevel(item))" class="px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap">{{ companyRiskLabel(companyRiskLevel(item)) }}</span>
          </div>
          <span v-if="dataSourceLabel(item.authenticity)" :class="dataSourceClass(item.authenticity)" class="text-xs px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0">{{ dataSourceLabel(item.authenticity) }}</span>
        </div>
        <div class="mt-2">
          <p v-if="item.status" class="text-xs text-text-light">核验状态：{{ item.status }}</p>
          <p v-if="item.evidence_summary" class="mt-1 text-sm text-text-main whitespace-pre-line">{{ item.evidence_summary }}</p>
        </div>
        <div class="mt-3">
          <button v-if="(item.risk_items || []).length" @click="toggleCompanyCard(index)" class="text-xs text-primary hover:underline">
            {{ expandedCompanyCards.includes(index) ? '收起' : '展开' }}风险事项明细 ({{ (item.risk_items || []).length }})
          </button>
          <p v-else class="text-xs text-text-light">无风险事项</p>
          <div v-show="expandedCompanyCards.includes(index) && (item.risk_items || []).length" class="mt-2 overflow-x-auto">
            <table class="w-full text-xs border-collapse">
              <thead><tr class="bg-bg-subtle text-text-light"><th class="p-2 text-left font-medium border border-border-color">类型</th><th class="p-2 text-left font-medium border border-border-color">详情</th><th class="p-2 text-left font-medium border border-border-color">日期</th></tr></thead>
              <tbody>
                <tr v-for="(ri, riIndex) in (item.risk_items || [])" :key="'ri-' + index + '-' + riIndex">
                  <td class="p-2 text-text-main border border-border-color">{{ ri.type }}</td>
                  <td class="p-2 text-text-main border border-border-color">{{ ri.detail }}</td>
                  <td class="p-2 text-text-light whitespace-nowrap border border-border-color">{{ ri.date }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="item.suggestion" class="mt-3 pt-3 border-t border-gray-100 text-sm text-text-main"><span class="font-medium text-text-dark">建议：</span>{{ item.suggestion }}</p>
        <div v-if="item.sources && item.sources.length" class="mt-2 flex flex-col gap-1">
          <a v-for="source in item.sources" :key="source" :href="source" target="_blank" rel="noreferrer" class="text-xs text-primary hover:underline truncate">{{ source }}</a>
        </div>
        <p v-if="item.authenticity" class="mt-2 text-xs text-text-light">{{ item.authenticity }}</p>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';
import { ElTag } from 'element-plus';
import EvidenceCard from '../EvidenceCard.vue';

export default {
  name: 'ReviewSummaryTab',
  components: { ElTag, EvidenceCard },
  setup() {
    const review = inject('review');
    return {
      reviewData: review.reviewData,
      hardViolations: review.hardViolations,
      riskDashboard: review.riskDashboard,
      contractModifiedNotice: review.contractModifiedNotice,
      incrementalReviewLoading: review.incrementalReviewLoading,
      incrementalReviews: review.incrementalReviews,
      severityFilter: review.severityFilter,
      disputeSeverityStats: review.disputeSeverityStats,
      filteredAndSortedDisputePoints: review.filteredAndSortedDisputePoints,
      showPlainLanguage: review.showPlainLanguage,
      sortedCompanyReview: review.sortedCompanyReview,
      expandedCompanyCards: review.expandedCompanyCards,
      adoptHardViolation: review.adoptHardViolation,
      runIncrementalReview: review.runIncrementalReview,
      formatIncrementalTime: review.formatIncrementalTime,
      handleLocateContract: review.handleLocateContract,
      handleViewLaw: review.handleViewLaw,
      disputeTitle: review.disputeTitle,
      disputeDescription: review.disputeDescription,
      missingClauseTitle: review.missingClauseTitle,
      partyReviewTitle: review.partyReviewTitle,
      partyReviewDescription: review.partyReviewDescription,
      normalizeSeverity: review.normalizeSeverity,
      severityLabel: review.severityLabel,
      severityClass: review.severityClass,
      sealItemClass: review.sealItemClass,
      sealStatusClass: review.sealStatusClass,
      companyRiskLevel: review.companyRiskLevel,
      companyRiskLabel: review.companyRiskLabel,
      companyRiskBadgeClass: review.companyRiskBadgeClass,
      companyCardBorderClass: review.companyCardBorderClass,
      toggleCompanyCard: review.toggleCompanyCard,
      dataSourceLabel: review.dataSourceLabel,
      dataSourceClass: review.dataSourceClass,
    };
  },
};
</script>

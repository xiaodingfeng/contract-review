<template>
  <section class="zhongan-report">
    <header class="report-masthead">
      <div>
        <p class="report-kicker">ZHONG AN GROUP · CONTRACT REVIEW</p>
        <h2>众安集团合同审核报告</h2>
        <p class="report-subtitle">成本管控与法务合规联合审查</p>
      </div>
      <div class="policy-seal">仅限知识库依据</div>
    </header>

    <article class="report-module">
      <div class="module-index">01</div>
      <div class="module-body">
        <h3>合同核心信息摘取</h3>
        <p class="module-note">逐字保留合同中的成本及法务关键约定；未约定事项不作推断。</p>
        <div class="core-grid">
          <section class="core-column">
            <h4>成本业务维度</h4>
            <div v-if="costCore.length" class="entry-list">
              <div v-for="(item, index) in costCore" :key="`cost-${index}`" class="entry-row">
                <p class="entry-label">{{ item.dimension || '成本条款' }}</p>
                <p class="entry-value">{{ item.original_clause || item.extracted_value || '合同未约定' }}</p>
              </div>
            </div>
            <p v-else class="empty-state">尚未生成成本关键条款摘取结果。</p>
          </section>
          <section class="core-column">
            <h4>法务合规维度</h4>
            <div v-if="legalCore.length" class="entry-list">
              <div v-for="(item, index) in legalCore" :key="`legal-${index}`" class="entry-row">
                <p class="entry-label">{{ item.dimension || '法务条款' }}</p>
                <p class="entry-value">{{ item.original_clause || item.extracted_value || '合同未约定' }}</p>
              </div>
            </div>
            <p v-else class="empty-state">尚未生成法务关键条款摘取结果。</p>
          </section>
        </div>
      </div>
    </article>

    <article class="report-module">
      <div class="module-index">02</div>
      <div class="module-body">
        <h3>标准范本对标差异汇总</h3>
        <p class="module-note">没有匹配范本原文时保持空缺，不以通用经验替代内部范本。</p>
        <div v-if="templateDifferences.length" class="comparison-list">
          <section v-for="(item, index) in templateDifferences" :key="`template-${index}`" class="comparison-card">
            <div class="comparison-title">
              <span>{{ item.template_source || item.category_label || '内部标准范本' }}</span>
              <span>差异 {{ index + 1 }}</span>
            </div>
            <div class="comparison-grid">
              <div><p class="entry-label">范本原文</p><p>{{ item.template_clause || item.matched_standard?.clause_text || '当前知识库未返回范本原文' }}</p></div>
              <div><p class="entry-label">合同内容</p><p>{{ item.contract_clause || item.contract_clause_text || '合同未约定' }}</p></div>
            </div>
            <p class="comparison-impact"><strong>偏离点：</strong>{{ item.deviation || item.diff_description || '待人工对比' }}</p>
            <p class="comparison-impact"><strong>影响：</strong>{{ item.impact || '当前知识库未生成明确影响说明' }}</p>
          </section>
        </div>
        <p v-else class="empty-state">当前知识库未检索到可用于逐条对标的匹配范本。</p>
      </div>
    </article>

    <article class="report-module">
      <div class="module-index">03</div>
      <div class="module-body">
        <h3>合规要点缺失与法律问题识别</h3>
        <p class="module-note">问题严格区分为范本差异、合规瑕疵、计算错误和文本错误。</p>
        <div v-if="findings.length" class="finding-list">
          <section v-for="(item, index) in findings" :key="`finding-${index}`" class="finding-card">
            <div class="finding-heading">
              <span class="issue-type">{{ item.issue_type }}</span>
              <h4>{{ item.title || `待优化项 ${index + 1}` }}</h4>
            </div>
            <p v-if="item.original_clause" class="finding-clause">{{ item.original_clause }}</p>
            <p>{{ item.description || item.dispute_rationale || '需要结合知识库依据进一步核对。' }}</p>
            <p v-if="item.basis || item.legal_reference" class="finding-basis"><strong>依据：</strong>{{ formatBasis(item.basis || item.legal_reference) }}</p>
          </section>
        </div>
        <p v-else class="empty-state">尚未生成待优化项。</p>
      </div>
    </article>

    <article class="report-module">
      <div class="module-index">04</div>
      <div class="module-body">
        <h3>逐条结构化修正建议</h3>
        <p class="module-note">每项按“现状条款—依据—修改方案”组织，可直接进入会审或商务谈判。</p>
        <div v-if="corrections.length" class="correction-list">
          <section v-for="(item, index) in corrections" :key="`correction-${index}`" class="correction-card">
            <div class="correction-title">
              <span>{{ item.issue_type || '合规瑕疵' }}</span>
              <h4>{{ item.title || `修改建议 ${index + 1}` }}</h4>
            </div>
            <div class="correction-block">
              <p class="entry-label">现状条款</p>
              <p>{{ item.current_clause || item.original_text || '合同未约定' }}</p>
            </div>
            <div class="correction-block basis-block">
              <p class="entry-label">法律／范本依据</p>
              <p>{{ formatBasis(item.basis || item.reason) }}</p>
            </div>
            <div class="correction-block suggestion-block">
              <p class="entry-label">修正建议</p>
              <p>{{ item.suggested_text || '当前知识库依据不足，暂不生成替换条款。' }}</p>
            </div>
          </section>
        </div>
        <p v-else class="empty-state">尚未生成可替换的修正条款。</p>
      </div>
    </article>
  </section>
</template>

<script>
import { computed, inject } from 'vue';

const ensureArray = (value) => (Array.isArray(value) ? value : []);

export default {
  name: 'ZhongAnReviewReport',
  setup() {
    const review = inject('review');
    const reviewData = review.reviewData;

    const costCore = computed(() => ensureArray(reviewData.core_information?.cost_business));
    const legalCore = computed(() => ensureArray(reviewData.core_information?.legal_compliance));
    const templateDifferences = computed(() => {
      const explicit = ensureArray(reviewData.template_differences);
      return explicit.length ? explicit : ensureArray(reviewData.standard_comparison);
    });
    const findings = computed(() => {
      const compliance = ensureArray(reviewData.compliance_findings).length
        ? ensureArray(reviewData.compliance_findings)
        : ensureArray(reviewData.dispute_points);
      const missing = ensureArray(reviewData.missing_clauses).map((item) => ({
        ...item,
        issue_type: item.issue_type || '合规瑕疵',
        original_clause: item.original_clause || '合同未约定',
      }));
      const textErrors = ensureArray(reviewData.text_errors).map((item) => ({
        ...item,
        issue_type: '文本错误',
        title: item.title || '文本一致性问题',
      }));
      const calculationErrors = ensureArray(reviewData.calculation_errors).map((item) => ({
        ...item,
        issue_type: '计算错误',
        title: item.title || item.item || '附件表格计算问题',
        original_clause: item.original_clause || item.original_value || '',
      }));
      return [...compliance, ...missing, ...textErrors, ...calculationErrors].map((item) => ({
        ...item,
        issue_type: item.issue_type || '合规瑕疵',
      }));
    });
    const corrections = computed(() => ensureArray(reviewData.modification_suggestions));

    const formatBasis = (basis) => {
      if (Array.isArray(basis)) {
        const text = basis.map((item) => {
          if (typeof item === 'string') return item;
          return [item.title, item.clause, item.content].filter(Boolean).join(' ');
        }).filter(Boolean).join('\n');
        return text || '当前知识库未检索到直接依据';
      }
      if (basis && typeof basis === 'object') {
        return [basis.title, basis.clause, basis.content].filter(Boolean).join(' ') || '当前知识库未检索到直接依据';
      }
      return String(basis || '当前知识库未检索到直接依据');
    };

    return {
      costCore,
      legalCore,
      templateDifferences,
      findings,
      corrections,
      formatBasis,
    };
  },
};
</script>

<style scoped>
.zhongan-report {
  --ink: #173533;
  --muted: #6c7c7a;
  --line: #dde4df;
  --paper: #f7f7f2;
  --accent: #d2ae62;
  color: var(--ink);
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
}

.report-masthead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px;
  margin-bottom: 14px;
  color: #fff;
  background:
    linear-gradient(120deg, rgba(255,255,255,.04) 0 45%, transparent 45% 100%),
    linear-gradient(128deg, #006f6c 0%, #008c88 72%, #0a6f6c 100%);
  border-radius: 3px;
  box-shadow: 0 14px 30px rgba(0, 111, 108, .16);
}

.report-kicker { margin: 0 0 7px; font-family: Georgia, serif; font-size: 10px; letter-spacing: .18em; color: #e4c987; }
.report-masthead h2 { margin: 0; font-family: "Songti SC", "STSong", serif; font-size: 25px; letter-spacing: .08em; }
.report-subtitle { margin: 8px 0 0; font-size: 12px; color: #d7ece9; }
.policy-seal { padding: 7px 10px; border: 1px solid rgba(255,255,255,.38); border-radius: 4px; font-size: 11px; letter-spacing: .08em; white-space: nowrap; }

.report-module {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 14px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}

.module-index { font-family: Georgia, serif; font-size: 19px; color: var(--accent); padding-top: 2px; }
.module-body { min-width: 0; }
.module-body h3 { margin: 0; font-family: "Songti SC", "STSong", serif; font-size: 18px; letter-spacing: .035em; }
.module-note { margin: 6px 0 14px; color: var(--muted); font-size: 12px; line-height: 1.65; }
.core-grid, .comparison-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.core-column, .comparison-card, .finding-card, .correction-card { border: 1px solid var(--line); border-radius: 3px; background: #fff; }
.core-column { padding: 13px; }
.core-column h4 { margin: 0 0 10px; font-size: 13px; color: var(--accent); }
.entry-list > * + * { border-top: 1px dashed var(--line); }
.entry-row { padding: 9px 0; }
.entry-label { margin: 0 0 4px; color: var(--muted); font-size: 11px; font-weight: 600; }
.entry-value, .comparison-card p, .finding-card p, .correction-card p { margin: 0; font-size: 12px; line-height: 1.75; white-space: pre-line; word-break: break-word; }
.comparison-list, .finding-list, .correction-list { display: grid; gap: 10px; }
.comparison-card, .finding-card, .correction-card { overflow: hidden; }
.comparison-title, .correction-title { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; color: #fff; background: var(--ink); font-size: 11px; }
.comparison-grid > div { padding: 12px; }
.comparison-grid > div + div { border-left: 1px solid var(--line); background: var(--paper); }
.comparison-impact { padding: 0 12px 10px; }
.finding-card { padding: 12px; border-left: 3px solid var(--accent); }
.finding-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
.finding-heading h4, .correction-title h4 { margin: 0; font-size: 13px; }
.issue-type { flex: 0 0 auto; padding: 3px 7px; border: 1px solid #e4c987; color: #816529; background: #fbf6e9; border-radius: 2px; font-size: 10px; }
.finding-clause { margin-bottom: 8px !important; padding: 9px; background: var(--paper); border-left: 2px solid #adb6c2; }
.finding-basis { margin-top: 8px !important; color: #3d4a5b; }
.correction-title { justify-content: flex-start; align-items: center; }
.correction-title span { padding: 2px 6px; color: #f4e5bc; border: 1px solid rgba(255,255,255,.25); border-radius: 2px; }
.correction-block { padding: 12px; }
.correction-block + .correction-block { border-top: 1px solid var(--line); }
.basis-block { background: var(--paper); }
.suggestion-block { border-left: 3px solid #008c88; background: #edf7f5; }
.empty-state { margin: 0; padding: 18px; color: var(--muted); background: var(--paper); border: 1px dashed #c9d3ce; border-radius: 3px; font-size: 12px; text-align: center; }

@media (max-width: 900px) {
  .core-grid, .comparison-grid { grid-template-columns: 1fr; }
  .comparison-grid > div + div { border-left: 0; border-top: 1px solid var(--line); }
}
</style>

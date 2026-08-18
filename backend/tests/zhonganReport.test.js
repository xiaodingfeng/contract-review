const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const {
    buildZhongAnSections,
    renderReviewReportHtml,
    generateDocxBuffer,
} = require('../services/contractAnalysis/reportRendering');
const { normalizeAnalysisResult } = require('../services/contractAnalysis/analysisCore');

const contract = {
    original_filename: 'POC-test.docx',
    perspective: '甲方',
};

const reviewData = {
    core_information: {
        cost_business: [{ dimension: '付款节点', original_clause: '验收后付款。' }],
        legal_compliance: [{ dimension: '终止解除', original_clause: '严重违约可解除。' }],
    },
    template_differences: [{
        template_source: '内部范本',
        template_clause: '验收合格后付款。',
        contract_clause: '提交后付款。',
        deviation: '缺少验收条件',
        impact: '付款控制节点前移',
    }],
    compliance_findings: [{
        issue_type: '合规瑕疵',
        title: '付款条件不完整',
        original_clause: '提交后付款。',
        basis: '内部范本付款条款',
        description: '缺少验收前提。',
    }],
    modification_suggestions: [{
        issue_type: '范本差异',
        title: '补充验收前提',
        current_clause: '提交后付款。',
        basis: [{ title: '内部范本', clause: '付款条款', content: '验收合格后付款。' }],
        suggested_text: '验收合格后付款。',
    }],
};

test('report sections stay in the required four-module order', () => {
    const sections = buildZhongAnSections(reviewData);
    assert.deepEqual(sections.map((item) => item.title), [
        '一、合同核心信息摘取',
        '二、标准范本对标差异汇总',
        '三、合规要点缺失与法律问题识别',
        '四、逐条结构化修正建议',
    ]);
});

test('HTML and DOCX exports contain four modules without grading language', () => {
    const forbidden = /风险等级|高风险|中风险|低风险/;
    const html = renderReviewReportHtml(contract, reviewData);
    assert.match(html, /合同核心信息摘取/);
    assert.match(html, /逐条结构化修正建议/);
    assert.doesNotMatch(html, forbidden);

    const zip = new AdmZip(generateDocxBuffer(contract, reviewData));
    const documentXml = zip.readAsText('word/document.xml');
    assert.match(documentXml, /标准范本对标差异汇总/);
    assert.match(documentXml, /合规要点缺失与法律问题识别/);
    assert.doesNotMatch(documentXml, forbidden);
});

test('new three-part correction fields remain compatible with the editor', () => {
    const normalized = normalizeAnalysisResult({
        compliance_findings: reviewData.compliance_findings,
        modification_suggestions: reviewData.modification_suggestions,
    }, '提交后付款。');
    assert.equal(normalized.dispute_points.length, 1);
    assert.equal(normalized.modification_suggestions[0].original_text, '提交后付款。');
    assert.equal(normalized.modification_suggestions[0].current_clause, '提交后付款。');
});

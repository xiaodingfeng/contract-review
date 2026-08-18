const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ONLYOFFICE_URL = 'http://onlyoffice';
process.env.ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'test-onlyoffice-secret';

const { buildOnlyOfficeConfig, normalizeOnlyOfficeDownloadUrl } = require('../services/contractAnalysis/onlyoffice');
const {
    paragraphText,
    replaceTextInXmlRuns,
    replaceTextWithRevision,
    resolveParagraphMatch,
} = require('../services/contractAnalysis/docxEdit');
const {
    basisText,
    buildSimulationPrompt,
    cleanJsonResponse,
} = require('../services/negotiationSimulator');

test('ONLYOFFICE callback URLs are rewritten to the internal document server', () => {
    const normalized = normalizeOnlyOfficeDownloadUrl(
        'http://127.0.0.1:18081/onlyoffice/cache/files/output.docx?token=abc',
    );
    assert.equal(normalized, 'http://onlyoffice/cache/files/output.docx?token=abc');
});

test('ONLYOFFICE review mode enables visible tracked changes while edit mode stays direct', () => {
    const contract = {
        document_key: 'doc-key',
        original_filename: 'contract.docx',
        storage_path: '/app/uploads/contract.docx',
        user_id: 1,
    };
    const reviewConfig = buildOnlyOfficeConfig(contract, 'docx', { reviewMode: true });
    const editConfig = buildOnlyOfficeConfig(contract, 'docx');
    assert.equal(reviewConfig.editorConfig.customization.review.trackChanges, true);
    assert.equal(reviewConfig.editorConfig.customization.review.showReviewChanges, true);
    assert.equal(editConfig.editorConfig.customization.review.trackChanges, false);
});

test('multi-paragraph replacement avoids inheriting a heading paragraph style', () => {
    const xml = [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第六条 双方权利义务</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>6.1 甲方负责提供施工场地。</w:t></w:r></w:p>',
        '</w:body></w:document>',
    ].join('');

    const result = replaceTextInXmlRuns(
        xml,
        '第六条 双方权利义务6.1 甲方负责提供施工场地。',
        '6.5 双方应签订安全生产管理协议。',
    );

    assert.equal(result.replaced, true);
    const headingParagraph = result.xml.match(/<w:p><w:pPr>[\s\S]*?<\/w:p>/)[0];
    assert.equal(headingParagraph.includes('6.5 双方应签订安全生产管理协议。'), false);
    assert.match(result.xml, /<w:p><w:r><w:t>6\.5 双方应签订安全生产管理协议。<\/w:t><\/w:r><\/w:p>/);
});

test('clause-aware matching preserves numbering when AI original omits the clause prefix', () => {
    const xml = [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        '<w:p><w:pPr><w:spacing w:line="360"/></w:pPr><w:r><w:t>4.5 每次付款前，乙方应提交发票。若甲方尚未取得上游资金，甲方可顺延付款。</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>4.6 乙方提交结算资料；甲方审核期限不作固定限制。</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>7.2 工程具备竣工验收条件；甲方实际使用部分工程不视为验收合格。</w:t></w:r></w:p>',
        '</w:body></w:document>',
    ].join('');

    const cases = [
        ['4.5 若甲方尚未取得上游资金，甲方可顺延付款。', '4.5 甲方不得以上游资金未到账为由顺延付款。', '4.5'],
        ['4.6 甲方审核期限不作固定限制。', '4.6 甲方应在60日内完成审核。', '4.6'],
        ['7.2 甲方实际使用部分工程不视为验收合格。', '7.2 甲方擅自使用视为相应部分验收合格。', '7.2'],
    ];
    for (const [original, suggested, clauseNo] of cases) {
        const resolved = resolveParagraphMatch(xml, original, suggested);
        assert.equal(resolved.clauseNo, clauseNo);
        assert.equal(resolved.strategy, 'clause-body');
        assert.equal(resolved.replacement.startsWith(`${clauseNo} `), false);
    }
});

test('full clause replacement restores a missing 1.2 prefix and preserves paragraph formatting', () => {
    const xml = '<w:document><w:body><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>1.2 承包方式：包工、包料。</w:t></w:r></w:p></w:body></w:document>';
    const resolved = resolveParagraphMatch(xml, '1.2 承包方式：包工、包料。', '合同总价包含安全文明施工费。');
    assert.equal(resolved.replacement, '1.2 合同总价包含安全文明施工费。');
    const direct = replaceTextInXmlRuns(resolved.paragraph.xml, resolved.matchedText, resolved.replacement);
    assert.equal(paragraphText(direct.xml), '1.2 合同总价包含安全文明施工费。');
    assert.match(direct.xml, /<w:pPr><w:jc w:val="left"\/><\/w:pPr>/);
});

test('review mode emits real Word insert and delete revisions instead of direct text mutation', () => {
    const paragraph = '<w:p><w:pPr><w:spacing w:line="360"/></w:pPr><w:r><w:rPr><w:sz w:val="26"/></w:rPr><w:t>4.6 甲方审核期限不作固定限制。</w:t></w:r></w:p>';
    const revised = replaceTextWithRevision(paragraph, { start: 4, end: 17 }, '甲方应在60日内完成审核。', {
        revisionId: 10,
        author: 'AI审查',
        date: '2026-08-18T00:00:00.000Z',
    });
    assert.match(revised, /<w:del w:id="10"/);
    assert.match(revised, /<w:ins w:id="11"/);
    assert.match(revised, /<w:delText>/);
    assert.match(revised, /<w:pPr><w:spacing w:line="360"\/><\/w:pPr>/);
    assert.match(revised, /<w:rPr><w:sz w:val="26"\/><\/w:rPr>/);
});

test('negotiation prompt accepts current_clause and basis array schema', () => {
    const suggestion = {
        title: '调整质量保修金比例',
        current_clause: '剩余 5% 作为质量保证金。',
        suggested_text: '剩余 3% 作为质量保证金。',
        basis: [{ content: '质量保修金不得超过结算总额的3%' }],
    };
    assert.equal(basisText(suggestion), '质量保修金不得超过结算总额的3%');
    const prompt = buildSimulationPrompt(suggestion, {}, '乙方');
    assert.match(prompt, /剩余 5% 作为质量保证金/);
    assert.match(prompt, /质量保修金不得超过结算总额的3%/);
});

test('negotiation JSON parser tolerates a short textual prefix', () => {
    assert.deepEqual(cleanJsonResponse('结果如下：\n{"likely_objections":[],"fallback_options":[]}'), {
        likely_objections: [],
        fallback_options: [],
    });
});

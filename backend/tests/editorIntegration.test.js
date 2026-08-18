const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ONLYOFFICE_URL = 'http://onlyoffice';
process.env.ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'test-onlyoffice-secret';

const { normalizeOnlyOfficeDownloadUrl } = require('../services/contractAnalysis/onlyoffice');
const { replaceTextInXmlRuns } = require('../services/contractAnalysis/docxEdit');
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

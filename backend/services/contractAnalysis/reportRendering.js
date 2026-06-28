/**
 * @file services/contractAnalysis/reportRendering.js
 * @brief 将审查结果渲染为 HTML、DOCX、PDF 三种导出格式
 *
 * 核心职责：
 * - 生成结构化的 HTML 审查报告，含风险仪表盘与各审查维度
 * - 生成真正 OOXML 格式的 DOCX 报告（非 HTML 伪装）
 * - 通过 PDFKit 流式输出 PDF 报告，支持中文字体自动查找
 *
 * 关键实现：
 * - renderReviewReportHtml 内嵌样式与各 section 渲染逻辑
 * - generateDocxBuffer 直接拼装 word/document.xml 并打包为 zip
 * - streamReviewReportPdf 在多平台候选字体中加载 CJK 字体
 *
 * 依赖关系：
 * - 上游：fs、pdfkit、adm-zip
 * - 下游：被报告导出接口调用
 */
const fs = require('fs');
const PDFDocument = require('pdfkit');
const AdmZip = require('adm-zip');

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const parseJsonField = (value, fallback = {}) => {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const renderReviewReportHtml = (contract, reviewData = {}, format = 'html') => {
    const rows = (items = [], render) => items.map(render).join('\n') || '<p>暂无数据。</p>';
    const severityCount = (points = []) => {
        const counts = { 高: 0, 中: 0, 低: 0 };
        points.forEach((p) => {
            const sev = String(p.severity || '').trim();
            if (counts[sev] !== undefined) counts[sev] += 1;
            else counts['中'] += 1;
        });
        return counts;
    };
    const sev = severityCount(reviewData.dispute_points);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(contract.original_filename)} 审查报告</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 32px; color: #1f2937; }
    h1, h2 { color: #111827; }
    section { margin: 24px 0; }
    .item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 10px 0; }
    .before { color: #991b1b; background: #fef2f2; padding: 8px; }
    .after { color: #166534; background: #f0fdf4; padding: 8px; }
    .dashboard { display: flex; gap: 16px; margin: 16px 0; }
    .dashboard .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
    .dashboard .card .num { font-size: 28px; font-weight: bold; }
    .dashboard .card.high .num { color: #dc2626; }
    .dashboard .card.mid .num { color: #d97706; }
    .dashboard .card.low .num { color: #16a34a; }
    .severity-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .severity-high { background: #fee2e2; color: #991b1b; }
    .severity-mid { background: #fef3c7; color: #92400e; }
    .severity-low { background: #d1fae5; color: #065f46; }
    .disclaimer { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin: 16px 0; font-size: 13px; color: #92400e; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>合同审查报告</h1>
  <p><strong>文件名称：</strong> ${escapeHtml(contract.original_filename)}</p>
  <p><strong>导出时间：</strong> ${new Date().toLocaleString('zh-CN')}</p>
  ${reviewData.template?.name ? `<p><strong>审查模板：</strong> ${escapeHtml(reviewData.template.name)}</p>` : ''}
  ${contract.perspective ? `<p><strong>审查立场：</strong> ${escapeHtml(contract.perspective)}</p>` : ''}

  <div class="dashboard">
    <div class="card high"><div class="num">${sev.高}</div><div>高风险</div></div>
    <div class="card mid"><div class="num">${sev.中}</div><div>中风险</div></div>
    <div class="card low"><div class="num">${sev.低}</div><div>低风险</div></div>
    <div class="card"><div class="num">${(reviewData.dispute_points || []).length}</div><div>风险总数</div></div>
    <div class="card"><div class="num">${(reviewData.missing_clauses || []).length}</div><div>缺失条款</div></div>
  </div>

  <section>
    <h2>一、风险争议点</h2>
    ${rows(reviewData.dispute_points, (item) => {
      const s = String(item.severity || '中').trim();
      const cls = s === '高' ? 'severity-high' : (s === '低' ? 'severity-low' : 'severity-mid');
      const ev = item.evidence || {};
      const evLabel = { full: '证据完整', partial: '证据部分', weak: '证据较弱' }[ev.evidence_completeness] || '';
      const evTag = evLabel ? `<span class="severity-tag ${ev.evidence_completeness === 'full' ? 'severity-low' : ev.evidence_completeness === 'partial' ? 'severity-mid' : 'severity-high'}">${evLabel}</span>` : '';
      const resolvedTag = item.resolved ? '<span class="severity-tag" style="background:#e5e7eb;color:#374151;">已解决</span>' : '';
      return `<div class="item"><h3>${escapeHtml(item.title || item.type || '风险项')} <span class="severity-tag ${cls}">${escapeHtml(s)}</span> ${evTag} ${resolvedTag}</h3><p>${escapeHtml(item.dispute_rationale || item.description || '')}</p>${item.legal_reference ? `<p><strong>法律依据：</strong>${escapeHtml(item.legal_reference)}</p>` : ''}${item.plain_language ? `<p><strong>大白话：</strong>${escapeHtml(item.plain_language)}</p>` : ''}${ev.contract_anchor?.text ? `<p><strong>合同原文锚点：</strong>${escapeHtml(ev.contract_anchor.text.slice(0, 200))}</p>` : ''}</div>`;
    })}
  </section>

  <section>
    <h2>二、缺失条款</h2>
    ${rows(reviewData.missing_clauses, (item) => `<div class="item"><h3>${escapeHtml(item.title || item.clause_type || '缺失条款')}</h3><p>${escapeHtml(item.description || item.reason || '')}</p>${item.suggested_clause ? `<p class="after"><strong>建议补充：</strong>${escapeHtml(item.suggested_clause)}</p>` : ''}</div>`)}
  </section>

  <section>
    <h2>三、主体审查</h2>
    ${rows(reviewData.party_review, (item) => `<div class="item"><h3>${escapeHtml(item.title || item.review_point || '主体审查项')}</h3><p>${escapeHtml(item.description || '')}</p>${item.plain_language ? `<p><strong>大白话：</strong>${escapeHtml(item.plain_language)}</p>` : ''}</div>`)}
    ${rows(reviewData.company_review, (item) => `<div class="item"><h3>${escapeHtml(item.company_name || '公司主体')}</h3><p><strong>状态：</strong>${escapeHtml(item.status || '')}</p><p>${escapeHtml(item.evidence_summary || '')}</p><p><strong>真实性：</strong>${escapeHtml(item.authenticity || '')}</p></div>`)}
  </section>

  <section>
    <h2>四、违约成本分析</h2>
    <div class="disclaimer">⚠️ 以下违约成本由 AI 根据合同条款和法律依据估算，仅供参考，不构成法律意见。实际违约成本以法院判决或仲裁裁决为准。</div>
    ${rows(reviewData.breach_cost_analysis, (item) => `<div class="item"><h3>${escapeHtml(item.scenario || '违约场景')}</h3><p><strong>法律依据：</strong>${escapeHtml(item.legal_basis || '')}</p><p><strong>预计成本：</strong>${escapeHtml(item.estimated_cost || '')}</p></div>`)}
  </section>

  <section>
    <h2>五、印章与签章核验</h2>
    ${rows(reviewData.seal_analysis, (item) => {
      const sourceTag = item.source === 'vision' ? '<span class="severity-tag" style="background:#dbeafe;color:#1e40af;">视觉模型</span>' : (item.source === 'ocr' ? '<span class="severity-tag" style="background:#e5e7eb;color:#374151;">OCR</span>' : '');
      const visionFields = item.source === 'vision'
        ? `<p><strong>印章类型：</strong>${escapeHtml(item.seal_type || '未知')}</p><p><strong>PS 疑似：</strong>${item.ps_suspect ? '是' : '否'}</p><p><strong>位置合规：</strong>${item.position_compliant ? '是' : '否'}</p>`
        : '';
      return `<div class="item"><h3>${escapeHtml(item.seal_name || '签章检查')} ${sourceTag}</h3><p><strong>状态：</strong>${escapeHtml(item.status || '')}</p><p><strong>风险等级：</strong>${escapeHtml(item.risk_level || '')}</p>${visionFields}<p>${escapeHtml(item.details || '')}</p></div>`;
    })}
  </section>

  <section>
    <h2>六、法条与案例依据</h2>
    ${rows(reviewData.relevant_laws, (item) => {
      const lawStatus = item.law_status && item.law_status !== '现行'
        ? `<span class="severity-tag severity-high">${escapeHtml(item.law_status)}</span>`
        : '<span class="severity-tag severity-low">现行</span>';
      const outdatedNote = item.law_status && item.law_status !== '现行'
        ? `<p style="color:#991b1b;">⚠ 该条文法律状态为「${escapeHtml(item.law_status)}」,引用时请谨慎,建议查询最新版本。</p>`
        : '';
      return `<div class="item"><strong>${escapeHtml(item.law || item.title || '')}</strong> ${lawStatus}<p>${escapeHtml(item.clause || '')}</p><p>${escapeHtml(item.content || '')}</p>${outdatedNote}${item.source_url ? `<p><a href="${escapeHtml(item.source_url)}">来源链接</a></p>` : ''}</div>`;
    })}
  </section>

  <section>
    <h2>七、修改建议</h2>
    ${rows(reviewData.modification_suggestions, (item) => `<div class="item"><h3>${escapeHtml(item.title || item.clause || '修改建议')}</h3><p class="before">原文：${escapeHtml(item.original_text || item.original_clause || '')}</p><p class="after">建议修改为：${escapeHtml(item.suggested_text || item.modification || '')}</p><p>修改理由：${escapeHtml(item.reason || item.rationale || '')}</p></div>`)}
  </section>

  ${(reviewData.standard_comparison && reviewData.standard_comparison.length) ? `
  <section>
    <h2>八、行业标准对比</h2>
    ${reviewData.standard_comparison.map((cmp) => `<div class="item"><h3>${escapeHtml(cmp.category_label || cmp.category)} - 合同 ${escapeHtml(cmp.contract_clause_id || '')} vs ${escapeHtml(cmp.matched_standard?.title || '行业标准')}</h3><p><strong>合同条款：</strong>${escapeHtml(String(cmp.contract_clause_text || '').slice(0, 300))}</p><p><strong>标准条款${cmp.matched_standard?.industry ? '(' + escapeHtml(cmp.matched_standard.industry) + ')' : ''}：</strong>${escapeHtml(String(cmp.matched_standard?.clause_text || '').slice(0, 300))}</p><p><strong>相似度：</strong>${(cmp.matched_standard?.score || 0).toFixed(2)}</p><p>${escapeHtml(cmp.diff_description || '')}</p></div>`).join('\n')}
  </section>
  ` : ''}

  ${(reviewData.incremental_reviews && reviewData.incremental_reviews.length) ? `
  <section>
    <h2>九、增量审查记录</h2>
    ${reviewData.incremental_reviews.map((r) => `<div class="item"><h3>${new Date(r.reviewed_at).toLocaleString('zh-CN')}</h3><p><strong>变更统计：</strong>修改 ${r.diff_summary?.modified || 0} / 新增 ${r.diff_summary?.added || 0} / 删除 ${r.diff_summary?.deleted || 0}</p>${r.new_risks?.length ? `<p><strong>新增风险(${r.new_risks.length})：</strong>${r.new_risks.map((n) => escapeHtml(n.title || '')).join('、')}</p>` : ''}${r.resolved_risks?.length ? `<p><strong>已解决风险(${r.resolved_risks.length})：</strong>${r.resolved_risks.map((t) => escapeHtml(t)).join('、')}</p>` : ''}</div>`).join('\n')}
  </section>
  ` : ''}
</body>
</html>`;
};

// 生成真正的 DOCX 文件（OOXML 格式，非 HTML 伪装）
const generateDocxBuffer = (contract, reviewData = {}) => {
    const escapeXml = (text) => String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const paragraphs = [];
    const addHeading = (text, level = 1) => {
        const style = level === 1 ? 'Title' : 'Heading1';
        paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`);
    };
    const addParagraph = (text, bold = false) => {
        const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
        paragraphs.push(`<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`);
    };
    const addKeyValue = (key, value) => {
        paragraphs.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(key)}：</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(value || '')}</w:t></w:r></w:p>`);
    };

    addHeading('合同审查报告', 1);
    addKeyValue('文件名称', contract.original_filename);
    addKeyValue('导出时间', new Date().toLocaleString('zh-CN'));
    if (reviewData.template?.name) addKeyValue('审查模板', reviewData.template.name);
    if (contract.perspective) addKeyValue('审查立场', contract.perspective);

    const sections = [
        { title: '一、风险争议点', items: reviewData.dispute_points, render: (item) => {
            const evLabel = { full: '证据完整', partial: '证据部分', weak: '证据较弱' }[item.evidence?.evidence_completeness] || '';
            const resolvedTag = item.resolved ? '［已解决］' : '';
            return [
                `${item.title || item.type || '风险项'}（严重程度：${item.severity || '中'}）${resolvedTag}${evLabel ? `［${evLabel}］` : ''}`,
                item.dispute_rationale || item.description || '',
                item.legal_reference ? `法律依据：${item.legal_reference}` : '',
                item.evidence?.contract_anchor?.text ? `合同原文锚点：${String(item.evidence.contract_anchor.text).slice(0, 200)}` : '',
            ].filter(Boolean);
        } },
        { title: '二、缺失条款', items: reviewData.missing_clauses, render: (item) => [
            item.title || item.clause_type || '缺失条款',
            item.description || item.reason || '',
            item.suggested_clause ? `建议补充：${item.suggested_clause}` : '',
        ].filter(Boolean) },
        { title: '三、主体审查', items: [...(reviewData.party_review || []), ...(reviewData.company_review || [])], render: (item) => [
            item.title || item.review_point || item.company_name || '主体审查项',
            item.description || item.status || '',
            item.evidence_summary || '',
        ].filter(Boolean) },
        { title: '四、违约成本分析（仅供参考）', items: reviewData.breach_cost_analysis, render: (item) => [
            item.scenario || '违约场景',
            item.legal_basis ? `法律依据：${item.legal_basis}` : '',
            item.estimated_cost ? `预计成本：${item.estimated_cost}` : '',
        ].filter(Boolean) },
        { title: '五、印章与签章核验', items: reviewData.seal_analysis, render: (item) => [
            `${item.seal_name || '签章检查'}${item.source === 'vision' ? '（视觉模型）' : item.source === 'ocr' ? '（OCR）' : ''}`,
            item.status ? `状态：${item.status}` : '',
            item.risk_level ? `风险等级：${item.risk_level}` : '',
            item.source === 'vision' ? `印章类型：${item.seal_type || '未知'}；PS 疑似：${item.ps_suspect ? '是' : '否'}；位置合规：${item.position_compliant ? '是' : '否'}` : '',
            item.details || '',
        ].filter(Boolean) },
        { title: '六、法条与案例依据', items: reviewData.relevant_laws, render: (item) => {
            const lawStatus = item.law_status && item.law_status !== '现行' ? `［${item.law_status}］` : '［现行］';
            const outdatedNote = item.law_status && item.law_status !== '现行' ? `⚠ 该条文法律状态为「${item.law_status}」,引用时请谨慎,建议查询最新版本。` : '';
            return [
                `${item.law || item.title || ''} ${item.clause || ''} ${lawStatus}`,
                item.content || '',
                outdatedNote,
            ].filter(Boolean);
        } },
        { title: '七、修改建议', items: reviewData.modification_suggestions, render: (item) => [
            item.title || item.clause || '修改建议',
            `原文：${item.original_text || item.original_clause || ''}`,
            `建议修改为：${item.suggested_text || item.modification || ''}`,
            `修改理由：${item.reason || item.rationale || ''}`,
        ].filter(Boolean) },
    ];

    // 增量审查记录(若有)
    const incrementalReviews = reviewData.incremental_reviews || [];
    if (incrementalReviews.length) {
        sections.push({
            title: '九、增量审查记录',
            items: incrementalReviews,
            render: (r) => [
                `${new Date(r.reviewed_at).toLocaleString('zh-CN')}`,
                `变更统计：修改 ${r.diff_summary?.modified || 0} / 新增 ${r.diff_summary?.added || 0} / 删除 ${r.diff_summary?.deleted || 0}`,
                r.new_risks?.length ? `新增风险(${r.new_risks.length})：${r.new_risks.map((n) => n.title || '').join('、')}` : '',
                r.resolved_risks?.length ? `已解决风险(${r.resolved_risks.length})：${r.resolved_risks.join('、')}` : '',
            ].filter(Boolean),
        });
    }

    // 行业标准对比(若有)
    const standardComparisons = reviewData.standard_comparison || [];
    if (standardComparisons.length) {
        sections.push({
            title: '八、行业标准对比',
            items: standardComparisons,
            render: (cmp) => [
                `${cmp.category_label || cmp.category} - 合同 ${cmp.contract_clause_id || ''} vs ${cmp.matched_standard?.title || '行业标准'}`,
                `合同条款：${String(cmp.contract_clause_text || '').slice(0, 300)}`,
                `标准条款${cmp.matched_standard?.industry ? '(' + cmp.matched_standard.industry + ')' : ''}：${String(cmp.matched_standard?.clause_text || '').slice(0, 300)}`,
                `相似度：${(cmp.matched_standard?.score || 0).toFixed(2)}`,
                cmp.diff_description || '',
            ].filter(Boolean),
        });
    }

    for (const section of sections) {
        addHeading(section.title, 2);
        const items = section.items || [];
        if (!items.length) {
            addParagraph('暂无数据。');
            continue;
        }
        items.forEach((item, index) => {
            const lines = section.render(item);
            lines.forEach((line, lineIdx) => {
                addParagraph(`${lineIdx === 0 ? `${index + 1}. ` : ''}${line}`, lineIdx === 0);
            });
        });
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraphs.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`;

    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
    zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
    zip.addFile('word/_rels/document.xml.rels', Buffer.from(documentRelsXml, 'utf8'));
    zip.addFile('word/styles.xml', Buffer.from(stylesXml, 'utf8'));
    return zip.toBuffer();
};

const findPdfFont = () => {
    const candidates = [
        'C:\\Windows\\Fonts\\simhei.ttf',
        'C:\\Windows\\Fonts\\msyh.ttf',
        'C:\\Windows\\Fonts\\msyhbd.ttf',
        'C:\\Windows\\Fonts\\simsun.ttc',
        'C:\\Windows\\Fonts\\Deng.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
        '/usr/local/share/fonts/NotoSansCJK-Regular.ttc',
    ];
    const found = candidates.find((fontPath) => fs.existsSync(fontPath));
    if (!found) {
        console.warn('[PDF] No CJK font found. PDF export may show garbled text. Searched:', candidates.join(', '));
    }
    return found;
};

const addPdfSection = (doc, title, items = [], render) => {
    doc.moveDown().fontSize(15).text(title);
    if (!items.length) {
        doc.fontSize(10).text('暂无数据。');
        return;
    }
    items.forEach((item, index) => {
        doc.moveDown(0.5).fontSize(11).text(`${index + 1}. ${render(item)}`);
    });
};

const streamReviewReportPdf = (res, contract, reviewData = {}) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const fontPath = findPdfFont();
    if (fontPath) {
        try {
            doc.font(fontPath);
        } catch (error) {
            console.warn(`[PDF] Failed to load font ${fontPath}: ${error.message}`);
        }
    }

    doc.pipe(res);
    doc.fontSize(18).text('合同审查报告');
    doc.moveDown(0.5).fontSize(10).text(`文件名称：${contract.original_filename}`);
    doc.text(`导出时间：${new Date().toLocaleString('zh-CN')}`);
    if (contract.perspective) doc.text(`审查立场：${contract.perspective}`);

    // 风险摘要
    const points = reviewData.dispute_points || [];
    const highCount = points.filter((p) => String(p.severity).trim() === '高').length;
    const midCount = points.filter((p) => String(p.severity).trim() === '中').length;
    const lowCount = points.filter((p) => String(p.severity).trim() === '低').length;
    doc.moveDown().fontSize(12).text(`风险摘要：高危 ${highCount} 项，中危 ${midCount} 项，低危 ${lowCount} 项，缺失条款 ${(reviewData.missing_clauses || []).length} 项。`);

    addPdfSection(doc, '一、风险争议点', points, (item) => {
        const evLabel = { full: '证据完整', partial: '证据部分', weak: '证据较弱' }[item.evidence?.evidence_completeness] || '';
        const resolvedTag = item.resolved ? '［已解决］' : '';
        return [
            `${item.title || item.type || '风险项'}（${item.severity || '中'}）${resolvedTag}${evLabel ? `［${evLabel}］` : ''}`,
            item.dispute_rationale || item.description || '',
            item.legal_reference || '',
            item.evidence?.contract_anchor?.text ? `合同原文锚点：${String(item.evidence.contract_anchor.text).slice(0, 200)}` : '',
        ].filter(Boolean).join('\n');
    });
    addPdfSection(doc, '二、缺失条款', reviewData.missing_clauses || [], (item) => [
        item.title || item.clause_type || '缺失条款',
        item.description || item.reason || '',
        item.suggested_clause ? `建议补充：${item.suggested_clause}` : '',
    ].filter(Boolean).join('\n'));
    addPdfSection(doc, '三、主体审查', [...(reviewData.party_review || []), ...(reviewData.company_review || [])], (item) => [
        item.title || item.review_point || item.company_name || '主体审查项',
        item.description || item.status || '',
        item.evidence_summary || '',
    ].filter(Boolean).join('\n'));
    addPdfSection(doc, '四、违约成本分析（仅供参考）', reviewData.breach_cost_analysis || [], (item) => [
        item.scenario || '违约场景',
        item.legal_basis ? `法律依据：${item.legal_basis}` : '',
        item.estimated_cost ? `预计成本：${item.estimated_cost}` : '',
    ].filter(Boolean).join('\n'));
    addPdfSection(doc, '五、印章与签章核验', reviewData.seal_analysis || [], (item) => [
        `${item.seal_name || '签章检查'}${item.source === 'vision' ? '（视觉模型）' : item.source === 'ocr' ? '（OCR）' : ''}`,
        item.status ? `状态：${item.status}` : '',
        item.risk_level ? `风险等级：${item.risk_level}` : '',
        item.source === 'vision' ? `印章类型：${item.seal_type || '未知'}；PS 疑似：${item.ps_suspect ? '是' : '否'}；位置合规：${item.position_compliant ? '是' : '否'}` : '',
        item.details || '',
    ].filter(Boolean).join('\n'));
    addPdfSection(doc, '六、法条与案例依据', reviewData.relevant_laws || [], (item) => {
        const lawStatus = item.law_status && item.law_status !== '现行' ? `［${item.law_status}］` : '［现行］';
        const outdatedNote = item.law_status && item.law_status !== '现行' ? `⚠ 该条文法律状态为「${item.law_status}」,引用时请谨慎,建议查询最新版本。` : '';
        return [
            `${item.law || item.title || ''} ${item.clause || ''} ${lawStatus}`,
            item.content || '',
            outdatedNote,
        ].filter(Boolean).join('\n');
    });
    addPdfSection(doc, '七、修改建议', reviewData.modification_suggestions || [], (item) => [
        item.title || item.clause || '修改建议',
        `原文：${item.original_text || item.original_clause || ''}`,
        `建议修改为：${item.suggested_text || item.modification || ''}`,
        `修改理由：${item.reason || item.rationale || ''}`,
    ].filter(Boolean).join('\n'));
    // 行业标准对比
    const standardComparisons = reviewData.standard_comparison || [];
    if (standardComparisons.length) {
        addPdfSection(doc, '八、行业标准对比', standardComparisons, (cmp) => [
            `${cmp.category_label || cmp.category} - 合同 ${cmp.contract_clause_id || ''} vs ${cmp.matched_standard?.title || '行业标准'}`,
            `合同条款：${String(cmp.contract_clause_text || '').slice(0, 300)}`,
            `标准条款${cmp.matched_standard?.industry ? '(' + cmp.matched_standard.industry + ')' : ''}：${String(cmp.matched_standard?.clause_text || '').slice(0, 300)}`,
            `相似度：${(cmp.matched_standard?.score || 0).toFixed(2)}`,
            cmp.diff_description || '',
        ].filter(Boolean).join('\n'));
    }
    // 增量审查记录
    const incrementalReviews = reviewData.incremental_reviews || [];
    if (incrementalReviews.length) {
        addPdfSection(doc, '九、增量审查记录', incrementalReviews, (r) => [
            `${new Date(r.reviewed_at).toLocaleString('zh-CN')}`,
            `变更统计：修改 ${r.diff_summary?.modified || 0} / 新增 ${r.diff_summary?.added || 0} / 删除 ${r.diff_summary?.deleted || 0}`,
            r.new_risks?.length ? `新增风险(${r.new_risks.length})：${r.new_risks.map((n) => n.title || '').join('、')}` : '',
            r.resolved_risks?.length ? `已解决风险(${r.resolved_risks.length})：${r.resolved_risks.join('、')}` : '',
        ].filter(Boolean).join('\n'));
    }
    doc.end();
};

module.exports = {
    escapeHtml,
    parseJsonField,
    renderReviewReportHtml,
    generateDocxBuffer,
    findPdfFont,
    addPdfSection,
    streamReviewReportPdf,
};

// 硬性合规检查规则引擎
// 基于 reviewRules.json 定义的数字约束规则，对合同文本进行结构化校验，
// 与 LLM 审查形成双轨机制：规则引擎覆盖强制性数字红线，LLM 聚焦语义层风险。

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, '..', 'data', 'reviewRules.json');
const EXTERNAL_VALUES_PATH = path.join(__dirname, '..', 'data', 'external_values.json');

// 中文数字字符 → 数值映射
const CHINESE_DIGIT_MAP = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};
const CHINESE_UNIT_MAP = {
    '十': 10, '百': 100, '千': 1000, '万': 10000,
};

// 解析中文数字字符串为数值
// 支持：零一二三四五六七八九十百千万，以及组合如"三十"→30、"十二"→12、"一百零五"→105
const parseChineseNumber = (str) => {
    if (!str) return null;
    let total = 0;
    let current = 0;
    let hasNum = false;
    for (const ch of str) {
        if (ch in CHINESE_DIGIT_MAP) {
            current = CHINESE_DIGIT_MAP[ch];
            hasNum = true;
        } else if (ch in CHINESE_UNIT_MAP) {
            const unit = CHINESE_UNIT_MAP[ch];
            total += (current || 1) * unit;
            current = 0;
            hasNum = true;
        }
    }
    total += current;
    return hasNum ? total : null;
};

// 读取规则定义文件，按 template_id 过滤
const loadRules = (templateId) => {
    const raw = fs.readFileSync(RULES_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const rules = Array.isArray(data) ? data : (data.rules || []);
    return rules.filter((r) => r.template_id === templateId);
};

// 读取外部基准值（如 LPR 利率）
const loadExternalValues = () => {
    const raw = fs.readFileSync(EXTERNAL_VALUES_PATH, 'utf-8');
    return JSON.parse(raw);
};

// 用 clause_keywords 定位条款，返回包含任一关键词的段落（±200字上下文）
// 找不到关键词返回 null
const extractClause = (contractText, matcher) => {
    if (!contractText || !matcher || !Array.isArray(matcher.clause_keywords)) return null;
    for (const kw of matcher.clause_keywords) {
        if (!kw) continue;
        const idx = contractText.indexOf(kw);
        if (idx >= 0) {
            const start = Math.max(0, idx - 200);
            const end = Math.min(contractText.length, idx + kw.length + 200);
            return contractText.slice(start, end);
        }
    }
    return null;
};

// 从条款文本中提取数字
// 支持中文数字（"两年"→2、"百分之五"→5、"二十"→20）与阿拉伯数字（"3年"→3、"30%"→30）
// number_field 用于上下文定位（如"期限"、"利率"），unit 用于过滤（年/月/%）
const extractNumber = (clauseText, numberField, unit) => {
    if (!clauseText) return null;
    const candidates = [];
    const cnCharClass = '零一二两三四五六七八九十百千万';

    if (unit === '%') {
        // 中文：百分之X
        const cnPercentRe = new RegExp(`百分之([${cnCharClass}]+)`, 'g');
        let m;
        while ((m = cnPercentRe.exec(clauseText)) !== null) {
            const val = parseChineseNumber(m[1]);
            if (val !== null) candidates.push({ value: val, index: m.index });
        }
        // 阿拉伯：X%
        const arPercentRe = /(\d+(?:\.\d+)?)\s*%/g;
        while ((m = arPercentRe.exec(clauseText)) !== null) {
            candidates.push({ value: parseFloat(m[1]), index: m.index });
        }
    } else if (unit === '年' || unit === '月') {
        const unitPattern = unit === '年' ? '年' : '个?月';
        // 中文数字 + 单位
        const cnRe = new RegExp(`([${cnCharClass}]+)\\s*${unitPattern}`, 'g');
        let m;
        while ((m = cnRe.exec(clauseText)) !== null) {
            const val = parseChineseNumber(m[1]);
            if (val !== null) candidates.push({ value: val, index: m.index });
        }
        // 阿拉伯数字 + 单位
        const arRe = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, 'g');
        while ((m = arRe.exec(clauseText)) !== null) {
            candidates.push({ value: parseFloat(m[1]), index: m.index });
        }
    } else {
        // 通用兜底：提取阿拉伯数字
        const arRe = /(\d+(?:\.\d+)?)/g;
        let m;
        while ((m = arRe.exec(clauseText)) !== null) {
            candidates.push({ value: parseFloat(m[1]), index: m.index });
        }
    }

    if (candidates.length === 0) return null;

    // 若提供 number_field，优先返回离该字段最近的数字
    if (numberField) {
        const fieldIdx = clauseText.indexOf(numberField);
        if (fieldIdx >= 0 && candidates.length > 1) {
            candidates.sort((a, b) => Math.abs(a.index - fieldIdx) - Math.abs(b.index - fieldIdx));
        }
    }
    return candidates[0].value;
};

// 求值 value_expr 表达式，返回数值
// 支持：lpr_4x = context.lpr_rate * 4
const evalValueExpr = (expr, context) => {
    if (expr === 'lpr_4x') {
        return (Number(context.lpr_rate) || 0) * 4;
    }
    return 0;
};

// 评估约束
// 若 constraint.op 存在：按 op 比较 extractedValue 与 constraint.value
// 若 constraint.value_expr 存在：求值后按 op（默认 <=）比较
// 返回 { passed: boolean, limit_value: number }
const evaluate = (constraint, extractedValue, context) => {
    let limit;
    if (constraint.value_expr) {
        limit = evalValueExpr(constraint.value_expr, context);
    } else {
        limit = constraint.value;
    }
    const op = constraint.op || '<=';
    let passed;
    switch (op) {
        case '<':  passed = extractedValue < limit; break;
        case '<=': passed = extractedValue <= limit; break;
        case '>':  passed = extractedValue > limit; break;
        case '>=': passed = extractedValue >= limit; break;
        case '==': passed = extractedValue === limit; break;
        case '!=': passed = extractedValue !== limit; break;
        default:   passed = true;
    }
    return { passed, limit_value: limit };
};

// 执行规则引擎
// 加载规则与外部值，合并 context = { ...externalValues, ...context }
// 对每条规则：extractClause → extractNumber → evaluate
// 找不到条款或数字时，该规则视为 passed（不误报），并在 passed 中标注 skipped: true
// 返回 { violations: [...], passed: [...] }
const runRules = (contractText, templateId, context = {}) => {
    const rules = loadRules(templateId);
    const externalValues = loadExternalValues();
    const mergedContext = { ...externalValues, ...context };

    const violations = [];
    const passed = [];

    for (const rule of rules) {
        // 仅处理数字约束规则，提示性规则（advisory）跳过
        if (rule.rule_type !== 'number_constraint') {
            passed.push({ rule_id: rule.id, skipped: true });
            continue;
        }
        const clause = extractClause(contractText, rule.matcher);
        if (!clause) {
            passed.push({ rule_id: rule.id, skipped: true });
            continue;
        }
        const value = extractNumber(clause, rule.matcher.number_field, rule.matcher.unit);
        if (value === null || value === undefined || Number.isNaN(value)) {
            passed.push({ rule_id: rule.id, skipped: true });
            continue;
        }
        const result = evaluate(rule.constraint, value, mergedContext);
        if (result.passed) {
            passed.push({ rule_id: rule.id });
        } else {
            violations.push({
                rule_id: rule.id,
                description: rule.description,
                legal_basis: rule.legal_basis,
                contract_value: value,
                limit_value: result.limit_value,
                severity: rule.severity,
                fix_template: rule.fix_template,
                clause_excerpt: clause,
            });
        }
    }

    return { violations, passed };
};

module.exports = {
    loadRules,
    loadExternalValues,
    extractClause,
    extractNumber,
    evaluate,
    runRules,
    parseChineseNumber,
};

/**
 * Settings 页面共享的工具函数与常量。
 * 供 Settings.vue 及其子组件统一引用，避免重复定义。
 */

// 知识来源类型 -> 中文标签
export const sourceLabel = (type) => ({
  law: '法律条文',
  case: '裁判文书',
  rule: '审查规则',
  guide: '审查知识',
  standard_clause: '行业标准条款',
}[type] || type || '知识');

// 法律状态 -> el-tag 类型
export const lawStatusTagType = (status) => ({
  现行: 'success',
  已修订: 'warning',
  已废止: 'info',
}[status] || 'info');

// 将不同来源的相似度分数统一归一化到 0-1 区间
export const normalizeScore = (score) => {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return 0;
  if (numericScore <= 1) return Math.max(0, numericScore);
  return numericScore / (numericScore + 1);
};

// 用于模板展示的相似度百分比字符串
export const similarityPercent = (item) =>
  `${Math.round(normalizeScore(item.similarity ?? item.score) * 100)}%`;

// 报告章节预设选项：中文标签 + 英文值（后端 prompt 拼接用英文标识）
export const REPORT_SECTION_OPTIONS = [
  { value: 'risk_summary', label: '风险摘要' },
  { value: 'modification_suggestions', label: '修改建议' },
  { value: 'labor_compliance', label: '劳动合规' },
  { value: 'performance_risk', label: '履约风险' },
  { value: 'breach_cost_analysis', label: '违约成本分析' },
  { value: 'missing_clauses', label: '缺失条款' },
  { value: 'citations', label: '引用依据' },
];

// 标准条款分类
export const standardCategories = [
  { value: 'confidentiality', label: '保密义务', tip: '保密信息范围、保密期限、违约赔偿等' },
  { value: 'breach', label: '违约责任', tip: '违约金比例、赔偿范围、解除权等' },
  { value: 'ip', label: '知识产权', tip: '归属、许可、衍生作品、侵权处理' },
  { value: 'dispute', label: '争议解决', tip: '管辖法院/仲裁机构、适用法律' },
  { value: 'force_majeure', label: '不可抗力', tip: '定义、通知义务、责任免除范围' },
];

// 行业选项
export const industryOptions = [
  '通用', '互联网', '制造业', '金融', '房地产',
  '央企/国企', '医疗', '教育', '零售', '物流',
];

// 25 个合同类型预设（与 reviewTemplates.json 模板 id 对齐）
export const contractTypeOptions = [
  { value: 'labor', label: '劳动合同' },
  { value: 'lease', label: '租赁合同' },
  { value: 'service', label: '服务合同' },
  { value: 'sale', label: '买卖合同' },
  { value: 'loan', label: '借款合同' },
  { value: 'guarantee', label: '担保合同' },
  { value: 'construction', label: '建设合同' },
  { value: 'tech_development', label: '技术开发合同' },
  { value: 'tech_transfer', label: '技术转让合同' },
  { value: 'transport', label: '运输合同' },
  { value: 'warehouse', label: '仓储合同' },
  { value: 'entrust', label: '委托合同' },
  { value: 'partnership', label: '合伙合同' },
  { value: 'equity_transfer', label: '股权转让合同' },
  { value: 'franchise', label: '特许经营合同' },
  { value: 'insurance', label: '保险合同' },
  { value: 'property_management', label: '物业管理合同' },
  { value: 'advertising', label: '广告合同' },
  { value: 'finance_lease', label: '融资租赁合同' },
  { value: 'brokerage', label: '居间合同' },
  { value: 'nda', label: '保密协议' },
  { value: 'non_compete', label: '竞业限制协议' },
  { value: 'ip_license', label: '知识产权许可合同' },
  { value: 'gift', label: '赠与合同' },
  { value: 'general', label: '通用合同' },
];

export const contractTypeLabel = (val) => {
  const found = contractTypeOptions.find((c) => c.value === val);
  return found ? found.label : val;
};

export const standardCategoryLabel = (cat) => {
  const found = standardCategories.find((c) => c.value === cat);
  return found ? found.label : cat;
};

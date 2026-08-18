/**
 * Runtime policy switches for deployments that must stay inside an approved
 * contract-review knowledge base.
 */
const isEnabled = (value, defaultValue = false) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const isKnowledgeBaseOnlyMode = () => isEnabled(process.env.REVIEW_KB_ONLY_MODE, false);

module.exports = {
    isEnabled,
    isKnowledgeBaseOnlyMode,
};

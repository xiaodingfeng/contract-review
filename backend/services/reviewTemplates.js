const path = require('path');
const fs = require('fs');

const templatesPath = path.join(__dirname, '..', 'data', 'reviewTemplates.json');

const loadTemplates = () => {
    if (!fs.existsSync(templatesPath)) return [];
    return JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
};

const getAllTemplates = () => loadTemplates();

const getTemplateById = (id) => loadTemplates().find((template) => template.id === id);

const matchTemplate = (contractType = '', text = '') => {
    const templates = loadTemplates();
    const haystack = `${contractType}\n${text}`.toLowerCase();
    let best = templates.find((template) => template.id === 'general') || templates[0];
    let bestScore = -1;

    for (const template of templates) {
        const score = (template.contract_type_keywords || []).reduce((sum, keyword) => (
            haystack.includes(String(keyword).toLowerCase()) ? sum + 1 : sum
        ), 0);
        if (score > bestScore) {
            best = template;
            bestScore = score;
        }
    }
    return best;
};

module.exports = {
    getAllTemplates,
    getTemplateById,
    matchTemplate,
};

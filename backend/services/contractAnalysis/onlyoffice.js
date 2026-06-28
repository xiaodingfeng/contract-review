/**
 * @file services/contractAnalysis/onlyoffice.js
 * @brief 构建 OnlyOffice 文档编辑器配置并发送命令服务
 *
 * 核心职责：
 * - 根据合同记录生成 OnlyOffice 编辑器初始化配置
 * - 使用 JWT 对配置签名，保证回调与文档访问安全
 * - 向 OnlyOffice 服务发送命令请求（如强制保存）
 *
 * 关键实现：
 * - buildOnlyOfficeConfig 区分 docx/pdf 的权限与编辑模式
 * - 通过 BACKEND_URL_FOR_DOCKER 生成容器内可访问的文件与回调 URL
 * - postOnlyOfficeCommand 带 JWT 头调用 CommandService
 *
 * 依赖关系：
 * - 上游：jsonwebtoken、axios、path 及环境变量配置
 * - 下游：被合同编辑/保存回调相关路由调用
 */
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');

const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET;
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://localhost:8081';
const APP_HOST = process.env.APP_HOST;
const BACKEND_URL_FOR_DOCKER = process.env.BACKEND_URL_FOR_DOCKER || APP_HOST;

const buildOnlyOfficeConfig = (contractRecord, ext = 'docx') => {
    const isPdf = ext === 'pdf';
    const fileUrl = `${BACKEND_URL_FOR_DOCKER}/api/uploads/${path.basename(contractRecord.storage_path)}`;
    const callbackUrl = `${BACKEND_URL_FOR_DOCKER}/api/contracts/save-callback`;
    const payload = {
        document: {
            fileType: ext,
            key: contractRecord.document_key,
            title: contractRecord.original_filename,
            url: fileUrl,
            permissions: {
                comment: !isPdf,
                download: true,
                edit: !isPdf,
                print: true,
                review: !isPdf,
            },
        },
        documentType: isPdf ? 'pdf' : 'word',
        editorConfig: {
            callbackUrl,
            lang: 'zh-CN',
            mode: isPdf ? 'view' : 'edit',
            user: {
                id: `user-${contractRecord.user_id || 1}`,
                name: 'Reviewer',
            },
            customization: {
                forcesave: !isPdf,
                comments: true,
                compactHeader: true,
                compactToolbar: true,
                toolbarHideFileName: true,
                toolbarNoTabs: true,
                features: {
                    tabStyle: 'line',
                    tabBackground: 'toolbar',
                    spellcheck: false,
                },
                hideRightMenu: true,
                hideRulers: true,
                help: false,
                plugins: false,
                chat: false,
                feedback: false,
                goback: false,
            },
        },
    };
    return { ...payload, token: jwt.sign(payload, ONLYOFFICE_JWT_SECRET) };
};

const postOnlyOfficeCommand = async (payload) => {
    const commandPayload = ONLYOFFICE_JWT_SECRET
        ? { ...payload, token: jwt.sign(payload, ONLYOFFICE_JWT_SECRET) }
        : payload;

    const headers = { 'Content-Type': 'application/json' };
    if (ONLYOFFICE_JWT_SECRET) {
        headers.Authorization = `Bearer ${commandPayload.token}`;
    }

    const response = await axios.post(
        `${ONLYOFFICE_URL.replace(/\/$/, '')}/coauthoring/CommandService.ashx`,
        commandPayload,
        { headers, timeout: 10000 },
    );
    return response.data;
};

module.exports = {
    ONLYOFFICE_JWT_SECRET,
    ONLYOFFICE_URL,
    APP_HOST,
    BACKEND_URL_FOR_DOCKER,
    buildOnlyOfficeConfig,
    postOnlyOfficeCommand,
};

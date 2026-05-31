# ContractGE

> 一款基于 AI 的中文合同审查系统，支持合同风险分析、OnlyOffice 在线预览编辑与智能问答。
---

## 🌐 Demo

在线演示：

# [ContractGE Demo(https://contract.fengzhengx.cn/)](https://contract.fengzhengx.cn/)

<p align="center">
  <img src="img/home.png" width="100%" />
</p>

---

## ✨ Features

* 📄 合同上传与智能审查
* ⚖️ AI 风险分析与修改建议
* 📝 OnlyOffice 在线预览与编辑
* 🤖 智能问答（Contract QA）
* 🧠 本地大模型支持（DeepSeek）
* 🌐 前后端分离架构
* 🚀 快速部署与轻量化运行

---

## 🖼️ Preview

### 首页

![](img/home.png)

### 合同上传

![](img/step1.png)

### AI 分析流程

![](img/step2.png)

### 审查结果

![](img/step3-1.png)

![](img/step3-2.png)

![](img/step3-3.png)

![](img/step3-4.png)

![](img/step3-5.png)

---

## 🏗️ Tech Stack

### Frontend

* Vue 3
* Element UI
* Tailwind CSS

### Backend

* Node.js
* Express

### Database

* SQLite

### Office Integration

* OnlyOffice Document Server

### Local LLM

* `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`

---

## 🚀 Quick Start

### 1. Clone Repository

```bash id="7c93j2"
git clone https://github.com/xiaodingfeng/contract-review.git

cd contract-review
```

---

### 2. Start OnlyOffice

```bash id="u0u4u8"
docker run -i -t -d \
-p 8081:80 \
-e JWT_ENABLED=true \
-e JWT_SECRET=your_jwt_secret \
--restart=always \
onlyoffice/documentserver
```

OnlyOffice 默认访问地址：

```text id="7z2h9s"
http://localhost:8081
```

---

### 3. Start Backend

```bash id="3xj9lr"
cd backend

npm install

npm run dev
```

Backend 默认运行：

```text id="t6b5n1"
http://localhost:3000
```

---

### 4. Start Frontend

```bash id="g3l2nk"
cd frontend

npm install

npm run serve
```

Frontend 默认运行：

```text id="q6v6dq"
http://localhost:8080
```

浏览器访问：

```text id="g9z1ul"
http://localhost:8080
```

---

## 📁 Project Structure

```text id="f7x6tp"
.
├── backend/
│   ├── database.js         # SQLite 初始化
│   ├── index.js            # Express 入口
│   ├── package.json
│   └── routes/
│       ├── contracts.js
│       └── qa.js
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── router/
│   │   ├── views/
│   │   ├── App.vue
│   │   └── main.js
│   └── package.json
│
└── README.md
```

---

## ⚙️ Configuration

### OnlyOffice JWT

请确保前后端使用一致的 JWT Secret：

```env id="j2k0vt"
JWT_SECRET=your_jwt_secret
```

---

## 🧠 AI Model

当前默认本地模型：

```text id="a4x6g2"
deepseek-ai/DeepSeek-R1-0528-Qwen3-8B
```

你也可以替换为：

* Qwen
* DeepSeek
* OpenAI Compatible API
* Ollama 本地模型

---

## 📌 Roadmap

* [ ] V2 重构版本
* [ ] 多模型切换
* [ ] 向量知识库
* [ ] OCR 合同识别
* [ ] 多租户支持
* [ ] 审查规则配置
* [ ] RAG 增强检索
* [ ] Docker Compose 一键部署

---

## 🔥 Contract Review AI V2

新版项目正在开发：

# [Contract Review AI V2](https://github.com/xiaodingfeng/contract-review-v2)

V2 特性：

* PostgreSQL + Milvus
* OnlyOffice 深度联动
* 知识库增强
* 裁判文书检索
* 智能问答
* 受控联网搜索
* OpenAI Compatible API

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=xiaodingfeng/contract-review\&type=Date)](https://www.star-history.com/#xiaodingfeng/contract-review&Date)

---

## 📄 License

MIT

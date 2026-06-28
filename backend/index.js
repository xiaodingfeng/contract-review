/**
 * @file index.js
 * @brief 合同审查后端应用入口,启动 Express HTTP 与 Socket.io 服务
 *
 * 核心职责：
 * - 加载并注册各业务路由(contracts/qa/users/knowledge/templates/standards)
 * - 配置 CORS、JSON 解析、静态资源(public/uploads)等中间件
 * - 建立 Socket.io 服务,支持合同分析进度实时推送与多端协作
 * - 启动时执行数据库重建与审查模板 seed 初始化
 *
 * 关键实现：
 * - 通过 app.set('io', io) 与 contractRoutes.setIoInstance(io) 将 io 注入路由
 * - Multer 错误处理中间件统一返回文件大小/格式错误的 JSON 响应
 * - startServer 串联数据库初始化、模板 seed、HTTP 监听三步流程
 *
 * 依赖关系：
 * - 上游：dotenv、express、cors、socket.io、各 routes 模块、services/reviewTemplates、database、database-check
 * - 下游：被进程启动入口调用,前端通过 HTTP/WebSocket 访问
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const contractRoutes = require('./routes/contracts');
const qaRoutes = require('./routes/qa');
const userRoutes = require('./routes/users');
const knowledgeRoutes = require('./routes/knowledge');
const templateRoutes = require('./routes/templates');
const standardRoutes = require('./routes/standards');
const { seedTemplatesIfEmpty } = require('./services/reviewTemplates');
const { seedLawsFromMarkdown, seedCasesFromJson, syncAllVectorDocuments } = require('./services/vectorStore');
const db = require('./database');
const resetAndRebuildDatabase = require('./database-check');

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Socket.io logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-contract', (contractId) => {
    socket.join(`contract-${contractId}`);
    console.log(`User ${socket.id} joined room: contract-${contractId}`);
    // Notify others in the room
    socket.to(`contract-${contractId}`).emit('user-joined', { userId: socket.id });
  });

  socket.on('analysis-started', (data) => {
    // data should contain contractId and perhaps user info
    socket.to(`contract-${data.contractId}`).emit('analysis-progress', { status: 'started', user: data.user });
  });

  socket.on('analysis-finished', (data) => {
    // Broadcast analysis results to everyone in the room
    io.to(`contract-${data.contractId}`).emit('analysis-complete', data.results);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Serve static files from the 'public' directory
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// Serve static files from the "uploads" directory
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// Attach io to app for use in routes
app.set('io', io);
// 注入 io 实例到 contracts 路由，供后台异步分析任务推送进度
contractRoutes.setIoInstance(io);

// API Routes
app.use('/api/contracts', contractRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/standards', standardRoutes);

app.get('/', (req, res) => {
  res.send('ContractGE Backend is running!');
});

// Multer 错误处理中间件：文件大小超限、格式不支持等返回 JSON
app.use((err, req, res, next) => {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '文件大小超过 50MB 限制，请压缩或拆分后上传。', code: 'FILE_TOO_LARGE' });
    }
    if (err.message && err.message.startsWith('UNSUPPORTED_FILE_TYPE')) {
      return res.status(400).json({ error: '仅支持 .docx 和 .pdf 格式的文件。', code: 'UNSUPPORTED_FILE_TYPE' });
    }
    console.error('[ERROR] Unhandled middleware error:', err);
    return res.status(500).json({ error: '服务器处理请求时发生错误。' });
  }
  next();
});

async function startServer() {
  await resetAndRebuildDatabase();
  // 启动时为空表 seed 审查模板(从 JSON 导入,标记 is_system=true,生成 embedding)
  await seedTemplatesIfEmpty();
  // seed 公共标准条款(需在 standard_clauses 表创建后执行;原 standards.js 模块加载时触发会因表未创建而失败)
  await standardRoutes.seedPublicClausesIfEmpty();
  server.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    // 后台异步:先把法律/案例入库 PostgreSQL(skipMilvus),再全量同步 PG -> Milvus
    // 不阻塞主进程启动;前端"重建向量数据库"按钮执行同样的 PG -> Milvus 同步操作
    seedKnowledgeInBackground();
  });
}

// 后台异步导入知识库:先入 PostgreSQL(skipMilvus 跳过 Milvus 双写),再同步 PG -> Milvus
// 失败仅记录日志,不影响主进程;与前端"重建向量数据库"按钮调用同一个 syncAllVectorDocuments
async function seedKnowledgeInBackground() {
  const log = (msg) => console.log(`[Background Seed] ${msg}`);
  log('Step 1/3: importing laws into PostgreSQL (skipMilvus)...');
  try {
    const lawResult = await seedLawsFromMarkdown(undefined, { skipMilvus: true });
    log(`Laws import finished: ${JSON.stringify(lawResult)}`);
  } catch (error) {
    console.error(`[Background Seed] Laws import failed: ${error.message}`);
  }
  log('Step 2/3: importing cases into PostgreSQL (skipMilvus)...');
  try {
    const caseResult = await seedCasesFromJson(undefined, { skipMilvus: true });
    log(`Cases import finished: ${JSON.stringify(caseResult)}`);
  } catch (error) {
    console.error(`[Background Seed] Cases import failed: ${error.message}`);
  }
  log('Step 3/3: syncing PostgreSQL -> Milvus (vector index)...');
  try {
    const syncResult = await syncAllVectorDocuments();
    log(`Milvus sync finished: ${JSON.stringify(syncResult)}`);
  } catch (error) {
    console.error(`[Background Seed] Milvus sync failed: ${error.message}`);
  }
  log('Background knowledge import done.');
}

startServer();

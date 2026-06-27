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
  server.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
  });
}

startServer();

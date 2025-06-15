FROM node:20

WORKDIR /app

# 只复制package文件
COPY package.json ./

# 清除可能存在的本地node_modules
RUN rm -rf node_modules

# 安装依赖（强制重新构建）
RUN npm install --force-rebuild --build-from-source=sqlite3

# 然后复制其他文件
COPY . .

# 创建上传目录
RUN mkdir -p uploads

EXPOSE 3000
CMD ["node", "index.js"]
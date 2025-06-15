#!/bin/bash

# 停止并删除旧容器
docker-compose down

# 构建新镜像
docker-compose build

# 启动新容器
docker-compose up -d

# 查看容器日志
docker-compose logs -f 
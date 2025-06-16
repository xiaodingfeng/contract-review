#!/bin/bash

# 构建 Docker 服务
docker-compose build

# 将构建的镜像保存为 tar 文件
docker save -o contractge-backend.tar contractge-backend

echo "构建完成并已保存为 contractge-backend.tar"
# ============================================================
# AkShare 行情桥接微服务 Docker 镜像
# ============================================================
FROM python:3.11-slim

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
ARG PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
RUN pip install \
    --no-cache-dir \
    --timeout 120 \
    --retries 8 \
    --index-url "${PIP_INDEX_URL}" \
    -r requirements.txt

# 复制运行时源码。main.py 的研究缓存与历史调度器依赖独立模块。
COPY main.py research_cache.py ./

# 暴露端口
EXPOSE 8800

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8800/health')" || exit 1

# 启动服务
CMD ["python", "main.py"]

# ============================================================
# AkShare 行情桥接微服务 Docker 镜像
# ============================================================
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖（AkShare 需要的一些底层库）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源码
COPY main.py .

# 暴露端口
EXPOSE 8800

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8800/health')" || exit 1

# 启动服务
CMD ["python", "main.py"]

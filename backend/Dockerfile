FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt requirements-ml.txt ./
ARG WITH_ML=1
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$WITH_ML" = "1" ]; then pip install --no-cache-dir -r requirements-ml.txt; fi
COPY anvesh ./anvesh
RUN useradd -m anvesh && mkdir -p /data && chown anvesh /data
USER anvesh
ENV ANVESH_DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "anvesh.api:app", "--host", "0.0.0.0", "--port", "8000"]

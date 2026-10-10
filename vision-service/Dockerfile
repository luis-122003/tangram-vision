# Servicio de visión: detector YOLOv8s-seg + validador geométrico.
# Interno: no autentica a nadie, así que en docker-compose no publica puertos.
FROM python:3.11-slim

# opencv (el que arrastra ultralytics) necesita estas dos bibliotecas del sistema.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch primero y desde el índice de CPU: sin esto pip baja la versión con CUDA,
# unos 2 GB que en una máquina virtual sin GPU no sirven para nada.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY vision-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY vision-service/*.py ./
COPY vision-service/data ./data
# Los pesos NO van en la imagen: se montan en /app/models (ver docker-compose.yml).

RUN useradd --create-home --uid 1001 vision && chown -R vision /app
USER vision
# ultralytics escribe ahí su archivo de ajustes al cargar el modelo.
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health').status==200 else 1)"
CMD ["python", "-m", "uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8001"]

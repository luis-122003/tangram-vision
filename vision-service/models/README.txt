MODELOS
=======

tangram_piezas_seg_best.pt     (23 MB)  <- EL UNICO QUE USA EL SERVICIO
    YOLOv8s-seg entrenado (ultralytics 8.4.79).
    Detecta y segmenta las 7 fichas del Tangram.
    Clases: large_tri_orange, large_tri_green, medium_tri_red, small_tri_red,
            small_tri_blue, square_yellow, parallelogram_cyan

    Es la taxonomia de 7 clases (una por ficha fisica, distinguidas por color).
    El validador tambien entiende la de 5 clases geometricas y traduce entre
    ambas: ver TAXONOMIA_7 y TAXONOMIA_5 en tangram_validator.py.

    OJO: el nombre del archivo debe coincidir con YOLO_WEIGHTS en .env. Si
    apunta a un archivo que no existe, el servicio arranca igual pero responde
    en modo demostracion, y es facil no darse cuenta. Se comprueba en /health:
    si "yolo_loaded" es false, el detector no se esta usando.

    Con las fichas ya localizadas, tangram_validator.py hace el resto por
    geometria: cuenta el inventario, mide si hay fichas montadas, busca huecos
    interiores, detecta fichas sueltas y compara la silueta armada contra la
    figura objetivo. Nada de eso necesita pesos ni entrenamiento.


unet_tangram_model_resnet34.keras  (98 MB) <- YA NO SE USA
    U-Net/ResNet34 que segmentaba la silueta completa de la figura armada.

    Se retiro del pipeline. Su unica salida era una mascara con la silueta, y
    esa silueta sale de la union de las mascaras de las piezas que YOLO ya
    devuelve. Ademas, una mascara no puede explicar POR QUE esta mal un armado:
    no sabe que falta el cuadrado ni que hay dos fichas montadas. Eso lo aporta
    ahora el validador, y es lo que lee el estudiante.

    Consecuencias del cambio:
      - el servicio ya no necesita TensorFlow ni Keras;
      - arranca en segundos en vez de esperar a cargar los pesos;
      - hay un solo modelo que mantener y reentrenar.

    El archivo se puede borrar sin afectar al servicio. Se conserva aqui solo
    como respaldo del trabajo de entrenamiento (capitulo de la tesis).

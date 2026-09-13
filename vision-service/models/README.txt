MODELOS
=======

AVISO: aqui hay DOS detectores y los dos son yolov8s-seg. Arrancar con el que
no es no produce ningun error: "yolo_loaded" sale true igual, "models_loaded"
dice lo mismo para ambos y las cifras son verosimiles. Lo unico que los
distingue es el nombre del archivo, y por eso /health devuelve tambien
"yolo_weights" y el lanzador lo imprime al arrancar.


tangram_formas_v2.pt           (23 MB)  <- EL QUE USA EL SERVICIO
    YOLOv8s-seg, entrenado el 5 de septiembre de 2026 (ultralytics 8.4.140).
    Detecta y segmenta las fichas por FORMA, sin mirar el color.
    Clases: large_tri, medium_tri, small_tri, square, parallelogram

    Es la taxonomia de 5 clases geometricas: las 7 fichas del Tangram son 5
    formas distintas, porque hay dos triangulos grandes y dos pequenos. Al no
    depender del color funciona con cualquier juego, que era justo la
    limitacion del modelo anterior.

    Entrenado sobre 6000 imagenes sinteticas de sintetico/generar.py, 100
    epocas, 640 px. De ahi YOLO_IMGSZ=640 en .env: subirlo no anade detalle y
    cambia la escala aparente de las fichas respecto a lo que vio entrenando,
    y este detector separa el triangulo grande del mediano y del pequeno
    precisamente por tamano.

    NO FUNCIONA SOLO. En crudo devuelve 8,62 fichas donde hay 7: parte el
    romboide por su diagonal en dos triangulos pequenos, y sobre el cuadrado
    emite dos detecciones dudando entre cuadrado y romboide con confianzas de
    0,48. Lo corrige tangram_validator.reparar_cuadrilateros(), que service.py
    llama en cada foto. Sin esa llamada el inventario no cuadra en NINGUNA de
    las 112 fotos reales; con ella, en 98.


tangram_piezas_seg_best.pt     (23 MB)  <- ANTERIOR, se conserva de referencia
    YOLOv8s-seg entrenado (ultralytics 8.4.79), una clase por ficha fisica
    distinguida por COLOR.
    Clases: large_tri_orange, large_tri_green, medium_tri_red, small_tri_red,
            small_tri_blue, square_yellow, parallelogram_cyan

    Funciona con el juego con el que se entreno y se derrumba con cualquier
    otro: sobre las 112 fotos de un Tangram distinto da IoU de silueta 0,162 y
    encuentra 1,09 fichas de 7 (medido a 640 px, en la misma corrida que el
    detector por forma; a 960, su resolucion de entrenamiento, sale peor:
    0,113). Esa medida es la que justifica haber entrenado el detector por
    forma.

    El validador entiende las dos taxonomias y traduce entre ellas: ver
    TAXONOMIA_7 y TAXONOMIA_5 en tangram_validator.py. Se puede volver a este
    modelo cambiando YOLO_WEIGHTS en .env, sin tocar una linea de codigo.


    OJO, para cualquiera de los dos: el nombre del archivo debe coincidir con
    YOLO_WEIGHTS en .env. Si apunta a un archivo que no existe, el servicio
    arranca igual pero responde en modo demostracion, y es facil no darse
    cuenta. Se comprueba en /health: si "yolo_loaded" es false, el detector no
    se esta usando.

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

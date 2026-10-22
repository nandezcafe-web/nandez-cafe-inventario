# IA para agricultores y cultivos: qué existe, qué sirve para el café y qué construir

**Investigación de estado del arte — octubre de 2026**
Proyecto: Sistema de inteligencia, tecnificación y aprovechamiento integral del café (Chinácota, Norte de Santander)

---

## 1. Resumen ejecutivo

La IA agrícola hoy se mueve en **cinco capas**, no en una sola "app inteligente":

| Capa | Qué hace | Madurez | ¿Aplica a nuestro proyecto? |
|---|---|---|---|
| 1. Diagnóstico por imagen | Foto de hoja o fruto → plaga o enfermedad | Alta en laboratorio, **media en campo** | Sí, construible con datos propios |
| 2. Modelos agroclimáticos de riesgo | Clima + fenología → alerta de roya, broca, sequía | Alta y **ya disponible gratis en Colombia** | Sí, ya implementado parcialmente |
| 3. Teledetección (satélite y dron) | Variabilidad del lote, vigor, estimación de cosecha | Media; limitada por nubes y tamaño de lote | Sí, con dron propio; satélite con reservas |
| 4. IoT y trampas inteligentes | Sensores de clima y suelo, conteo automático de insectos | Alta, pero **cara** en producto comercial | Sí, en versión propia de bajo costo |
| 5. Asistentes LLM / RAG | Pregunta en lenguaje natural → respuesta con fuentes | Alta y barata; el costo bajó ~100× | Sí, es el componente más barato de construir |

**Conclusión práctica:** casi todo lo necesario para empezar ya existe y es gratuito (Cenicafé Agroclima, datasets abiertos de hojas de café, Sentinel-2, modelos preentrenados). Lo que **no** existe, y es nuestro diferencial defendible, es un conjunto de datos propio y etiquetado de esta finca y esta región, que conecte cultivo + clima + cosecha + subproductos.

No tiene sentido competir con Taranis o xarvio. Tiene sentido construir lo que ellos no hacen: café de pequeña escala, en español, con economía circular de residuos.

---

## 2. Lo que ya existe gratis y deberíamos usar esta semana

### 2.1. Plataforma Agroclimática Cafetera (Cenicafé): lo más valioso y lo menos usado

Cenicafé lleva cerca de 70 años monitoreando el clima de la zona cafetera colombiana y publica **agroclima.cenicafe.org** con acceso público:

- **Alerta Roya:** define el *periodo crítico de control* a partir de la **floración principal**: comienza **60 días después** de la floración y termina **180 días después**. Las epidemias de roya arrancan tras la floración y alcanzan su máximo antes de la cosecha.
- **Alerta Broca:** periodo crítico de control calculado también desde las fechas de floración principal, más un modelo de vuelo de la broca.
- **Atlas climatológico cafetero**, **balance hídrico**, **caracterización agroclimática** y **mapas de vulnerabilidad a broca**, consultables con clic en el mapa o por **código SICA** de la finca.
- **Boletín Agrometeorológico** periódico, con recomendaciones por región y seguimiento a El Niño.
- Apps móviles: **MAF** (manejo agronómico y fitosanitario: plagas, enfermedades, arvenses y deficiencias), **IMO** (indicadores de mano de obra) y **POS** (calidad en poscosecha).

> **Acción inmediata:** registrar la floración principal con fecha exacta (ya lo hace nuestro módulo de Floraciones) y conectar la regla 60–180 días como ventana crítica de roya. Es la mejora de mayor valor por menor esfuerzo de todo este informe. También conviene conseguir el **código SICA** de la finca para consultar las alertas oficiales de la zona.

### 2.2. Diagnóstico por foto, hoy mismo, sin desarrollar nada

- **Plantix:** más de 800 síntomas en unos 60 cultivos, precisión reportada superior al 90 %, diagnóstico en segundos.
- **Agrio:** cerca de 94 % reportado, con revisión humana experta cuando el modelo no está seguro.
- **DEC (Detección en Café):** detecta roya, mancha de hierro (cercospora) y minador con precisión reportada superior al 92 %.

**Cuidado con esas cifras:** se miden sobre imágenes curadas, no en campo con sombra, lluvia y hojas sucias. Sirven como segunda opinión, nunca como diagnóstico.

### 2.3. Clima y satélite gratuitos

- **Open-Meteo** (ya integrado en nuestro sistema): pronóstico multi-modelo e histórico ERA5.
- **Sentinel-2** (Copernicus): 10 m de resolución, revisita de unos 5 días, gratis. Limitaciones serias en nuestra zona: **nubosidad persistente del cinturón cafetero**, topografía de ladera, lotes pequeños y píxeles mezclados con el sombrío. Las investigaciones recientes lo resuelven combinando **Sentinel-1 (radar, que atraviesa nubes)** con Sentinel-2 en Google Earth Engine.
- Las imágenes de menos de 2 m de resolución son de pago. **Para el detalle del lote, el dron propio le gana al satélite.**

---

## 3. Lo comercial: qué hay y por qué todavía no nos sirve

| Producto | Qué hace | Precio de referencia | Por qué no encaja aún |
|---|---|---|---|
| **Taranis** | Escaneo aéreo submilimétrico y asistente agronómico | Por hectárea, contrato anual | Pensado para cultivos extensivos (maíz, soya, trigo) |
| **Climate FieldView** (Bayer) | Satélite, identificación de plagas, predicción de rendimiento (~92 % reportado) | Suscripción por hectárea | Sin modelos para café |
| **xarvio Field Manager** (BASF) | Riesgo de enfermedad y momento óptimo de aspersión por lote | Suscripción por hectárea | Cultivos y regiones de clima templado |
| **Trapview** | Trampa con cámara e IA que cuenta e identifica insectos | **~650 USD por trampa**; suscripción desde ~10 €/ha; plan Scouting 50–250 €/año | No trae modelo de broca; costo alto para 13 ha |
| **iSCOUT** (Pessl/METOS) | Trampa solar con cámara e IA | **1.040–1.130 €**; alquiler ~300 €/temporada | Igual que el anterior |
| **FarmSense FlightSensor** | Sensor óptico que clasifica insectos en vuelo en tiempo real | **~300 USD por sensor y temporada** | Sin modelo de broca validado |

**Lectura:** el hardware de trampa inteligente cuesta entre 650 y 1.130 € por unidad. Una versión propia con ESP32-CAM o Raspberry Pi cuesta entre **80 y 150 USD**, y el modelo de broca hay que entrenarlo igual, porque ningún comercial lo trae.

---

## 4. Lo científico y abierto: la base para construir lo nuestro

### 4.1. Conjuntos de datos públicos de hoja de café

| Dataset | Contenido | Uso |
|---|---|---|
| **BRACOL** | 1.747 imágenes de hoja de arábica; 1.899 anotaciones: minador (540), **roya (621)**, phoma (464), cercospora (274) | El mejor punto de partida para un clasificador propio |
| **RoCoLe** | 1.560 imágenes tomadas con celular en campo real: 791 sanas y 769 enfermas con distintos niveles de roya | Valioso porque **es de campo**, no de laboratorio |
| **CoLeaf-DB** | 1.006 imágenes de hoja clasificadas por **deficiencias nutricionales** (Perú) | Para el módulo de nutrición |

### 4.2. Qué modelos usa la investigación actual

- **YOLOv8 a YOLOv11** para detección de lesiones y plagas en hoja de café: es el estándar en los artículos de 2025–2026.
- Arquitecturas CNN con exactitudes reportadas de 96 a 99 % **en conjuntos curados**. En campo colombiano, el referente realista es el estudio de roya en Caturra con **F1 = 0,775**, estadísticamente comparable a la inspección visual (ya citado en nuestro plan maestro).
- **YOLO + RAG:** trabajos de 2025–2026 combinan el detector de imagen con un modelo de lenguaje que explica el diagnóstico y recomienda el manejo citando fuentes. Es exactamente la arquitectura que nos conviene.
- **Modelos visión-lenguaje agrícolas:** AgroGPT (PaliGemma 3B afinado), VLM-MCPDD (LLaVA-1.5 con LoRA), Agri-R1. Permiten diagnóstico explicable sin entrenar desde cero.
- **Broca con cómputo en el borde:** hay propuestas de 2026 de sistemas tipo *fog computing* con YOLO optimizado específicamente para detectar broca, por el problema del tamaño diminuto del daño y lo denso del racimo de frutos.

### 4.3. Asistentes conversacionales: la referencia a copiar

**Farmer.Chat** (Digital Green con OpenAI) usa RAG sobre bibliotecas agronómicas y transcripciones de video, con soporte multilingüe por texto y voz:

- Más de 830.000 usuarios en Kenia, Nigeria, Etiopía, India y Brasil, con más de 5 millones de consultas.
- **Costo de extensión rural: de unos 35 USD a unos 0,35 USD por agricultor (100 veces menos).**

Esto demuestra que un asistente agronómico en español, alimentado con la biblioteca de Cenicafé **y con nuestros propios registros**, es viable técnica y económicamente para una sola persona desarrollándolo.

---

## 5. El entorno colombiano: aliados, no solo competencia

- **Más de 120 startups AgTech** creadas en Colombia en los últimos tres años; **35 % ya usan IA** (iNNpulsa).
- **Semillatech** (Antioquia): visión artificial para identificar enfermedades del café con foto de celular, probada en cooperativas del Eje Cafetero. Es la referencia local más cercana a una parte de nuestra idea; conviene estudiarla y, si se puede, hablar con ellos.
- **AgroTECH 2026** (MinTIC): programa estatal para llevar herramientas digitales a más de 6.000 productores rurales, con formación y acompañamiento técnico. **Posible vía de financiación y validación.**
- **Expo Agrofuturo 2026:** 21 al 23 de octubre, Corferias (Bogotá), con IA, agricultura de precisión y financiación rural. Oportunidad inmediata de contactos.
- Complementos ya previstos en el plan: **SENA**, universidades y Cenicafé.

---

## 6. Qué construir nosotros: cinco proyectos ordenados por valor frente a esfuerzo

### P1 — Ventana crítica de roya y broca desde la floración (días)

Conectar la regla de Cenicafé (60 a 180 días después de la floración principal) con nuestro módulo de Floraciones y con el motor de riesgos agroclimáticos que ya existe.
**Esfuerzo:** horas. **Costo:** cero. **Valor:** alto e inmediato. Es la mejora más rentable del informe.

### P2 — Clasificador propio de hoja por foto (semanas)

Transferencia de aprendizaje sobre BRACOL y RoCoLe, reentrenado con **fotos propias etiquetadas por el agrónomo**, exportado a TensorFlow Lite para que corra en el celular sin internet, integrado al módulo de Observaciones (que ya guarda foto, lote, GPS y severidad).
**Costo:** cercano a cero (Google Colab gratuito). **Meta realista en campo: F1 entre 0,70 y 0,85**, no 99 %.
**Clave:** cada observación con foto es dato de entrenamiento. Hay que empezar a fotografiar **ya**, aunque el modelo venga después.

### P3 — Asistente agronómico en español con RAG (semanas)

Base de conocimiento: publicaciones de Cenicafé, nuestras reglas agroclimáticas y el historial real de la finca. Responde preguntas como "¿qué hago con esta mancha?" o "¿cuándo fertilizo el Lote 2?", citando la fuente y los datos propios.
**Costo:** centavos por consulta. **Diferencial:** responde con *nuestros* datos, no con generalidades.

### P4 — Estimación de cosecha con dron (una cosecha)

Imagen aérea en floración → variables por árbol → conteo real en cosecha → modelo. El referente colombiano (Cauca, UAV multiespectral) reporta **R² ≈ 0,56**: útil, no mágico.
**Requisito:** protocolo de vuelo fijo, que el sistema ya exige. **La primera cosecha es el primer dataset.**

### P5 — Trampa inteligente de broca de bajo costo (meses)

ESP32-CAM o Raspberry Pi, trampa con atrayente y modelo YOLO entrenado con fotos propias de la trampa.
**Costo objetivo: 80 a 150 USD**, frente a 650–1.130 € de los comerciales. Línea con potencial de propiedad intelectual: **ningún producto comercial trae modelo de broca.**

---

## 7. Errores que debemos evitar

1. **Creer las precisiones publicadas.** Un 99 % en dataset curado puede ser 60 % en campo con sombrío, lluvia y hojas sucias. Validar siempre contra el criterio del agrónomo.
2. **Entrenar con imágenes de laboratorio** (hoja arrancada sobre fondo blanco) y usarlas con fotos de planta en campo. Por eso RoCoLe vale más que los datasets sintéticos.
3. **Confiar en el satélite para decisiones de lote** en ladera y con nubosidad alta. Para el detalle, dron; para la región, satélite apoyado en Sentinel-1.
4. **Comprar hardware antes de tener el caso de uso.** Primero medir, después automatizar.
5. **Diagnóstico autónomo.** Todo lo que salga del modelo es *apoyo al monitoreo*; la decisión es del agrónomo. Esto además nos protege legalmente.
6. **No etiquetar desde el principio.** Sin datos etiquetados no hay modelo propio, y el etiquetado es el cuello de botella real, no el algoritmo.

---

## 8. Plan de 90 días

| Semanas | Acción | Resultado |
|---|---|---|
| 1 | Implementar P1 (ventana crítica de roya y broca desde la floración) | Alertas con criterio Cenicafé |
| 1–2 | Conseguir el código SICA y revisar Alerta Roya, Alerta Broca y el atlas de la zona | Línea base oficial de la región |
| 1–12 | Fotografiar y etiquetar cada observación con el agrónomo (meta: 300 a 500 fotos propias) | Dataset semilla propio |
| 2–4 | Probar Plantix y Agrio en campo y anotar aciertos y errores | Línea base de comparación |
| 4–8 | Entrenar P2 con BRACOL, RoCoLe y fotos propias; medir F1 real | Primer modelo propio |
| 6–10 | Prototipo de P3 (asistente RAG con biblioteca de Cenicafé y datos de la finca) | Asistente en español |
| 8–12 | Protocolo de vuelo y primer vuelo en floración (P4) | Primer dataset aéreo |
| Continuo | Postular a AgroTECH (MinTIC), articular con el SENA y hacer contactos en Expo Agrofuturo | Financiación y aliados |

---

## 9. Fuentes

**Colombia y café**

- Plataforma Agroclimática Cafetera — Cenicafé: https://agroclima.cenicafe.org/ (Alerta Roya, Alerta Broca, Atlas, Geoportal, Boletín Agrometeorológico)
- Cenicafé: https://www.cenicafe.org/
- Fedecafé y Cenicafé lanzan la Plataforma Agroclimática: https://www.contextoganadero.com/agricultura/fedecafe-y-cenicafe-lanzan-moderna-plataforma-agroclimatica
- Uso de IA en la detección de la roya del café (Dialnet): https://dialnet.unirioja.es/descarga/articulo/9873192.pdf
- Integración de la IA y la agricultura de precisión en cultivos de café: https://www.researchgate.net/publication/386344778_Integracion_de_la_inteligencia_artificial_y_la_agricultura_de_precision_en_cultivos_de_cafe
- Semáforo para estimar el riesgo de roya en cafetales: https://zenodo.org/records/12191018
- DEC — Detección en Café: https://dec-app.online/
- Startups colombianas con IA en el agro (incluye Semillatech): https://gestionynegocios.co/startups-tecnologicas-colombianas-apuestan-por-inteligencia-artificial-para-transformar-el-agro/
- AgroTECH (MinTIC): https://www.mintic.gov.co/portal/715/w3-article-276923.html
- Expo Agrofuturo 2026: https://www.valoraanalitik.com/agro-colombia-expoagrofuturo-2026-corferias/

**Datasets y modelos abiertos**

- RoCoLe (hoja de café en campo real): https://www.sciencedirect.com/science/article/pii/S2352340919307693
- CoLeaf-DB (deficiencias nutricionales): https://www.researchgate.net/publication/370692811_CoLeaf-DB_Peruvian_coffee_leaf_images_dataset_for_coffee_leaf_nutritional_deficiencies_detection_and_classification
- Detección de enfermedades y plagas de hoja de café con modelos YOLO: https://www.mdpi.com/2076-3417/15/9/5040
- YOLOv8 con RAG para diagnóstico de café y asistencia al caficultor: https://arxiv.org/html/2505.21544v1
- RAG para remediación de enfermedades del café: https://arxiv.org/pdf/2405.01310
- Detección de broca con YOLO optimizado y fog computing (2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC13075308/
- AgroGPT (modelo visión-lenguaje agrícola): https://www.researchgate.net/publication/390618855_AgroGPT_Efficient_Agricultural_Vision-Language_Model_with_Expert_Tuning
- VLM-MCPDD (diagnóstico multicultivo interpretable): https://doi.org/10.3390/app16115719

**Plataformas y hardware comercial**

- Comparativa de plataformas de monitoreo de cultivos: https://cropaia.com/blog/best-crop-monitoring-software-platforms/
- xarvio Field Manager: https://www.xarvio.com/us/en/products/field-manager.html
- Trapview: https://trapview.com/scouting/
- iSCOUT (Pessl/METOS): https://metos.global/en/iscout/
- FarmSense FlightSensor: https://farmsense.io/our-product-farmsense-flightsensor/
- Evaluación crítica de apps de diagnóstico de enfermedades: https://arxiv.org/pdf/2208.02446
- Guía de precios de sensores IoT agrícolas: https://agriculturaia.com/sensores-iot-agricultura-guia-compra-precios/

**Asistentes conversacionales**

- Farmer.Chat (Digital Green con OpenAI): https://openai.com/index/digital-green/
- Farmer.Chat, artículo técnico: https://arxiv.org/html/2409.08916v1

**Teledetección**

- Sentinel óptico y radar para café de pequeños productores: https://www.sciencedirect.com/science/article/abs/pii/S0034425721004296
- Sentinel-2 para estimación de rendimiento (revisión sistemática): https://arxiv.org/pdf/2603.23779

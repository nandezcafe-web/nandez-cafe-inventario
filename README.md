# Nández Café · Servidor del sistema de cultivo, transformación y contabilidad

MVP 0 del plan maestro (Chinácota, Norte de Santander): un sistema interno para **medir, registrar, alertar** y empezar la **inteligencia de subproductos**. La finca es el primer laboratorio de campo.

- **Stack:** Node.js 24, Express 5. La base es **SQLite** en el computador y **Postgres (Supabase)** en línea: el mismo código corre en las dos, a través de la capa de [src/db/](src/db/index.js).
- **Datos en el computador:** un solo archivo, `data/cafe.db`, más las fotos en `data/uploads/`. **En línea:** Supabase para la base y Supabase Storage para las fotos; Vercel sirve el panel y corre el servidor como funciones. Cómo ponerlo en línea: [DESPLIEGUE.md](DESPLIEGUE.md).
- **En línea:** <https://nandez-cafe-inventario.vercel.app> (Vercel en Oregon + Supabase en us-west-2, plan gratis). Cada persona entra con su enlace personal, que lleva su clave; los enlaces viven en `ENLACES-EN-LINEA.md`, que no se sube al repositorio.
- **Panel web:** `http://localhost:3000` en el computador, o la dirección de arriba; pensado para computador y celular.
- **Pruebas:** `npm test` corre las pruebas sobre SQLite; `BD_PRUEBAS=pglite:memoria npm run test:postgres` corre **las mismas** sobre un Postgres real dentro de Node (PGlite), sin tocar Supabase.
- **Navegación:** cinco áreas fijas (**Hoy · Café · Cultivo · Biomasa · Finca**) y, dentro de cada una, sus secciones. El área recuerda en qué sección se quedó.
- **El café comprado y el cultivo propio no se mezclan.** **Hoy** es el tablero del café que se compra y transforma: inventario, costo del kg tostado, el siguiente paso del proceso y los pendientes del café. El cultivo de la finca tiene su propio resumen en **Cultivo → Resumen** (plantas, clima, alertas agronómicas, lotes). Las alertas vienen marcadas con `grupo: "cafe"` o `grupo: "cultivo"` y cada área muestra solo las suyas; si hay alertas altas del cultivo, el inicio lo dice en una línea sin llenarse de ellas.

## Arranque

```bash
npm install
```

```bash
npm start
```

La primera vez se crean la base de datos, la finca (13 ha, coordenadas 7.590401, −72.592821), el Lote 1 (1.500 plantas), el Lote 2 (3.000 plantas) y 8 ideas de oportunidad para evaluar. Los datos que había que confirmar (altitud, variedades, fechas de siembra) quedaron vacíos y aparecen en **Datos pendientes** del resumen.

Opcional: copie `.env.example` como `.env` para cambiar el puerto, la ruta de datos o el token.

### Quién registró cada cosa

Con `API_TOKEN` todos entran con la misma clave y los registros quedan sin
nombre. Con `USUARIOS=Nombre:clave,Otro:clave` cada persona tiene la suya, y el
servidor marca cada lote, proceso, venta y gasto en `registrado_por` según la
clave con la que se entró. Ese campo **no sale en los formularios** y no se
puede cambiar después: ni mandándolo en el cuerpo de la petición, ni editando el
registro, ni con un `PUT` completo. `GET /api/yo` dice quién está entrando, y el
panel lo muestra en el inicio y en Registrar.

Las dos formas conviven, para poder cambiar sin cortar el acceso. Cuando todos
tengan su clave propia, borre `API_TOKEN` para que ningún registro quede sin
nombre.

### Usarlo desde el celular en la finca

En `.env` ponga `HOST=0.0.0.0` y un `API_TOKEN` largo. Al arrancar, el servidor muestra la dirección de red local (p. ej. `http://192.168.1.20:3000`). El panel pide el token la primera vez.

### Pruebas

```bash
npm test
```

## Módulos

| Módulo (plan §28) | Recurso API | Notas |
|---|---|---|
| Finca | `fincas`, `lotes` | Lote con variedad, plantas, fecha de siembra, estado, polígono GeoJSON |
| Actividades | `actividades` | Fertilización, poda, tratamientos, arvenses…; producto, dosis, jornales, costo |
| Observaciones | `observaciones` | Categoría, problema, severidad 1–5, incidencia %, GPS, estado, fotos |
| Floración | `floraciones` | Evento de primera clase; calcula la ventana orientativa de cosecha (~30–35 semanas) |
| Clima | `clima` | Manual, estación, sensor u **Open-Meteo** (sincronización automática) |
| Suelo | `suelo` | Laboratorio o sensor: pH, CE, MO, humedad y nutrientes en JSON |
| Imágenes | `vuelos` | Protocolo de dron: altura, velocidad, solapes, luz, cámara, rutas de archivos |
| Producción | `cosechas` | kg cereza/pergamino, proceso, humedad, factor, puntaje de taza |
| Subproductos | `subproductos` | Inventario de partidas: tipo, kg, humedad, origen, costos, producto obtenido |
| Red regional | `productores` | Ubicación, variedades, producción, beneficio, disposición a entregar |
| Matriz (§35) | `oportunidades` | 15 criterios de 1 a 5 (5 = más favorable) → índice de 0 a 100 |
| Trazabilidad | `lotes_cafe` | Lote comprado o propio: kg, precio pagado, variedad, humedad. Es la unidad que se sigue de principio a fin |
| Transformación | `procesos_cafe` | Cada paso (trilla, tueste, molienda, empaque) con kg que entran, kg que salen y sus costos |
| Catálogo | `presentaciones` | Lo que compra el cliente: bolsa de 250 g molido, libra en grano, kilo para cafetería |
| Ventas | `ventas` | Fecha, lote, presentación, canal, unidades, precio y estado de pago |
| Gastos | `gastos` | Operativos o inversión; con lote si son de ese lote, sin lote si se reparten |

Todos los recursos tienen el mismo CRUD:

```
GET    /api/<recurso>?campo=valor&desde=AAAA-MM-DD&hasta=…&q=texto&orden=campo&dir=asc&limite=200&offset=0
GET    /api/<recurso>/:id
POST   /api/<recurso>
PUT    /api/<recurso>/:id      (reemplazo completo)
PATCH  /api/<recurso>/:id      (solo los campos enviados)
DELETE /api/<recurso>/:id      (409 si otros registros dependen de él)
```

### Predicción, prevención y plan de cultivo

El sistema usa las coordenadas de la finca para vigilar qué puede pasar y cuándo conviene hacer cada labor.

| Ruta | Qué hace |
|---|---|
| `GET /api/prediccion` | Últimos 30 días y pronóstico a 16 días. Incluye **riesgos** con evidencia y recomendaciones (lluvias intensas, déficit hídrico/sequía, condiciones para roya y broca, calor, frío, viento, floración probable y El Niño/La Niña) y **ventanas de labores**: qué días son aptos para fertilizar, fumigar, controlar arvenses, podar, sembrar, volar el dron o cosechar y secar |
| `GET /api/prediccion/climatologia` | Qué suele pasar mes a mes en la ubicación (10 años de ERA5): lluvia media, año seco y lluvioso, temperatura, balance hídrico, temporada, y **qué esperar en los próximos 3 meses** |
| `GET /api/prediccion/enso` | Índice ONI de NOAA y fase de El Niño/La Niña |
| `POST /api/plan/generar` | `{lote_id, desde?, etapa?, reemplazar?}`: crea el plan base del lote según su etapa (vivero, levante, producción, renovación) |
| `GET /api/plan/agenda?dias=30` | Tareas pendientes, atrasadas y repeticiones proyectadas, con el **mejor día según el pronóstico** dentro de la ventana de cada tarea |
| `POST /api/plan/:id/completar` | Registra la labor en `actividades`, marca la tarea como hecha y programa la siguiente |
| `plan_labores` (CRUD) | Editar las tareas: producto, dosis, frecuencia, ventana de días, prioridad |

**Monitoreo automático:** mientras el servidor está encendido, cada `CLIMA_AUTO_HORAS` (3 por defecto) sincroniza el clima horario y recalcula los riesgos. Los riesgos altos y medios aparecen en las alertas del resumen, junto con las tareas atrasadas del plan.

**Sobre los modelos de clima:** en esta ubicación de montaña, el modelo por defecto de Open-Meteo (ECMWF de 9 km) llegó a dar entre 5 y 6 veces más lluvia que otros modelos. Por eso el pronóstico usa la **mediana de ECMWF 0,25°, GFS e ICON** (configurable con `CLIMA_MODELOS`), muestra el rango entre modelos como incertidumbre, y la climatología usa **ERA5** (≈1.680 mm/año). Un pluviómetro en la finca permite verificar y calibrar estos valores.

Los umbrales y recomendaciones están en [src/conocimiento/agroclima.js](src/conocimiento/agroclima.js) y las plantillas del plan en [src/conocimiento/plan_cultivo.js](src/conocimiento/plan_cultivo.js). Ambos son versiones iniciales para revisar y ajustar con el agrónomo.

### Mapa de la finca y clima sobre el mapa

Sección **Mapa** del panel:

- **Terreno:** imagen satelital (Esri), relieve con curvas de nivel (OpenTopoMap) o calles (OpenStreetMap).
- **Lotes:** se dibuja el borde tocando las esquinas en el mapa o caminando el lote con **📍 Punto GPS** desde el celular. Los vértices se pueden arrastrar, el área se calcula sola y se guarda en `lotes.geometria` (GeoJSON).
- **Observaciones y productores** con coordenadas aparecen como puntos. Al tocar el mapa se puede crear una observación en ese lugar.
- **Clima sobre el mapa:** cuadrícula regional (7×7 celdas de ~22 km) con **lluvia**, **viento** (flechas hacia donde sopla), **sol y nubes** y **calor**, más una barra de tiempo con ▶ para las próximas 72 horas cada 3 horas. El panel lateral muestra el detalle de la finca: temperatura, sensación térmica, lluvia, dirección del viento, nubosidad, radiación, UV, amanecer, atardecer y horas de sol.
- **Animación regional (Windy):** mapa animado de Windy.com (servicio externo) con lluvia, viento, nubes, temperatura, humedad y tormentas.

| Ruta | Qué hace |
|---|---|
| `GET /api/mapa/capas` | Finca, lotes con polígono y centro, observaciones y productores con coordenadas |
| `GET /api/mapa/clima?n=7&paso=0.2&horas=72` | Clima horario por celda (mediana de modelos; viento con promedio vectorial) y detalle de la finca. Caché de 1 hora |

La resolución de los modelos es de ~13–28 km: el mapa de clima muestra cómo se mueven lluvias, vientos y nubes en la región, no diferencias entre lotes. Para eso se necesitan sensores o una estación en la finca.

### Contabilidad, costos e inventario

El café entra con un costo (compra o cosecha) y cada proceso le suma costos y le quita kg. Dividiendo costo acumulado entre los kg que **realmente salieron** se obtiene el costo por kg en cada estado: pergamino, verde, tostado, molido. Ese número es el que sirve para fijar precios y para valorizar el inventario.

```
51 kg pergamino ($22.000/kg)  →  trilla (≈81 %)  →  41 kg verde  →  tueste (≈85 %)  →  35 kg tostado
$1.122.000                       + maquila          $27.900/kg      + mano de obra     $35.000/kg aprox.
```

Sección **Registrar proceso** del panel: pensada para el celular en la trilladora o frente a la tostadora. Se elige el lote, se toca qué se hizo —solo aparecen con ✓ los procesos posibles con lo que hay en el lote— y se escriben los kg. Los estados de entrada y salida se deducen del tipo de proceso; los kg que entran vienen prellenados con lo disponible; mientras se escribe los kg que salen, el rendimiento se compara en vivo con lo esperado y avisa si no puede salir más de lo que entró. Los costos son opcionales y se pueden completar después. La cascarilla o la pulpa pasan de una vez al inventario de **Subproductos**.

| Ruta | Qué hace |
|---|---|
| `GET /api/costos/lote/:id` | Cadena completa de un lote: entrada, cada proceso con su rendimiento y su costo, costo por kg en cada estado, inventario disponible y **avisos** cuando un peso no cuadra o el rendimiento se sale de lo esperado |
| `GET /api/costos/lotes` | Resumen de todos los lotes para la lista del panel |
| `POST /api/costos/simular` | **Antes de comprar:** `{kg, precio_cop_kg, estado_inicial, estado_final, perfil_tueste?, costos_proceso_cop_kg?}` → cuántos kg tostados salen (rango min/típico/máx) y a cómo queda el kg |
| `GET /api/inventario` | Café disponible por estado y por lote, valorizado al costo |
| `POST /api/precios/sugerir` | Precio recomendado: `{costo_cop_kg, gramos, costo_empaque_cop, gastos_generales_cop_kg, iva_pct?, precio_actual_cop?, costos_fijos_mes_cop?}` → precio por canal, precio mínimo, evaluación del precio actual y punto de equilibrio |
| `GET /api/precios/lote/:id` | Precio recomendado de cada presentación con el costo real de ese lote |
| `GET /api/costos/gastos-por-kg` | Gastos sin lote ÷ kg tostados del periodo: lo que hay que repartir al fijar precios |
| `GET /api/contabilidad/resultados?desde=&hasta=` | Estado de resultados: ingresos, costo de lo vendido, margen bruto, gastos, utilidad, por canal, compras y cuentas por cobrar |
| `GET /api/costos/conocimiento` | Rendimientos de referencia, perfiles de tueste, canales y márgenes |

Criterios:

- **El margen se calcula sobre el precio de venta**, no sobre el costo: `precio = costo ÷ (1 − margen)`. Sumarle 40 % al costo no es ganar 40 %.
- **El empaque se cobra una sola vez.** Las bolsas y las etiquetas van en `costo_empaque_cop` de cada presentación, así que los gastos de categoría `empaque` y `etiquetas` **no** entran al gasto general por kg: si entraran, cada bolsa pagaría su empaque dos veces. En el estado de resultados sí cuentan, porque es plata que salió. Los dos números se reportan aparte en `/api/costos/gastos-por-kg`.
- **Ojo con repartir gastos sobre pocos kg.** Un gasto grande de una sola vez (un equipo, el diseño de los empaques, insumos para varios meses) dividido entre los kg de un mes flojo infla el costo del kg y lleva a poner precios irreales. El sistema avisa cuando hay menos de 100 kg en el periodo y cuando los gastos generales pesan más del 40 % de lo que cuesta el café. Lo que es inversión se marca con `tipo_costo: "inversion"`.
- **Las inversiones se amortizan, no se cargan de golpe.** Una tostadora no es un costo de octubre: sirve varios años. Al gasto de inversión se le pone `amortizar_meses` (tostadora ~60, molino ~36, diseño de empaques ~24) y de ahí sale una cuota mensual `valor ÷ meses`. Cada periodo paga solo los meses que le corresponden, y pasada la vida útil la inversión deja de cargar costo. Esa cuota entra en dos lados: como **depreciación** en el estado de resultados y dentro del **gasto general por kg** al fijar precios. Una inversión **sin** `amortizar_meses` no carga nada, y el sistema lo avisa en vez de pasarlo por alto.

  El efecto no es menor. En el escenario de prueba (septiembre–octubre, 42,5 kg tostados), con la tostadora de $6.200.000 y el diseño de empaques de $400.000 sin vida útil, el gasto general salía en $17.647/kg y el periodo cerraba con **−$62.072**. Poniéndole 60 y 24 meses: el gasto general baja a **$13.490/kg** (el diseño dejó de caer entero sobre dos meses), la depreciación aparece como $223.333 y el periodo cierra en **+$114.595**.
- **Valor residual: no se amortiza lo que el equipo va a seguir valiendo.** Con `valor_residual_cop` la cuota se reparte sobre `valor − residual`, no sobre el valor completo. Una tostadora de $6.200.000 que al final de sus 60 meses valdrá $1.200.000 amortiza $5.000.000, o sea $83.333 al mes en vez de $103.333. Si el residual queda igual o mayor que el valor, no amortiza nada y el sistema lo dice.
- **Vender un equipo cierra su amortización y deja ganancia o pérdida.** Con `fecha_venta` la amortización se detiene ese mes (el mes de la venta todavía paga su cuota) y lo que quedaba sin amortizar es el **valor en libros**. La diferencia entre `valor_venta_cop` y ese valor en libros es ganancia si se vendió por más y pérdida si fue por menos, y se reconoce en el periodo de la venta. No es operación del café, así que va **después** de la utilidad operativa, en una línea aparte y en un `resultado_periodo_cop` propio. Un equipo marcado como vendido sin anotar por cuánto se cuenta como pérdida total de lo que quedaba en libros, y el sistema avisa. Un equipo sin vida útil que se vende pierde todo su valor de golpe, porque nunca amortizó nada.
- **Costo promedio ponderado por estado.** Si se tuestan dos tandas del mismo lote con costos distintos, el kg tostado del lote vale el promedio.
- **La báscula manda.** Los rendimientos de [src/conocimiento/procesos_cafe.js](src/conocimiento/procesos_cafe.js) solo sirven para estimar antes de pesar y para avisar cuando un pesaje real se sale del rango. Si un proceso no tiene `kg_salida`, el sistema lo estima y lo marca como estimado.
- **Los gastos de inversión no castigan el mes en que se pagaron.** Se registran con `tipo_costo: "inversion"` y no entran a los gastos operativos del periodo: lo que entra es su cuota de amortización, según la regla de arriba.
- **El IVA es el que usted indique.** El café tostado en Colombia suele estar al 5 % y la venta de pergamino del productor puede tener otro tratamiento: confírmelo con su contador.
- **Alertas del negocio** en el resumen: café tostado sin vender hace más de 25 días (frescura), precios de lista por debajo del costo y pesos de proceso que no cuadran.

### Inteligencia de biomasa

| Ruta | Qué hace |
|---|---|
| `GET /api/resumen` | Panel: lotes, lluvia y temperatura de 7 días, labores de 30 días, cosecha del año, biomasa disponible, **alertas** y **datos pendientes** |
| `POST /api/biomasa/evaluar` | **"Tengo X kg de Y"**: `{tipo, kg, humedad_pct?, horas_desde_generacion?}` → materia seca, agua, volumen, cereza de origen y usos ordenados por viabilidad, con producto estimado, equipos, regulación y riesgos |
| `GET /api/biomasa/generacion?kg_cereza=1000&proceso=lavado` | Subproductos esperados según el proceso de beneficio |
| `GET /api/biomasa/inventario` | Biomasa disponible por tipo, origen y fuente |
| `GET /api/biomasa/conocimiento` | Base de conocimiento completa |
| `POST /api/logistica/costo` | **Costo puesto en planta** (§26): viajes por peso y volumen, transporte, compra, mano de obra, secado, COP/kg fresco y seco, riesgo de deterioro. Con `productor_id` estima la distancia |
| `GET /api/oportunidades-ranking` | Ranking por índice; pesos opcionales `?peso_demanda=2` |
| `POST /api/clima/sincronizar` | `{finca_id, dias≤92}`: descarga el clima horario de Open-Meteo (solo horas ya ocurridas; no duplica) |
| `GET /api/clima/diario` | Mínima, media y máxima, humedad y lluvia por día |
| `POST /api/adjuntos` | `multipart`: `entidad`, `entidad_id`, `archivos[]` (imágenes, PDF o CSV de hasta 25 MB) |
| `GET /api/exportar/<recurso>.csv` | CSV para Excel (separador `;`); acepta los mismos filtros |
| `GET /api/respaldo` | Descarga toda la base en un archivo `.sqlite`. Usa `VACUUM INTO`, no copia el archivo en caliente: el resultado es consistente y se puede abrir con cualquier herramienta de SQLite. Exige la clave como el resto de `/api`. El enlace está en el inicio, en "Qué hay registrado" |
| `GET /api/esquema` | Modelo de datos (el panel genera los formularios a partir de él) |

## Criterios importantes

- **Las cifras de subproductos son rangos orientativos.** Están en [src/conocimiento/subproductos.js](src/conocimiento/subproductos.js), cada una con su nivel de confianza y sus referencias (Cenicafé y revisiones científicas del plan maestro). A medida que haya pesajes, análisis de laboratorio y prototipos, hay que reemplazarlas por datos propios. Ese archivo es el corazón del futuro "motor de biomasa".
- **Las alertas son reglas simples y explicables** (nivel 3 del plan), no diagnósticos: severidad alta sin resolver, observaciones sin seguimiento, lotes sin registros, cosecha próxima según la floración, biomasa perecedera vencida y falta de datos de clima.
- **Open-Meteo es un modelo, no una medición.** Sirve de referencia hasta que haya estación en la finca; en el resumen, los datos de estación o sensor tienen prioridad.
- **El modelo de datos se define una sola vez** en [src/resources.js](src/resources.js). Al agregar un campo ahí, la tabla se actualiza sola al arrancar y el campo aparece en la API y en el panel. Renombrar o eliminar columnas sí requiere una migración manual.

## Demostración para compartir

```bash
npm run demo
```

Genera `demo/cafe-demo.html`: **un solo archivo** que se abre con doble clic, sin servidor, con una foto de los datos del momento (inicio, predicción y riesgos, mapa y clima, plan de cultivo, calculadora "Tengo X kg de…" y hoja de ruta del proyecto). Sirve para enviarlo por WhatsApp o correo. **Funciona sin internet**, incluido el mapa: la librería de mapas y 134 imágenes satelitales (región, municipio y finca) van dentro del archivo, que pesa unos 3 MB. Con conexión usa las imágenes en vivo, que son más nítidas. Para una versión liviana sin imágenes incrustadas: `npm run demo -- --sin-mosaicos`. Regenérelo antes de enviarlo para que el pronóstico esté al día. Incluye las coordenadas de la finca: compártalo solo con personas de confianza.

## Respaldo

Detenga el servidor y copie la carpeta `data/` completa, o exporte los CSV desde el panel. Conviene hacerlo al menos cada semana, en otro disco o en la nube.

## Estructura

```
src/
  server.js              arranque
  app.js                 rutas, token, errores
  config.js
  resources.js           modelo de datos (fuente única)
  db/index.js            conexión y migración automática
  db/semilla.js          datos iniciales de la finca
  lib/                   CRUD genérico, validación, derivados, biomasa, logística
  routes/                resumen, clima, adjuntos, exportar, inteligencia
  conocimiento/          base de conocimiento de subproductos
public/                  panel web (sin compilación)
test/                    pruebas (node:test)
```

## Próximos pasos sugeridos

1. Completar los datos pendientes (altitud, variedad, fechas de siembra y etapa de cada lote) y cargar los análisis de suelo y agua existentes. Revisar el plan base con el agrónomo (productos, dosis y frecuencias).
2. Registrar labores y observaciones desde el celular a partir de hoy (Riesgo 2 del plan: sin datos no hay predicción).
3. Definir el protocolo fijo de vuelo y registrar cada vuelo.
4. Levantar el censo de las 30+ fincas vecinas en `productores`.
5. Instalar una estación meteorológica y sensores de suelo, que se integran enviando `POST /api/clima` y `POST /api/suelo` con `fuente: "estacion"`/`"sensor"`.
6. Calificar las oportunidades con el agrónomo o el SENA y elegir los 3 primeros experimentos.

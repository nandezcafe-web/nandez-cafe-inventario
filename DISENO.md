# Sistema de diseño · Nández Café

El panel se ve y se usa como una app de iPhone: fondo gris agrupado, tarjetas y
listas sin bordes, títulos grandes y **una sola tinta de acento, el café**.
Todo sale de los tokens de [public/estilos.css](public/estilos.css).
**Regla:** en un componente no se escriben colores, tamaños ni radios sueltos.
Si falta un valor, se agrega como token aquí y en `:root`.

## Principios

1. **Una acción principal por pantalla.** El botón lleno de café es lo que se
   hace ahora: "Trillar 75 kg", "Guardar", "Entrar". El resto es gris o texto.
2. **El acento marca, no decora.** Lo seleccionado o lo que tiene café va
   *teñido* (`--tinte` con texto `--marca`); el color lleno se reserva para la
   acción principal y el botón +.
3. **Cifra arriba, qué es abajo.** Los números en grande y en tabulares; la
   etiqueta corta y en gris. Sin dato, se dice cuándo lo habrá ("Se sabe al
   tostar"), nunca un guion solo.
4. **Listas antes que tablas.** En el celular, cada registro es una fila:
   nombre, detalle gris, cifra a la derecha y chevron. La tabla queda como
   opción para revisar en el computador.
5. **Poco menú.** Cuatro pestañas, cuatro segmentos por área como máximo; lo
   que se usa poco se abre desde donde se necesita.

## Tokens

### Color

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--fondo` | `#f2f2f7` | `#000000` | Fondo agrupado de la página |
| `--superficie` | `#ffffff` | `#1c1c1e` | Tarjetas, listas, widgets |
| `--campo` | `#ffffff` | `#2c2c2e` | Campos de formulario |
| `--relleno` | `#e9e9ee` | `#2c2c2e` | Pistas, botones secundarios, toque |
| `--borde` | `#e2e2e7` | `#38383a` | Separadores de 0,5 px |
| `--vidrio` | blanco 82 % | negro 82 % | Barras con desenfoque |
| `--texto` | `#1c1c1e` | `#f2f2f7` | Etiqueta principal |
| `--suave` | `#6c6c70` | `#a1a1a6` | Etiqueta secundaria (AA sobre blanco y negro) |
| `--tenue` | `#8e8e93` | `#8e8e93` | Solo íconos y chevrones, **nunca texto** |
| `--marca` | `#8a5530` | `#e0a878` | Acción principal, selección, enlaces |
| `--sobre-marca` | `#ffffff` | `#1c1209` | Texto sobre `--marca` |
| `--tinte` | café 12 % | café 16 % | Fondo de lo seleccionado |
| `--verde` · `--alta` · `--media` · `--info` | | | Bien · error/alerta alta · aviso · información |

### Tipografía

Fuente del sistema (San Francisco en iPhone y Mac, Segoe en Windows).

| Token | Tamaño | Uso |
|---|---|---|
| `--t-grande` | 34 | Título grande de cada página |
| `--t-titulo` | 22 | Título de hoja ("Registrar") |
| `--t-seccion` | 20 | Título de tarjeta, estado vacío, cifra del camino |
| `--t-cifra` | 26 | Número de un widget |
| `--t-cuerpo` | 17 | Filas de lista, campos, botón principal |
| `--t-sub` | 15 | Texto de apoyo, enlaces de tarjeta, valor de fila |
| `--t-nota` | 13 | Detalle gris, títulos de grupo en mayúsculas |
| `--t-mini` | 11 | Insignias |

Pesos: 700 títulos y cifras · 600 énfasis · 500 controles · 400 filas.

### Espacio, radios, elevación y movimiento

- **Espacio:** `--e-1` 4 · `--e-2` 8 · `--e-3` 12 · `--e-4` 16 · `--e-5` 20 · `--e-6` 24 · `--e-8` 32. Márgenes de página: 16 en el celular, 20 en el computador.
- **Radios:** `--r-chico` 10 (campos, botones, pasos) · `--r-medio` 14 (tarjetas, listas, widgets) · `--r-grande` 20 (hojas, ícono de la app) · `--r-pildora`.
- **Elevación:** `--sombra-1` (segmento elegido) · `--sombra-2` (avisos, botón +). Las tarjetas no llevan sombra.
- **Movimiento:** `--m-rapido` 0,2 s (toques) · `--m-normal` 0,32 s (hojas) · `--curva`. Con "reducir movimiento" se apaga todo.

### Cortes

- **< 760 px (celular):** pestañas abajo, segmentos fijos arriba, hojas desde abajo.
- **760–899 px (tableta):** barra arriba con íconos; solo la pestaña elegida muestra su nombre.
- **≥ 900 px (computador):** barra arriba con íconos y nombres. Contenido en una columna de 860 px; tablas y mapa hasta 1100 px.

## Componentes

| Componente | Clase | Cuándo |
|---|---|---|
| Barra de pestañas | `#pestanas` / `#nav` | Navegación principal: Hoy · Café · + · Dinero · Campo. La insignia (`.punto`) cuenta alertas. |
| Control segmentado | `.segmentado-ios` | Hasta 4 secciones hermanas (Café, Dinero) o Lista/Tabla (`.mini`). |
| Volver | `.volver` | Sección sin segmento: "‹ Campo", "‹ Precios". |
| Título grande | `.titulo-grande` | Arriba de cada página; `.sobre` para fecha o conteo; `.con-accion` con el botón redondo +. |
| Widget | `.widget` | Una cifra y qué es. Siempre de a 2 (celular) o 4 (pantalla ancha). |
| Camino del café | `.camino` | Los kg en cada estado; el paso con café va teñido. |
| Lista agrupada | `.lista-titulo` + `.lista` + `.fila` | Casi todo: registros, negocio, pendientes, la portada de Campo. Partes de la fila: `.fila-punto` (estado), `.fila-txt` (b: título, span: detalle), `.fila-valor`, `.chevron`. |
| Botones | `button` · `.primario` · `.enlace` · `.peligro` · `.boton-redondo` | Primario: una por pantalla. Enlace: acciones de barra (Cancelar, Guardar, Exportar). Peligro: borrar. |
| Hoja | `dialog` · `.hoja` | Formularios y el menú del +. Sube desde abajo en el celular; Cancelar a la izquierda, Guardar a la derecha. |
| Estado vacío | `.vacio` | Qué es la sección, para qué sirve y un botón para empezar. |
| Aviso | `#aviso` | Píldora arriba al guardar o borrar ("✓ Guardado a nombre de Maick"). |
| Alerta | `.alerta` (`.alta`, `.media`) | Mensajes dentro de páginas de cálculo (costos, precios). En listas se usa `.fila-punto`. |

## Hacer y no hacer

| ✅ Hacer | ❌ No hacer |
|---|---|
| Una acción llena de café por pantalla | Dos botones llenos que compiten |
| Teñir lo seleccionado con `--tinte` | Rellenar de café tarjetas o pasos |
| Unidades pequeñas junto al número (`40,8 kg`) | Unidad en otra línea, lejos del número |
| Widgets en filas completas (2 o 4) | Un widget solo en la última fila |
| Decir cuándo habrá dato | Un "—" sin explicación |
| `--suave` para texto gris | `--tenue` para texto (no pasa contraste) |

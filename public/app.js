// Panel web del sistema de seguimiento del café.
// Los formularios y tablas se generan a partir de /api/esquema.

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const vista = $('#vista');
const dialogo = $('#dialogo');
const formDialogo = $('#form-dialogo');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titulo = (s) => String(s).replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const fmt = (n, dec = 0) => (n == null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: dec }));
const hoy = () => new Date().toLocaleDateString('sv-SE');

let esquema = null;
let usuario = null; // nombre de quien entró, si usa clave propia
const cacheEtiquetas = {};

function avisar(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => el.classList.remove('visible'), 3500);
}

function token() {
  try { return localStorage.getItem('cafe_token') || ''; } catch { return ''; }
}

async function api(ruta, { metodo = 'GET', cuerpo, formData } = {}) {
  const headers = {};
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`/api${ruta}`, {
    method: metodo, headers, body: formData ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
  });
  // Sin clave o con clave equivocada: se marca el error para mostrar la pantalla
  // de acceso. Antes esto usaba prompt(), que no existe en varios navegadores de
  // celular ni dentro de apps, y dejaba el panel sin salida.
  if (resp.status === 401) {
    const e = new Error('Se necesita la clave de acceso');
    e.auth = true;
    throw e;
  }
  if (resp.status === 204) return null;
  const esJson = resp.headers.get('content-type')?.includes('json');
  const datos = esJson ? await resp.json() : await resp.blob();
  if (!resp.ok) {
    const err = new Error(datos?.error ?? `Error ${resp.status}`);
    err.detalles = datos?.detalles;
    throw err;
  }
  return datos;
}

// ---------- Acceso ----------

// Pantalla para escribir o pegar la clave. Reemplaza al prompt() del navegador:
// se puede pegar, se puede corregir y dice dónde encontrarla.
function pantallaAcceso(aviso = '') {
  $('#nav').innerHTML = '';
  $('#pestanas').innerHTML = '';
  $('#subnav').innerHTML = '';
  vista.innerHTML = `
    <div class="acceso">
      <div class="acceso-logo" aria-hidden="true">☕</div>
      <h1>Nández Café</h1>
      <p class="suave">Entre con su clave personal. Viene en el enlace que le mandó Maick; si no lo tiene, pídaselo. Se pide una sola vez en cada celular.</p>
      ${aviso ? `<div class="alerta alta">${esc(aviso)}</div>` : ''}
      <form id="f-acceso">
        <div class="lista"><div class="fila fila-campo">
          <label for="ac-token" class="oculto">Clave</label>
          <input id="ac-token" name="token" type="text" placeholder="Clave" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        </div></div>
        <button class="primario ancho-total">Entrar</button>
      </form>
    </div>`;

  $('#f-acceso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = $('#ac-token').value.trim();
    if (!valor) return;
    ev.target.querySelector('button').disabled = true;
    try { localStorage.setItem('cafe_token', valor); } catch { /* sin almacenamiento */ }
    try {
      await arrancar();
    } catch (e) {
      try { localStorage.removeItem('cafe_token'); } catch { /* sin almacenamiento */ }
      pantallaAcceso(e.auth ? 'Esa clave no es la correcta. Pegue la que viene en su enlace personal, completa.' : e.message);
    }
  });
  $('#ac-token').focus();
}

// ---------- Navegación ----------

// Cuatro pestañas y un botón para registrar, como una app de iPhone:
//   Hoy · Café · [+] · Dinero · Campo
// Café y Dinero tienen cuatro secciones cada una, en un control segmentado
// arriba de la página. Campo junta el cultivo, la biomasa y la finca: su
// portada es una lista agrupada y cada sección abre con "‹ Campo" para volver.
// Lo que se usa poco (Registrar, Productos) no ocupa un segmento: se llega
// desde el botón + o desde la página que lo necesita.
const GRUPOS_CAMPO = [
  ['Finca', [
    ['lotes', 'Lotes', 'Plantas, variedad y estado de cada lote'],
    ['mapa', 'Mapa', 'Los lotes, el clima y los vuelos sobre el mapa'],
    ['fincas', 'Datos de la finca'],
    ['productores', 'Productores', 'A quién se le compra y quién nos vende'],
  ]],
  ['Cultivo', [
    ['plan', 'Plan del mes', 'Qué toca hacer y cuándo, según el clima'],
    ['plan_labores', 'Tareas'],
    ['actividades', 'Labores hechas'],
    ['observaciones', 'Observaciones', 'Plagas, enfermedades, lo que se vio'],
    ['floraciones', 'Floraciones'],
    ['cosechas', 'Cosechas'],
  ]],
  ['Clima y suelo', [
    ['prediccion', 'Predicción y riesgos', 'Lluvia, roya y broca para los próximos días'],
    ['clima', 'Clima'],
    ['suelo', 'Análisis de suelo'],
    ['vuelos', 'Vuelos de dron'],
  ]],
  ['Biomasa', [
    ['tengo', 'Tengo X kg de…', 'Qué se puede hacer con un subproducto'],
    ['subproductos', 'Partidas'],
    ['logistica', 'Costo puesto en planta'],
    ['oportunidades', 'Oportunidades'],
    ['ranking', 'Ranking de oportunidades'],
  ]],
];

const AREAS = [
  { id: 'hoy', etiqueta: 'Hoy', inicio: 'resumen', secciones: [] },
  {
    id: 'cafe', etiqueta: 'Café', inicio: 'inventario',
    secciones: [['inventario', 'Inventario'], ['lotes_cafe', 'Compras'], ['procesos_cafe', 'Procesos'], ['costos', 'Costos']],
    ocultas: [['registrar', 'Registrar proceso']],
  },
  {
    id: 'dinero', etiqueta: 'Dinero', inicio: 'pyg',
    secciones: [['pyg', 'Resultados'], ['ventas', 'Ventas'], ['gastos', 'Gastos'], ['precios', 'Precios']],
    ocultas: [['presentaciones', 'Productos']],
  },
  {
    id: 'campo', etiqueta: 'Campo', inicio: 'campo', secciones: [],
    ocultas: GRUPOS_CAMPO.flatMap(([, filas]) => filas.map(([id, et]) => [id, et])),
  },
];

// Íconos de línea, al estilo de los de iOS: un solo trazo, esquinas redondas.
const ICONOS = {
  hoy: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  cafe: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 1 1.5 1 2.5s-1 1.5-1 2.5M12 3.5c0 1 1 1.5 1 2.5s-1 1.5-1 2.5"/>',
  dinero: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
  campo: '<path d="M6 19c0-7 4-12 13-14-1 9-6 13-12 13"/><path d="M6 19c2.5-4 5-6.5 9-9"/>',
  mas: '<path d="M12 6v12M6 12h12"/>',
};
const icono = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONOS[n]}</svg>`;

const areaDe = (seccion) => AREAS.find((a) => a.inicio === seccion
  || a.secciones.some(([s]) => s === seccion) || a.ocultas?.some(([s]) => s === seccion));

// Cada área recuerda en qué sección se quedó, para volver donde se iba.
const ultimaSeccion = {};
// Indicadores que se pintan sobre las pestañas (se refrescan con el resumen).
let indicadores = { hoy: 0, campo: 0 };
let indicadoresEn = 0;

function pintarNav(actual) {
  const area = areaDe(actual);
  // Solo se recuerda una sección que de verdad pertenece al área. Si no
  // (adjuntos, una dirección mal escrita), el botón del área seguiría
  // apuntando a esa página y "Hoy" dejaría de llevar al inicio.
  if (area) ultimaSeccion[area.id] = actual;
  const activa = area ?? AREAS[0];

  const pestana = (a) => {
    const n = indicadores[a.id] ?? 0;
    const punto = n ? `<span class="punto ${a.id === 'campo' ? 'media' : ''}" aria-label="${n} para revisar">${n > 9 ? '9+' : n}</span>` : '';
    return `<a href="#/${ultimaSeccion[a.id] ?? a.inicio}" ${a === activa ? 'aria-current="page"' : ''}>
      <span class="ico">${icono(a.id)}${punto}</span><span class="txt">${esc(a.etiqueta)}</span></a>`;
  };
  const mas = `<button type="button" class="pestana-mas" data-registrar aria-label="Registrar algo">
    <span class="ico">${icono('mas')}</span><span class="txt">Registrar</span></button>`;
  const html = [pestana(AREAS[0]), pestana(AREAS[1]), mas, pestana(AREAS[2]), pestana(AREAS[3])].join('');
  $('#nav').innerHTML = html;
  $('#pestanas').innerHTML = html;
  document.querySelectorAll('[data-registrar]').forEach((b) => b.addEventListener('click', abrirHojaRegistrar));

  // Debajo del título: el control segmentado del área, o "‹ Volver" en una
  // sección que no tiene segmento propio.
  const sub = $('#subnav');
  const enSegmento = activa.secciones.some(([s]) => s === actual);
  if (enSegmento) {
    sub.innerHTML = `<div class="segmentado-ios" role="tablist">${activa.secciones
      .map(([id, et]) => `<a role="tab" href="#/${id}" ${id === actual ? 'aria-selected="true"' : ''}>${esc(et)}</a>`).join('')}</div>`;
  } else if (area && actual !== area.inicio && area.id !== 'hoy') {
    const volver = area.id === 'campo' ? ['campo', 'Campo']
      : area.id === 'dinero' ? ['precios', 'Precios'] : ['inventario', 'Café'];
    sub.innerHTML = `<a class="volver" href="#/${volver[0]}">‹ ${esc(volver[1])}</a>`;
  } else {
    sub.innerHTML = '';
  }
}

// La hoja del botón +: todo lo que se registra, en un solo lugar.
const OPCIONES_REGISTRAR = [
  ['Café', [
    ['proceso', 'Proceso', 'Trilla, tueste, molienda'],
    ['lotes_cafe', 'Compra de café', 'Un lote que entra: kg y precio'],
  ]],
  ['Dinero', [
    ['ventas', 'Venta', 'Bolsas o kilos que salieron'],
    ['gastos', 'Gasto', 'Empaque, transporte, servicios'],
  ]],
  ['Campo', [
    ['actividades', 'Labor en la finca', 'Abonada, fumigada, plateo…'],
    ['observaciones', 'Observación', 'Algo que se vio en un lote'],
  ]],
];

function abrirHojaRegistrar() {
  const hoja = $('#hoja');
  hoja.innerHTML = `
    <div class="hoja-asa" aria-hidden="true"></div>
    <div class="hoja-cab"><h2 id="hoja-titulo">Registrar</h2><button type="button" class="enlace" data-cerrar>Cerrar</button></div>
    ${OPCIONES_REGISTRAR.map(([grupo, ops]) => `
      <p class="lista-titulo">${esc(grupo)}</p>
      <div class="lista">${ops.map(([id, t, d]) => `
        <button type="button" class="fila" data-op="${id}">
          <span class="fila-txt"><b>${esc(t)}</b><span>${esc(d)}</span></span><span class="chevron" aria-hidden="true">›</span>
        </button>`).join('')}</div>`).join('')}`;
  hoja.querySelector('[data-cerrar]').addEventListener('click', () => hoja.close());
  hoja.addEventListener('click', (ev) => { if (ev.target === hoja) hoja.close(); }, { once: true });
  hoja.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
    hoja.close();
    const op = b.dataset.op;
    if (op === 'proceso') location.hash = '#/registrar';
    else abrirFormulario(op, null, enrutar);
  }));
  hoja.showModal();
}

// Alertas altas y lotes con avisos: se muestran como número sobre la pestaña.
async function refrescarIndicadores(resumen) {
  // /api/resumen recalcula la cadena de costos de todos los lotes: es la
  // consulta más pesada. Si una vista acaba de traerla, no se pide de nuevo.
  if (!resumen && Date.now() - indicadoresEn < 15_000) return;
  try {
    const r = resumen ?? await api('/resumen');
    indicadoresEn = Date.now();
    // El número sobre "Hoy" cuenta solo lo del café; el del cultivo va sobre
    // Campo, para que ninguno de los dos tape al otro.
    indicadores = {
      hoy: r.alertas.filter((a) => a.grupo === 'cafe' && a.nivel !== 'info').length,
      campo: r.alertas.filter((a) => a.grupo !== 'cafe' && a.nivel === 'alta').length,
    };
    const [, id = 'resumen'] = location.hash.split('/');
    pintarNav(id);
  } catch { /* sin conexión o sin token: el menú va sin indicadores */ }
}

async function enrutar() {
  let [, id = 'resumen'] = location.hash.split('/');
  if (id === 'cultivo') id = 'campo'; // dirección vieja
  pintarNav(id);
  vista.innerHTML = '<p class="cargando" aria-label="Cargando"><span></span><span></span><span></span></p>';
  try {
    if (id === 'resumen') await vistaResumen();
    else if (id === 'campo') await vistaCampo();
    else if (id === 'mapa') await (await import('./mapa.js')).vistaMapa({ vista, api, esc, fmt, avisar, abrirFormulario });
    else if (id === 'prediccion') await vistaPrediccion();
    else if (id === 'plan') await vistaPlan();
    else if (id === 'tengo') await vistaTengo();
    else if (id === 'logistica') await vistaLogistica();
    else if (id === 'ranking') await vistaRanking();
    else if (['registrar', 'inventario', 'costos', 'precios', 'pyg'].includes(id)) {
      await (await import('./contabilidad.js')).vistaContabilidad(id, {
        vista, api, esc, fmt, titulo, hoy, avisar, abrirFormulario, usuario,
      });
    }
    else if (esquema.recursos[id]) await vistaRecurso(id);
    else {
      vista.innerHTML = `<h1>No encontramos esa página</h1>
        <p class="suave">La dirección <code>${esc(location.hash)}</code> no existe o cambió de lugar.</p>
        <p><a class="boton primario" href="#/resumen">Ir a Hoy</a></p>`;
    }
  } catch (e) {
    if (e.auth) { pantallaAcceso(); return; }
    vista.innerHTML = `<div class="alerta alta">${esc(e.message)}</div>`;
  }
  scrollTo({ top: 0 });
  vista.focus({ preventScroll: true });
}

// ---------- Etiquetas de referencias ----------

async function etiquetasDe(recurso, forzar = false) {
  if (!cacheEtiquetas[recurso] || forzar) {
    const rec = esquema.recursos[recurso];
    const { datos } = await api(`/${recurso}?limite=5000&orden=id&dir=asc`);
    cacheEtiquetas[recurso] = new Map(datos.map((d) => [d.id, d[rec.campoEtiqueta] ?? `#${d.id}`]));
  }
  return cacheEtiquetas[recurso];
}

// ---------- Piezas de interfaz ----------

// Lista agrupada de iOS: un título pequeño encima y filas con separador.
// fila: { href | data, titulo, detalle, valor, punto } — todo opcional menos titulo.
function lista(tituloGrupo, filas, pie = '') {
  if (!filas.length) return '';
  return `${tituloGrupo ? `<p class="lista-titulo">${esc(tituloGrupo)}</p>` : ''}
    <div class="lista">${filas.map(filaLista).join('')}</div>
    ${pie ? `<p class="lista-pie">${pie}</p>` : ''}`;
}

function filaLista(f) {
  const etiqueta = f.href ? 'a' : f.data ? 'button' : 'div';
  const atr = f.href ? `href="${f.href}"${f.descarga ? ' download' : ''}` : f.data ? `type="button" ${f.data}` : '';
  const punto = f.punto ? `<span class="fila-punto ${f.punto}" aria-hidden="true"></span>` : '';
  return `<${etiqueta} class="fila${f.href || f.data ? '' : ' fija'}" ${atr}>
    ${punto}<span class="fila-txt"><b>${f.titulo}</b>${f.detalle ? `<span>${f.detalle}</span>` : ''}</span>
    ${f.valor != null ? `<span class="fila-valor">${f.valor}</span>` : ''}
    ${f.href || f.data ? '<span class="chevron" aria-hidden="true">›</span>' : ''}
  </${etiqueta}>`;
}

const widget = (valor, etiqueta) => `<div class="widget"><b>${valor}</b><span>${esc(etiqueta)}</span></div>`;

const fechaLarga = () => new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

// ---------- Hoy ----------

// Siguiente paso del proceso según el estado menos avanzado que tenga café.
const SIGUIENTE_PASO = {
  cereza: 'despulpar',
  pergamino_humedo: 'secar',
  pergamino_seco: 'trillar',
  verde: 'tostar',
};

// El camino del café que se compra: de pergamino a molido. Se ve de un golpe
// en qué etapa está cada kilo.
const CAMINO = [['pergamino_seco', 'Pergamino'], ['verde', 'Verde'], ['tostado_grano', 'Tostado'], ['tostado_molido', 'Molido']];

function caminoDelCafe(inv) {
  const kgDe = (id) => inv.estados.find((e) => e.estado === id)?.kg ?? 0;
  const antes = inv.estados.filter((e) => ['cereza', 'pergamino_humedo'].includes(e.estado) && e.kg > 0.01)
    .map((e) => [e.estado, e.estado === 'cereza' ? 'Cereza' : 'Húmedo']);
  const pasos = [...antes, ...CAMINO];
  return `<div class="camino" role="list">${pasos.map(([id, nombre], i) => {
    const kg = kgDe(id);
    return `${i ? '<span class="camino-flecha" aria-hidden="true">›</span>' : ''}
      <div class="camino-paso ${kg > 0.01 ? 'lleno' : ''}" role="listitem">
        <b>${kg > 0.01 ? fmt(kg, kg < 10 ? 1 : 0) : '0'}</b><span>kg</span><em>${esc(nombre)}</em>
      </div>`;
  }).join('')}</div>`;
}

// Inicio: el café que se compró y en qué va. El cultivo propio tiene su
// portada en Campo, para que las dos cosas no se mezclen.
async function vistaResumen() {
  const r = await api('/resumen');
  refrescarIndicadores(r);
  const inv = r.negocio.inventario;
  const neg = r.negocio.anio;
  const alertasCafe = r.alertas.filter((a) => a.grupo === 'cafe');
  const altasCampo = r.alertas.filter((a) => a.grupo !== 'cafe' && a.nivel === 'alta').length;
  const tostado = inv.estados.find((e) => e.estado.startsWith('tostado'));
  const porProcesar = inv.estados.find((e) => SIGUIENTE_PASO[e.estado] && e.kg > 0.01);
  const verbo = porProcesar ? SIGUIENTE_PASO[porProcesar.estado] : '';
  const nivel = { alta: 'rojo', media: 'ambar', info: 'azul' };
  const totalRegistros = Object.values(r.registros).reduce((s, n) => s + n, 0);

  vista.innerHTML = `
    <header class="titulo-grande">
      <p class="sobre">${esc(fechaLarga())}</p>
      <h1>${usuario ? `Hola, ${esc(usuario.split(' ')[0])}` : 'Hoy'}</h1>
    </header>

    <section class="tarjeta camino-tarjeta">
      <div class="tarjeta-cab"><h2>El camino del café</h2><a href="#/inventario">Inventario</a></div>
      ${caminoDelCafe(inv)}
      ${porProcesar
    ? `<a class="boton primario ancho-total" href="#/registrar">${esc(verbo[0].toUpperCase() + verbo.slice(1))} ${fmt(porProcesar.kg, 1)} kg de ${esc(porProcesar.nombre.split(' ')[0].toLowerCase())}</a>`
    : inv.total_kg > 0
      ? '<a class="boton primario ancho-total" href="#/precios">Todo procesado: ver precios para vender</a>'
      : '<button type="button" class="boton primario ancho-total" data-nuevo="lotes_cafe">Registrar la primera compra</button>'}
    </section>

    <div class="widgets">
      ${widget(`${fmt(inv.total_kg, 1)} kg`, 'en inventario')}
      ${widget(tostado ? `$${fmt(tostado.cop_por_kg)}` : '—', 'cuesta el kg tostado')}
      ${widget(`$${fmt(inv.total_valor_cop)}`, 'inventario al costo')}
      ${widget(`<span class="${neg.utilidad_operativa_cop < 0 ? 'negativo' : ''}">$${fmt(neg.utilidad_operativa_cop)}</span>`, `utilidad ${r.cosecha_anio.anio}`)}
    </div>

    ${lista('Pendientes del café', alertasCafe.map((a) => ({ titulo: esc(a.mensaje), punto: nivel[a.nivel] ?? 'azul' })))}
    ${alertasCafe.length ? '' : lista('Pendientes del café', [{ titulo: 'Nada por revisar', detalle: 'El café está al día.', punto: 'verde' }])}

    ${lista(`Negocio ${r.cosecha_anio.anio}`, [
    { titulo: 'Ingresos', valor: `$${fmt(neg.ingresos_cop)}`, href: '#/ventas' },
    { titulo: 'Margen bruto', valor: `$${fmt(neg.margen_bruto_cop)}${neg.margen_bruto_pct != null ? ` · ${fmt(neg.margen_bruto_pct, 0)} %` : ''}`, href: '#/pyg' },
    { titulo: 'Gastos', valor: `$${fmt(neg.gastos_operativos_cop)}`, href: '#/gastos' },
    { titulo: 'Café comprado', valor: `${fmt(neg.compras.kg, 1)} kg · $${fmt(neg.compras.valor_cop)}`, href: '#/lotes_cafe' },
    ...(neg.por_cobrar.valor_cop ? [{ titulo: 'Por cobrar', valor: `$${fmt(neg.por_cobrar.valor_cop)}`, detalle: `${neg.por_cobrar.ventas} venta(s)`, href: '#/ventas', punto: 'ambar' }] : []),
  ])}

    ${lista('Más', [
    { titulo: 'Campo', detalle: `${fmt(r.totales.plantas)} plantas en ${r.totales.lotes} lotes${r.clima_7_dias ? ` · ${fmt(r.clima_7_dias.lluvia_mm, 0)} mm de lluvia esta semana` : ''}`, valor: altasCampo ? `${altasCampo} alerta${altasCampo === 1 ? '' : 's'}` : null, href: '#/campo', punto: altasCampo ? 'rojo' : null },
    { titulo: 'Descargar respaldo', detalle: `Todo lo registrado (${fmt(totalRegistros)} registros) en un archivo`, href: `/api/respaldo${token() ? `?token=${encodeURIComponent(token())}` : ''}`, descarga: true },
  ], 'Guarde un respaldo cada tanto: si algo se daña, es lo único que lo recupera.')}`;

  vista.querySelectorAll('[data-nuevo]').forEach((b) => {
    b.addEventListener('click', () => abrirFormulario(b.dataset.nuevo, null, vistaResumen));
  });
}

// ---------- Campo ----------

// Portada de Campo: la finca, su clima y sus alertas arriba; abajo, todo lo
// del cultivo, la biomasa y la finca en listas agrupadas, como Ajustes del iPhone.
async function vistaCampo() {
  const r = await api('/resumen');
  refrescarIndicadores(r);
  const c7 = r.clima_7_dias;
  // Lo más grave primero; una tarea atrasada lleva al plan, el resto a la predicción.
  const orden = { alta: 0, media: 1, info: 2 };
  const alertas = r.alertas.filter((a) => a.grupo !== 'cafe').sort((a, b) => (orden[a.nivel] ?? 3) - (orden[b.nivel] ?? 3));
  const nivel = { alta: 'rojo', media: 'ambar', info: 'azul' };
  const filaAlerta = (a) => ({ titulo: esc(a.mensaje), punto: nivel[a.nivel] ?? 'azul', href: /programad/.test(a.mensaje) ? '#/plan' : '#/prediccion' });

  vista.innerHTML = `
    <header class="titulo-grande">
      <p class="sobre">${esc(r.finca.nombre)}${r.finca.municipio ? ` · ${esc(r.finca.municipio)}` : ''} · ${fmt(r.finca.hectareas, 1)} ha</p>
      <h1>Campo</h1>
    </header>

    <div class="widgets">
      ${widget(fmt(r.totales.plantas), `plantas en ${r.totales.lotes} lotes`)}
      ${widget(c7 ? `${fmt(c7.lluvia_mm, 0)} mm` : '—', 'lluvia en 7 días')}
      ${widget(c7 ? `${fmt(c7.temp_media, 1)} °C` : '—', 'temperatura media')}
      ${widget(`${fmt(r.cosecha_anio.kg_cereza)} kg`, `cereza ${r.cosecha_anio.anio}`)}
    </div>

    ${lista('Alertas', alertas.slice(0, 3).map(filaAlerta))}
    ${alertas.length > 3 ? `<details class="pendientes"><summary>Ver ${alertas.length - 3} alerta${alertas.length - 3 === 1 ? '' : 's'} más</summary>
      ${lista('', alertas.slice(3).map(filaAlerta))}</details>` : ''}

    ${lista('Lotes', r.lotes.map((l) => ({
    titulo: esc(l.nombre),
    detalle: [l.variedad, l.num_plantas ? `${fmt(l.num_plantas)} plantas` : null, l.edad_meses ? `${fmt(l.edad_meses)} meses` : null, l.ultima_labor ? `última labor ${l.ultima_labor}` : null].filter(Boolean).map(esc).join(' · '),
    valor: l.observaciones_abiertas ? `${l.observaciones_abiertas} obs.` : null,
    data: `data-lote="${l.id}"`,
  })))}

    ${GRUPOS_CAMPO.map(([grupo, filas]) => lista(grupo, filas.map(([id, t, d]) => ({
    titulo: esc(t),
    detalle: d ? esc(d) : '',
    valor: r.registros[id] ? fmt(r.registros[id]) : null,
    href: `#/${id}`,
  })))).join('')}

    ${r.datos_pendientes.length ? `<details class="pendientes">
      <summary>Datos que faltan (${r.datos_pendientes.length})</summary>
      ${lista('', r.datos_pendientes.map((p) => ({ titulo: esc(p) })))}
    </details>` : ''}`;

  vista.querySelectorAll('[data-lote]').forEach((b) => b.addEventListener('click', () => abrirFormulario('lotes', Number(b.dataset.lote), vistaCampo)));
}

// ---------- CRUD genérico ----------

function columnasDe(rec) {
  // Si el recurso declara sus columnas, se respetan: el orden automático deja
  // los números de último y en listas como Ventas o Gastos el monto quedaba
  // fuera de las siete que caben.
  if (rec.columnas) return rec.columnas.filter((n) => rec.campos[n]);
  const campos = Object.entries(rec.campos).filter(([, d]) => d.tipo !== 'json' && !d.largo);
  const prioridad = (d, n) => (n === rec.campoFecha ? 0 : d.tipo === 'ref' ? 1 : n === rec.campoEtiqueta ? 2 : d.tipo === 'opcion' ? 3 : 4);
  return campos.sort(([na, a], [nb, b]) => prioridad(a, na) - prioridad(b, nb)).slice(0, 7).map(([n]) => n);
}

async function valorCelda(rec, campo, fila) {
  const def = rec.campos[campo];
  const v = fila[campo];
  if (v == null) return '—';
  if (def.tipo === 'ref') return esc((await etiquetasDe(def.ref)).get(v) ?? `#${v}`);
  if (def.tipo === 'real' || def.tipo === 'entero') return fmt(v, 2);
  return esc(def.tipo === 'opcion' ? titulo(v) : v);
}

// Nombres que ve la gente, cuando el del modelo de datos suena a tabla.
const NOMBRES = {
  lotes_cafe: 'Compras', presentaciones: 'Productos', actividades: 'Labores hechas', plan_labores: 'Tareas',
  subproductos: 'Partidas', fincas: 'Datos de la finca', suelo: 'Análisis de suelo',
};
const nombreDe = (recurso) => NOMBRES[recurso] ?? esquema.recursos[recurso].etiqueta;

// Qué decir cuando una sección está vacía: qué es, por qué sirve y cómo empezar.
// [título, explicación, botón, a dónde lleva el botón (si no, abre el formulario)]
const VACIOS = {
  procesos_cafe: ['Aún no hay procesos', 'Cada vez que trillen, tuesten o muelan, anótelo: el sistema calcula cuánto salió y cuánto cuesta cada kilo.', 'Registrar proceso', '#/registrar'],
  lotes_cafe: ['Aún no hay compras', 'Cada compra de café es un lote: cuántos kg, a cuánto y a quién.', 'Registrar compra'],
  ventas: ['Aún no hay ventas', 'Anote cada bolsa o kilo que salga para ver lo que entra y lo que falta por cobrar.', 'Anotar venta'],
  gastos: ['Aún no hay gastos', 'Empaque, transporte, gas, servicios: todo suma al costo real del café.', 'Anotar gasto'],
  presentaciones: ['Aún no hay productos', 'Las bolsas que venden: peso, empaque y precio. Con eso se calcula el margen de cada una.', 'Agregar producto'],
  actividades: ['Aún no hay labores', 'Abonadas, fumigadas, plateos: lo que se hace en cada lote y cuánto costó.', 'Anotar labor'],
  observaciones: ['Aún no hay observaciones', 'Plagas, enfermedades o cualquier cosa que se vea en un lote.', 'Anotar observación'],
};

// Lista o tabla: cada persona elige, y el celular la recuerda.
const comoTabla = () => { try { return localStorage.getItem('cafe_vista') === 'tabla'; } catch { return false; } };

async function vistaRecurso(recurso, filtros = {}) {
  const rec = esquema.recursos[recurso];
  const tieneLote = Boolean(rec.campos.lote_id);
  const qs = new URLSearchParams({ limite: '500', ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)) });
  const [{ datos, total }, lotes] = await Promise.all([api(`/${recurso}?${qs}`), tieneLote ? etiquetasDe('lotes') : null]);

  const extra = { oportunidades: 'indice', subproductos: 'kg_secos_estimados', floraciones: 'cosecha_estimada' }[recurso];
  const cols = columnasDe(rec);
  const tabla = comoTabla();
  const buscando = Boolean(filtros.q || filtros.lote_id);

  let cuerpo;
  if (!datos.length) {
    const [t, d, boton, destino] = VACIOS[recurso] ?? [`Aún no hay ${nombreDe(recurso).toLowerCase()}`, 'Agregue el primero con el botón Nuevo.', 'Nuevo'];
    cuerpo = buscando
      ? '<div class="vacio"><b>Sin resultados</b><span>Pruebe con otra palabra o quite el filtro.</span></div>'
      : `<div class="vacio"><b>${esc(t)}</b><span>${esc(d)}</span>
          ${rec.soloLectura ? '' : destino ? `<a class="boton primario" href="${destino}">${esc(boton)}</a>` : `<button type="button" class="primario" data-vacio>${esc(boton)}</button>`}</div>`;
  } else if (tabla) {
    const filas = await Promise.all(datos.map(async (f) => {
      const celdas = await Promise.all(cols.map(async (c) => {
        const num = ['real', 'entero'].includes(rec.campos[c].tipo);
        return `<td class="${num ? 'num' : ''}">${await valorCelda(rec, c, f)}</td>`;
      }));
      let celdaExtra = '';
      if (extra === 'cosecha_estimada') celdaExtra = `<td>${esc(f.cosecha_estimada?.probable ?? '—')}</td>`;
      else if (extra) celdaExtra = `<td class="num">${f[extra] == null ? '—' : fmt(f[extra], 1)}</td>`;
      return `<tr data-id="${f.id}">${celdas.join('')}${celdaExtra}</tr>`;
    }));
    const etiquetaExtra = { indice: 'Índice (0–100)', kg_secos_estimados: 'kg secos (est.)', cosecha_estimada: 'Cosecha probable' }[extra];
    cuerpo = `<div class="tabla-contenedor"><table>
      <thead><tr>${cols.map((c) => `<th>${esc(titulo(c))}</th>`).join('')}${etiquetaExtra ? `<th>${etiquetaExtra}</th>` : ''}</tr></thead>
      <tbody>${filas.join('')}</tbody></table></div>`;
  } else {
    // Fila de lista: el nombre arriba, la fecha y lo demás en gris debajo, y
    // a la derecha la primera cifra (el total de la venta, los kg, el monto).
    const principal = rec.campoEtiqueta && rec.campos[rec.campoEtiqueta] ? rec.campoEtiqueta : cols.find((c) => c !== rec.campoFecha) ?? cols[0];
    // A la derecha va la plata si la hay (total de la venta, valor del gasto,
    // precio del producto); si no, los kilos.
    const numericas = cols.filter((c) => c !== principal && ['real', 'entero'].includes(rec.campos[c].tipo));
    const cifra = ['total_cop', 'valor_cop', 'precio_venta_cop'].find((c) => numericas.includes(c)) ?? numericas[0];
    const proceso = cols.includes('kg_entrada') && cols.includes('kg_salida');
    const resto = cols.filter((c) => ![principal, cifra, rec.campoFecha, ...(proceso ? ['kg_entrada', 'kg_salida'] : [])].includes(c));
    const filas = await Promise.all(datos.map(async (f) => {
      const plata = (c) => /cop|precio|valor|monto|costo/.test(c) && ['real', 'entero'].includes(rec.campos[c].tipo);
      const detalle = (await Promise.all(resto.map(async (c) => (f[c] == null ? null
        : c === 'activa' ? (f[c] === 'no' ? 'Inactivo' : null)
          : plata(c) ? `$${fmt(f[c])}${/kg/.test(c) ? '/kg' : ''}`
            : c === 'gramos' ? `${fmt(f[c])} g`
              : c === 'unidades' ? `${fmt(f[c])} ${f[c] === 1 ? 'unidad' : 'unidades'}` : valorCelda(rec, c, f))))).filter(Boolean).slice(0, 3);
      const fecha = rec.campoFecha && f[rec.campoFecha] ? esc(String(f[rec.campoFecha]).slice(0, 10)) : null;
      const valorExtra = extra === 'cosecha_estimada' ? f.cosecha_estimada?.probable : extra && f[extra] != null ? fmt(f[extra], 1) : null;
      return filaLista({
        titulo: await valorCelda(rec, principal, f),
        detalle: [fecha, ...detalle].filter(Boolean).join(' · '),
        valor: proceso && f.kg_entrada != null
          ? `${fmt(f.kg_entrada, 1)} → ${f.kg_salida == null ? '…' : fmt(f.kg_salida, 1)} kg`
          : cifra && f[cifra] != null
          ? `${/cop|precio|valor|monto|costo/.test(cifra) ? '$' : ''}${fmt(f[cifra], /cop|precio|valor|monto|costo/.test(cifra) ? 0 : 2)}${/kg/.test(cifra) ? ' kg' : ''}`
          : valorExtra != null ? esc(valorExtra) : null,
        data: `data-id="${f.id}"`,
      });
    }));
    cuerpo = `<div class="lista">${filas.join('')}</div>`;
  }

  vista.innerHTML = `
    <header class="titulo-grande con-accion">
      <div><p class="sobre">${fmt(total)} ${total === 1 ? 'registro' : 'registros'}</p><h1>${esc(nombreDe(recurso))}</h1></div>
      ${rec.soloLectura ? '' : '<button type="button" class="boton-redondo" id="nuevo" aria-label="Nuevo registro">+</button>'}
    </header>
    ${datos.length || buscando ? `<div class="herramientas">
      <input id="f-q" class="buscar crece" type="search" placeholder="Buscar" value="${esc(filtros.q ?? '')}">
      ${tieneLote ? `<select id="f-lote" class="buscar"><option value="">Todos los lotes</option>${[...lotes].map(([id, n]) => `<option value="${id}" ${String(filtros.lote_id) === String(id) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
    </div>` : ''}
    ${recurso === 'clima' ? '<p class="suave pequeno">Open-Meteo es un modelo meteorológico de referencia, no una medición en la finca. Los datos de estación o sensor propios tienen prioridad en el resumen.</p>' : ''}
    ${recurso === 'oportunidades' ? '<p class="suave pequeno">Califique cada criterio de 1 a 5, donde 5 es siempre lo más favorable. Vea el <a href="#/ranking">ranking</a>.</p>' : ''}
    ${cuerpo}
    ${datos.length ? `<div class="pie-lista">
      <div class="segmentado-ios mini" role="group" aria-label="Cómo mostrar">
        <button type="button" data-modo="lista" ${tabla ? '' : 'aria-pressed="true"'}>Lista</button>
        <button type="button" data-modo="tabla" ${tabla ? 'aria-pressed="true"' : ''}>Tabla</button>
      </div>
      ${recurso === 'clima' ? '<button type="button" class="enlace" id="sync">Sincronizar clima (7 días)</button>' : ''}
      <button type="button" class="enlace" id="exportar">Exportar CSV</button>
    </div>` : ''}`;

  const recargar = () => vistaRecurso(recurso, { lote_id: $('#f-lote')?.value, q: $('#f-q')?.value });
  const nuevo = () => abrirFormulario(recurso, null, recargar, { lote_id: filtros.lote_id });
  $('#nuevo')?.addEventListener('click', nuevo);
  vista.querySelector('[data-vacio]')?.addEventListener('click', nuevo);
  $('#f-lote')?.addEventListener('change', recargar);
  let t;
  $('#f-q')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(recargar, 350); });
  vista.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => abrirFormulario(recurso, Number(el.dataset.id), recargar)));
  vista.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('cafe_vista', b.dataset.modo); } catch { /* sin almacenamiento */ }
    recargar();
  }));

  $('#exportar')?.addEventListener('click', async () => {
    const blob = await api(`/exportar/${recurso}.csv?${new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)))}`);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${recurso}-${hoy()}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#sync')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api('/clima/sincronizar', { metodo: 'POST', cuerpo: { finca_id: 1, dias: 7 } });
      avisar(`Clima sincronizado: ${r.horas_guardadas} horas.`);
      recargar();
    } catch (e) {
      avisar(e.message);
      ev.target.disabled = false;
    }
  });
}

async function controlCampo(nombre, def, valor) {
  const id = `c-${nombre}`;
  const req = def.requerido ? ' *' : '';
  const etiqueta = `<label for="${id}">${esc(def.etiqueta ?? titulo(nombre))}${req}</label>`;
  const ayuda = def.ayuda ? `<div class="ayuda">${esc(def.ayuda)}</div>` : '';
  const v = valor ?? '';
  let control;

  switch (def.tipo) {
    case 'ref': {
      const opciones = await etiquetasDe(def.ref);
      control = `<select id="${id}" name="${nombre}"><option value="">—</option>${[...opciones].map(([oid, n]) => `<option value="${oid}" ${String(v) === String(oid) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      break;
    }
    case 'opcion':
      control = `<select id="${id}" name="${nombre}"><option value="">—</option>${def.opciones.map((o) => `<option value="${o}" ${v === o ? 'selected' : ''}>${esc(titulo(o))}</option>`).join('')}</select>`;
      break;
    case 'fecha':
      control = `<input id="${id}" name="${nombre}" type="date" value="${esc(v)}">`;
      break;
    case 'fechahora':
      control = `<input id="${id}" name="${nombre}" type="datetime-local" value="${esc(String(v).slice(0, 16))}">`;
      break;
    case 'entero':
    case 'real':
      control = `<input id="${id}" name="${nombre}" type="number" inputmode="decimal" step="${def.tipo === 'entero' ? 1 : 'any'}" ${def.min != null ? `min="${def.min}"` : ''} ${def.max != null ? `max="${def.max}"` : ''} value="${esc(v)}">`;
      break;
    case 'json':
      control = `<textarea id="${id}" name="${nombre}" spellcheck="false">${esc(v === '' ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2))}</textarea>`;
      break;
    default:
      control = def.largo
        ? `<textarea id="${id}" name="${nombre}">${esc(v)}</textarea>`
        : `<input id="${id}" name="${nombre}" type="text" value="${esc(v)}">`;
  }
  const ancho = def.largo || def.tipo === 'json' ? 'ancho' : '';
  return `<div class="${ancho}">${etiqueta}${control}${ayuda}<div class="error-campo" data-error="${nombre}"></div></div>`;
}

async function abrirFormulario(recurso, id, alGuardar, valoresIniciales = {}) {
  const rec = esquema.recursos[recurso];
  const registro = id ? await api(`/${recurso}/${id}`) : {};
  const inicial = id ? registro : { ...valoresIniciales };
  if (!id) {
    for (const [n, d] of Object.entries(rec.campos)) {
      if (inicial[n] == null && d.defecto !== undefined) inicial[n] = d.defecto;
      if (inicial[n] == null && d.tipo === 'fecha' && n === rec.campoFecha) inicial[n] = hoy();
      if (inicial[n] == null && d.tipo === 'ref' && d.ref === 'fincas') inicial[n] = 1;
    }
  }

  // Los campos automáticos (quién registró) los pone el servidor: no se muestran
  // para que nadie los escriba a mano ni crea que puede cambiarlos.
  const controles = await Promise.all(
    Object.entries(rec.campos).filter(([, d]) => !d.auto).map(([n, d]) => controlCampo(n, d, inicial[n])),
  );
  const soloLectura = rec.soloLectura;

  let adjuntosHtml = '';
  if (id && recurso !== 'adjuntos') {
    const { datos: adj } = await api(`/adjuntos?entidad=${recurso}&entidad_id=${id}&orden=id&dir=asc`);
    const q = token() ? `?token=${encodeURIComponent(token())}` : '';
    adjuntosHtml = `
      <div class="ancho" style="margin-top:12px">
        <label>Fotos y documentos</label>
        <div class="adjuntos">${adj.map((a) => a.mime?.startsWith('image/')
          ? `<figure><a href="/uploads/${esc(a.archivo)}${q}" target="_blank" rel="noopener"><img src="/uploads/${esc(a.archivo)}${q}" alt="${esc(a.nombre_original)}" loading="lazy"></a></figure>`
          : `<figure><a href="/uploads/${esc(a.archivo)}${q}" target="_blank" rel="noopener">${esc(a.nombre_original)}</a></figure>`).join('') || '<span class="suave pequeno">Sin adjuntos.</span>'}</div>
        <input type="file" id="archivos" multiple accept="image/*,application/pdf,text/csv" capture="environment">
      </div>`;
  }

  let extraHtml = '';
  if (registro.cosecha_estimada) {
    extraHtml = `<div class="alerta ancho">Cosecha estimada (orientativa): ${esc(registro.cosecha_estimada.desde)} a ${esc(registro.cosecha_estimada.hasta)}, probable ${esc(registro.cosecha_estimada.probable)}.</div>`;
  }
  if (registro.indice !== undefined) {
    extraHtml = `<div class="alerta ancho">Índice de oportunidad: <b>${registro.indice ?? 'sin evaluar'}</b> · ${registro.criterios_evaluados}/15 criterios evaluados.</div>`;
  }

  formDialogo.innerHTML = `
    <div class="dialogo-cab">
      <button type="button" class="enlace" data-cerrar>${soloLectura ? 'Cerrar' : 'Cancelar'}</button>
      <h2>${id ? '' : 'Nuevo: '}${esc(nombreDe(recurso))}</h2>
      ${soloLectura ? '<span></span>' : '<button type="submit" class="enlace fuerte" value="guardar" id="guardar">Guardar</button>'}
    </div>
    <div class="dialogo-cuerpo"><div class="campos">${extraHtml}${controles.join('')}${adjuntosHtml}</div>
      <div class="error-campo" data-error="_general"></div>
      ${id && !soloLectura ? '<button type="button" class="peligro ancho-total" id="borrar" style="margin-top:20px">Borrar este registro</button>' : ''}
    </div>`;

  if (soloLectura) formDialogo.querySelectorAll('input,select,textarea').forEach((el) => { el.disabled = true; });
  formDialogo.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => dialogo.close()));
  dialogo.showModal();

  $('#borrar', formDialogo)?.addEventListener('click', async () => {
    if (!confirm('¿Borrar este registro? No se puede deshacer.')) return;
    try {
      await api(`/${recurso}/${id}`, { metodo: 'DELETE' });
      delete cacheEtiquetas[recurso];
      dialogo.close();
      avisar('Registro borrado');
      alGuardar?.();
    } catch (e) {
      $('[data-error="_general"]', formDialogo).textContent = e.message;
    }
  });

  formDialogo.onsubmit = async (ev) => {
    ev.preventDefault();
    if (soloLectura) return;
    const boton = $('#guardar', formDialogo);
    boton.disabled = true;
    formDialogo.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });

    const cuerpo = {};
    for (const [n, d] of Object.entries(rec.campos)) {
      const el = formDialogo.elements.namedItem(n);
      if (!el) continue;
      let v = el.value.trim();
      if (d.tipo === 'fechahora' && v) v = v.slice(0, 16);
      cuerpo[n] = v === '' ? null : v;
    }

    try {
      const guardado = await api(id ? `/${recurso}/${id}` : `/${recurso}`, { metodo: id ? 'PUT' : 'POST', cuerpo });
      const archivos = $('#archivos', formDialogo)?.files;
      if (archivos?.length) {
        const fd = new FormData();
        fd.append('entidad', recurso);
        fd.append('entidad_id', guardado.id);
        [...archivos].forEach((f) => fd.append('archivos', f));
        await api('/adjuntos', { metodo: 'POST', formData: fd });
      }
      delete cacheEtiquetas[recurso];
      dialogo.close();
      avisar(id ? '✓ Cambios guardados' : (usuario ? `✓ Guardado a nombre de ${usuario.split(' ')[0]}` : '✓ Guardado'));
      alGuardar?.();
    } catch (e) {
      $('[data-error="_general"]', formDialogo).textContent = e.message;
      for (const [campo, msg] of Object.entries(e.detalles ?? {})) {
        const el = $(`[data-error="${campo}"]`, formDialogo);
        if (el) el.textContent = msg;
      }
      boton.disabled = false;
    }
  };
}

// ---------- Tengo X kg de Y ----------

const opcionesSubproducto = () => esquema.recursos.subproductos.campos.tipo.opciones
  .map((o) => `<option value="${o}">${esc(titulo(o))}</option>`).join('');

async function vistaTengo() {
  vista.innerHTML = `
    <h1>Tengo X kg de…</h1>
    <p class="suave">Indique qué subproducto tiene y cuánto. El sistema calcula equivalencias y ordena los usos posibles por viabilidad.</p>
    <form class="tarjeta" id="f-tengo">
      <div class="form-calc">
        <div><label for="t-kg">Cantidad (kg) *</label><input id="t-kg" name="kg" type="number" step="any" min="0" required value="50"></div>
        <div><label for="t-tipo">Subproducto *</label><select id="t-tipo" name="tipo">${opcionesSubproducto()}</select></div>
        <div><label for="t-h">Humedad medida (%)</label><input id="t-h" name="humedad_pct" type="number" step="any" min="0" max="99" placeholder="Si no la sabe, déjela vacía"></div>
        <div><label for="t-horas">Horas desde que se generó</label><input id="t-horas" name="horas_desde_generacion" type="number" step="any" min="0"></div>
      </div>
      <button class="primario">Evaluar</button>
    </form>
    <div id="res-tengo" style="margin-top:12px"></div>`;

  $('#f-tengo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuerpo = Object.fromEntries(new FormData(ev.target));
    try {
      const r = await api('/biomasa/evaluar', { metodo: 'POST', cuerpo });
      const e = r.equivalencias;
      $('#res-tengo').innerHTML = `
        <div class="cifras">
          <div class="cifra"><b>${fmt(e.kg_materia_seca, 1)}</b><span>kg de materia seca</span></div>
          <div class="cifra"><b>${fmt(e.kg_agua, 1)}</b><span>kg de agua</span></div>
          <div class="cifra"><b>${fmt(e.volumen_m3_aprox, 2)}</b><span>m³ aprox.</span></div>
          ${e.kg_cereza_que_la_generaron ? `<div class="cifra"><b>${fmt(e.kg_cereza_que_la_generaron)}</b><span>kg de cereza que la generaron</span></div>` : ''}
        </div>
        ${r.advertencias.map((a) => `<div class="alerta media">${esc(a)}</div>`).join('')}
        <div class="rejilla" style="margin-top:12px">${r.oportunidades.map((o) => `
          <section class="tarjeta">
            <h2>${esc(o.nombre)} <span class="chip ${o.viabilidad}">${esc(titulo(o.viabilidad))}</span></h2>
            <p class="pequeno">${o.producto_estimado ? `<b>${fmt(o.producto_estimado.kg_min, 1)}–${fmt(o.producto_estimado.kg_max, 1)} kg</b> de producto (confianza ${esc(o.confianza)})` : '<b>Rendimiento por caracterizar</b>'}</p>
            <p class="pequeno suave">${esc(o.proceso)}</p>
            <p class="pequeno">Complejidad ${o.complejidad}/5 · Inversión ${esc(o.inversion)} · Línea: ${esc(titulo(o.linea))}</p>
            <p class="pequeno"><b>Equipos:</b> ${esc(o.equipos.join(', '))}</p>
            <p class="pequeno"><b>Regulación:</b> ${esc(o.regulacion)}</p>
            ${o.notas.length ? `<ul class="limpia pequeno">${o.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          </section>`).join('')}</div>
        <p class="suave pequeno" style="margin-top:12px">${esc(r.aviso)}</p>
        <details class="pequeno suave"><summary>Referencias</summary><ul class="limpia">${r.referencias.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
    } catch (e) {
      $('#res-tengo').innerHTML = `<div class="alerta alta">${esc(e.message)} ${esc(JSON.stringify(e.detalles ?? ''))}</div>`;
    }
  });
}

// ---------- Costo puesto en planta ----------

async function vistaLogistica() {
  const productores = await etiquetasDe('productores', true);
  const campo = (n, et, extra = '') => `<div><label for="l-${n}">${et}</label><input id="l-${n}" name="${n}" type="number" step="any" min="0" ${extra}></div>`;
  vista.innerHTML = `
    <h1>Costo puesto en planta</h1>
    <p class="suave">¿Cuánto cuesta traer una partida de biomasa hasta la finca, por kg fresco y por kg seco?</p>
    <form class="tarjeta" id="f-log">
      <div class="form-calc">
        <div><label for="l-tipo">Subproducto *</label><select id="l-tipo" name="tipo">${opcionesSubproducto()}</select></div>
        ${campo('kg', 'Cantidad (kg) *', 'required value="500"')}
        ${campo('humedad_pct', 'Humedad (%)', 'max="99" placeholder="típica si vacío"')}
        <div><label for="l-prod">Productor (estima distancia)</label><select id="l-prod" name="productor_id"><option value="">—</option>${[...productores].map(([pid, n]) => `<option value="${pid}">${esc(n)}</option>`).join('')}</select></div>
        ${campo('distancia_km', 'Distancia por vía (km)', 'placeholder="o elija productor"')}
        ${campo('capacidad_kg', 'Capacidad vehículo (kg) *', 'required value="1000"')}
        ${campo('capacidad_m3', 'Capacidad vehículo (m³)')}
        ${campo('costo_km_cop', 'Costo por km (COP) *', 'required')}
        ${campo('costo_adquisicion_cop_kg', 'Precio compra (COP/kg)', 'value="0"')}
        ${campo('mano_obra_cop_viaje', 'Mano de obra por viaje (COP)', 'value="0"')}
        ${campo('horas_hasta_proceso', 'Horas de espera antes del proceso', 'value="0"')}
        ${campo('humedad_objetivo_pct', 'Secar hasta humedad (%)', 'max="99"')}
        ${campo('costo_secado_cop_kg_agua', 'Costo secado (COP por kg de agua)', 'value="0"')}
        ${campo('entregas_por_mes', 'Entregas por mes', 'value="1"')}
      </div>
      <button class="primario">Calcular</button>
    </form>
    <div id="res-log" style="margin-top:12px"></div>`;

  $('#f-log').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuerpo = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v !== ''));
    try {
      const r = await api('/logistica/costo', { metodo: 'POST', cuerpo });
      const c = r.costos_cop;
      const i = r.indicadores;
      $('#res-log').innerHTML = `
        <div class="cifras">
          <div class="cifra"><b>$${fmt(c.total)}</b><span>costo total COP</span></div>
          <div class="cifra"><b>$${fmt(i.cop_por_kg_fresco, 1)}</b><span>COP por kg fresco</span></div>
          <div class="cifra"><b>$${fmt(i.cop_por_kg_seco, 1)}</b><span>COP por kg seco</span></div>
          <div class="cifra"><b>${r.carga.viajes}</b><span>viajes (limita: ${esc(r.carga.limitante)})</span></div>
          <div class="cifra"><b>$${fmt(i.costo_mensual_cop)}</b><span>COP al mes</span></div>
        </div>
        ${r.distancia_estimada ? `<div class="alerta">Distancia estimada a ${esc(r.distancia_estimada.productor)}: ${r.distancia_estimada.linea_recta_km} km en línea recta × ${r.distancia_estimada.factor_ruta} = ${r.entrada.distancia_km} km.</div>` : ''}
        ${r.advertencias.map((a) => `<div class="alerta media">${esc(a)}</div>`).join('')}
        <div class="tarjeta"><table><tbody>
          <tr><td>Adquisición</td><td class="num">$${fmt(c.adquisicion)}</td></tr>
          <tr><td>Transporte (${fmt(r.carga.km_recorridos, 1)} km)</td><td class="num">$${fmt(c.transporte)}</td></tr>
          <tr><td>Mano de obra</td><td class="num">$${fmt(c.mano_obra)}</td></tr>
          <tr><td>Secado (${fmt(i.agua_a_evaporar_kg, 1)} kg de agua)</td><td class="num">$${fmt(c.secado)}</td></tr>
        </tbody></table></div>
        <p class="suave pequeno">${esc(r.aviso)}</p>`;
    } catch (e) {
      $('#res-log').innerHTML = `<div class="alerta alta">${esc(e.message)} ${esc(Object.entries(e.detalles ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div>`;
    }
  });
}

// ---------- Ranking de oportunidades ----------

async function vistaRanking() {
  const r = await api('/oportunidades-ranking');
  vista.innerHTML = `
    <h1>Ranking de oportunidades</h1>
    <p class="suave">${esc(r.escala)} Las oportunidades descartadas no aparecen. Compare solo las que tengan todos los criterios evaluados.</p>
    <div class="tabla-contenedor"><table>
      <thead><tr><th>#</th><th>Oportunidad</th><th>Subproducto</th><th>Línea</th><th>Estado</th><th>Índice</th><th>Criterios</th></tr></thead>
      <tbody>${r.ranking.map((o, n) => `<tr data-id="${o.id}">
        <td class="num">${n + 1}</td><td>${esc(o.nombre)}</td><td>${esc(titulo(o.subproducto ?? '—'))}</td><td>${esc(titulo(o.linea ?? '—'))}</td>
        <td>${esc(titulo(o.estado ?? '—'))}</td><td class="num"><b>${o.indice ?? '—'}</b></td><td class="num">${o.criterios_evaluados}/15</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  vista.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => abrirFormulario('oportunidades', Number(tr.dataset.id), vistaRanking)));
}

// ---------- Gráficos simples (barras HTML con tooltip) ----------

const tooltip = Object.assign(document.createElement('div'), { className: 'tooltip', role: 'tooltip' });
document.body.append(tooltip);
document.addEventListener('pointerover', (ev) => {
  const el = ev.target.closest('[data-tip]');
  if (!el) { tooltip.classList.remove('visible'); return; }
  tooltip.innerHTML = el.dataset.tip;
  tooltip.classList.add('visible');
  const r = el.getBoundingClientRect();
  const x = Math.min(Math.max(r.left + r.width / 2, 90), innerWidth - 90);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${r.top + scrollY - 8}px`;
});

// barras: [{etiqueta, valor, rango?:[min,max], tip, clase}]
function graficoBarras(barras, { unidad = '', alto = 160, marcarIndice = null, etiquetaCada = 1 } = {}) {
  const max = Math.max(1, ...barras.map((b) => Math.max(b.valor ?? 0, b.rango?.[1] ?? 0)));
  const escala = (v) => `${Math.max(0, (v / max) * 100)}%`;
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 5, 10].map((k) => k * pot).find((s) => s >= bruto);
  const lineas = [];
  for (let v = paso; v <= max; v += paso) lineas.push(`<div class="g-linea" style="bottom:${escala(v)}"><span>${v}</span></div>`);
  const iMax = barras.reduce((im, b, i) => ((b.valor ?? 0) > (barras[im].valor ?? 0) ? i : im), 0);
  return `<div class="grafico" style="height:${alto}px" role="img" aria-label="Gráfico de barras en ${esc(unidad)}">
    <div class="g-area">${lineas.join('')}
      ${barras.map((b, i) => `<div class="g-col ${i === marcarIndice ? 'g-hoy' : ''}" data-tip="${esc(b.tip)}">
        ${b.rango ? `<div class="g-rango" style="bottom:${escala(b.rango[0])};height:calc(${escala(b.rango[1])} - ${escala(b.rango[0])})"></div>` : ''}
        <div class="g-barra ${b.clase ?? ''}" style="height:${escala(b.valor ?? 0)}">${i === iMax && b.valor ? `<span class="g-valor">${fmt(b.valor, 0)}</span>` : ''}</div>
      </div>`).join('')}
    </div>
    <div class="g-ejes">${barras.map((b, i) => `<span>${i % etiquetaCada === 0 ? esc(b.etiqueta) : ''}</span>`).join('')}</div>
  </div>`;
}

const diaCorto = (f) => { const [, m, d] = f.split('-'); return `${Number(d)}/${Number(m)}`; };
const NIVEL_ALERTA = { alto: 'alta', medio: 'media', info: 'info' };

// ---------- Predicción y riesgos ----------

async function vistaPrediccion() {
  vista.innerHTML = '<h1>Predicción y riesgos</h1><p class="suave">Consultando el pronóstico para la ubicación de la finca…</p>';
  const p = await api('/prediccion');
  const dias = [...p.historial.slice(-14), ...p.pronostico];
  const iHoy = dias.findIndex((d) => d.fecha === p.hoy);
  const u = p.ubicacion;

  const barrasLluvia = dias.map((d) => ({
    etiqueta: diaCorto(d.fecha),
    valor: d.lluvia_mm,
    clase: d.fecha < p.hoy ? 'g-pasado' : '',
    tip: `<b>${d.fecha}${d.fecha < p.hoy ? ' (registrado)' : d.fecha === p.hoy ? ' (hoy)' : ' (pronóstico)'}</b><br>Lluvia: ${fmt(d.lluvia_mm, 1)} mm${d.prob_lluvia != null && d.fecha >= p.hoy ? ` · prob. ${d.prob_lluvia}%` : ''}<br>${d.modelos_n > 1 ? `Entre modelos: ${fmt(d.lluvia_min_mm, 1)}–${fmt(d.lluvia_max_mm, 1)} mm<br>` : ''}Temp: ${fmt(d.tmin, 1)}–${fmt(d.tmax, 1)} °C · HR ${fmt(d.hr_media)}%`,
  }));

  const labores = Object.entries(p.ventanas);
  const enso = p.enso?.actual;

  vista.innerHTML = `
    <h1>Predicción y riesgos <span class="suave pequeno">${esc(u.finca)} · ${u.latitud}, ${u.longitud} · modelo a ${fmt(u.elevacion_modelo_m)} m</span></h1>
    ${p.fuentes.pronostico.desactualizado ? '<div class="alerta media">Sin conexión: se muestra el último pronóstico guardado.</div>' : ''}
    <div class="cifras">
      <div class="cifra"><b>${fmt(p.resumen.lluvia_ultimos_7d_mm, 1)}</b><span>mm lluvia últimos 7 días</span></div>
      <div class="cifra"><b>${fmt(p.resumen.lluvia_proximos_7d_mm, 1)}</b><span>mm pronosticados próximos 7 días</span></div>
      <div class="cifra"><b>${p.resumen.dias_con_lluvia_proximos_7d}/7</b><span>días con lluvia próxima semana</span></div>
      <div class="cifra"><b>${enso ? (enso.fase === 'el_nino' ? 'El Niño' : enso.fase === 'la_nina' ? 'La Niña' : 'Neutral') : '—'}</b><span>ENSO ${enso ? `(ONI ${enso.anomalia > 0 ? '+' : ''}${enso.anomalia})` : ''}</span></div>
    </div>

    <section class="tarjeta">
      <h2>Riesgos y qué hacer</h2>
      ${p.riesgos.length ? p.riesgos.map((r) => `
        <details class="alerta ${NIVEL_ALERTA[r.nivel]}" ${r.nivel === 'alto' ? 'open' : ''}>
          <summary><b>${esc(r.nombre)}</b> · ${esc(r.nivel)} · ${esc(r.periodo.desde)} a ${esc(r.periodo.hasta)}</summary>
          <ul class="limpia pequeno">${r.evidencia.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          <p class="pequeno" style="margin:6px 0 2px"><b>Recomendaciones</b></p>
          <ul class="limpia pequeno">${r.recomendaciones.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          <p class="suave pequeno">Confianza: ${esc(r.confianza)}</p>
        </details>`).join('') : '<p class="suave">Sin riesgos destacados en el horizonte del pronóstico.</p>'}
    </section>

    <section class="tarjeta" style="margin-top:12px">
      <h2>Lluvia diaria (mm): últimos 14 días y pronóstico a 16 días</h2>
      <p class="suave pequeno"><span class="muestra g-pasado"></span> estimado por modelos · <span class="muestra"></span> pronóstico · línea vertical = hoy · barra = mediana de ${esc((p.fuentes.pronostico.modelos ?? []).join(', '))}</p>
      <p class="suave pequeno">En montaña los modelos pueden diferir mucho en la lluvia (vea el rango en cada barra). Un pluviómetro en la finca permite calibrarlos: registre sus lecturas en Clima con fuente "estación".</p>
      ${graficoBarras(barrasLluvia, { unidad: 'mm', marcarIndice: iHoy, etiquetaCada: 3 })}
    </section>

    <section class="tarjeta" style="margin-top:12px">
      <h2>Mejores días para cada labor</h2>
      <p class="suave pequeno">✓ apto · ✗ no recomendable (pase el cursor o toque para ver el motivo).</p>
      <div class="tabla-contenedor"><table class="ventanas">
        <thead><tr><th>Labor</th>${p.pronostico.map((d) => `<th>${diaCorto(d.fecha)}</th>`).join('')}</tr></thead>
        <tbody>${labores.map(([, v]) => `<tr><td>${esc(v.nombre)}</td>${v.dias.map((d) => `<td class="${d.apto ? 'si' : 'no'}" data-tip="${esc(d.fecha)}: ${esc(d.apto ? 'apto' : d.motivos.join('; '))}">${d.apto ? '✓' : '✗'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="tarjeta" style="margin-top:12px">
      <h2>Pronóstico detallado</h2>
      <div class="tabla-contenedor"><table>
        <thead><tr><th>Fecha</th><th>Lluvia mm</th><th>Rango modelos</th><th>Prob. %</th><th>Mín °C</th><th>Máx °C</th><th>HR %</th><th>Ráfaga m/s</th><th>ET0 mm</th></tr></thead>
        <tbody>${p.pronostico.map((d) => `<tr><td>${d.fecha}</td><td class="num">${fmt(d.lluvia_mm, 1)}</td><td class="num">${d.modelos_n > 1 ? `${fmt(d.lluvia_min_mm, 1)}–${fmt(d.lluvia_max_mm, 1)}` : '—'}</td><td class="num">${fmt(d.prob_lluvia)}</td><td class="num">${fmt(d.tmin, 1)}</td><td class="num">${fmt(d.tmax, 1)}</td><td class="num">${fmt(d.hr_media)}</td><td class="num">${fmt(d.rafaga_max, 1)}</td><td class="num">${fmt(d.et0_mm, 1)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="tarjeta" style="margin-top:12px" id="climatologia">
      <h2>¿Qué suele pasar en esta ubicación?</h2><p class="suave">Cargando 10 años de datos climáticos (la primera vez puede tardar unos segundos)…</p>
    </section>
    <p class="suave pequeno" style="margin-top:12px">${esc(p.aviso)} Fuentes: Open-Meteo${p.enso ? ', NOAA CPC (ONI)' : ''}. Actualizado ${esc(new Date(p.fuentes.pronostico.obtenido_en).toLocaleString('es-CO'))}.</p>`;

  const clima = await api('/prediccion/climatologia').catch((e) => ({ error: e.message }));
  const seccion = $('#climatologia');
  if (!seccion) return; // el usuario cambió de vista
  seccion.innerHTML = clima.error ? `<h2>Climatología</h2><div class="alerta media">${esc(clima.error)}</div>` : `
      <h2>¿Qué suele pasar en esta ubicación? Lluvia mensual (mm), ${esc(clima.periodo.inicio.slice(0, 4))}–${esc(clima.periodo.fin.slice(0, 4))}</h2>
      <p class="suave pequeno">Barra = promedio · franja = entre un año seco y uno lluvioso · ${fmt(clima.lluvia_anual_media_mm)} mm/año · ${fmt(clima.tmedia_anual_c, 1)} °C de media</p>
      ${graficoBarras(clima.meses.map((m) => ({
        etiqueta: m.nombre.slice(0, 3),
        valor: m.lluvia_media_mm,
        rango: [m.lluvia_anio_seco_mm, m.lluvia_anio_lluvioso_mm],
        tip: `<b>${m.nombre}</b><br>Promedio ${fmt(m.lluvia_media_mm)} mm (${fmt(m.dias_lluvia_media)} días con lluvia)<br>Año seco ${fmt(m.lluvia_anio_seco_mm)} · lluvioso ${fmt(m.lluvia_anio_lluvioso_mm)} mm<br>Temp ${fmt(m.tmin_media_c, 1)}–${fmt(m.tmax_media_c, 1)} °C · balance ${fmt(m.balance_mm)} mm`,
      })), { unidad: 'mm', marcarIndice: Number(p.hoy.slice(5, 7)) - 1 })}
      <h2 style="margin-top:14px">Próximos meses</h2>
      <ul class="limpia">${clima.proximos_meses.map((m) => `<li><b>${esc(m.nombre)}:</b> ${esc(m.que_esperar)}</li>`).join('')}</ul>
      <p class="suave pequeno">${esc(clima.aviso)}</p>`;
}

// ---------- Plan de cultivo ----------

async function vistaPlan() {
  const [agenda, lotes] = await Promise.all([api('/plan/agenda?dias=30'), api('/lotes?orden=id&dir=asc')]);
  const CLASE_CLIMA = { apto: 'alta', mover: 'media', sin_dia_apto: 'baja' };

  vista.innerHTML = `
    <h1>Plan de cultivo <span class="suave pequeno">próximos 30 días</span></h1>
    ${agenda.aviso_clima ? `<div class="alerta media">${esc(agenda.aviso_clima)}</div>` : ''}
    <section class="tarjeta">
      <h2>Generar plan base por lote</h2>
      <p class="suave pequeno">Crea tareas repetitivas según la etapa del lote (vivero, levante, producción, renovación). Ajuste producto, dosis y frecuencias con el agrónomo en <a href="#/plan_labores">Tareas del plan</a>.</p>
      <div class="herramientas">${lotes.datos.map((l) => `<button data-generar="${l.id}">${esc(l.nombre)} (${esc(l.estado ?? 'sin etapa')})</button>`).join('')}</div>
    </section>

    <h2 style="margin-top:16px">Agenda</h2>
    ${agenda.datos.length ? `<div class="tabla-contenedor"><table>
      <thead><tr><th>Fecha</th><th>Lote</th><th>Tarea</th><th>Prioridad</th><th>Clima</th><th></th></tr></thead>
      <tbody>${agenda.datos.map((t) => `<tr class="${t.proyectada ? 'proyectada' : ''}" ${t.id ? `data-id="${t.id}"` : ''}>
        <td>${esc(t.fecha_programada)}${t.vencida ? ` <span class="chip baja">${t.dias_vencida} d atrasada</span>` : ''}${t.proyectada ? ' <span class="chip">repetición</span>' : ''}</td>
        <td>${esc(t.lote)}</td>
        <td style="white-space:normal;min-width:220px">${esc(t.titulo)}</td>
        <td>${esc(t.prioridad ?? '')}</td>
        <td style="white-space:normal;min-width:200px">${t.clima ? `<span class="chip ${CLASE_CLIMA[t.clima.estado] ?? ''}">${esc(titulo(t.clima.estado))}</span> ` : ''}<span class="pequeno">${esc(t.consejo ?? '')}</span></td>
        <td>${t.id ? `<button data-completar="${t.id}">Completar</button>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="tarjeta vacio">No hay tareas en los próximos 30 días. Genere el plan base de un lote.</div>'}`;

  vista.querySelectorAll('[data-generar]').forEach((b) => b.addEventListener('click', async () => {
    try {
      let r;
      try {
        r = await api('/plan/generar', { metodo: 'POST', cuerpo: { lote_id: Number(b.dataset.generar) } });
      } catch (e) {
        if (!/reemplazar/.test(e.message) || !confirm(`${e.message.split('.')[0]}. ¿Regenerar las tareas de plantilla pendientes?`)) throw e;
        r = await api('/plan/generar', { metodo: 'POST', cuerpo: { lote_id: Number(b.dataset.generar), reemplazar: true } });
      }
      avisar(`${r.lote}: ${r.datos.length} tareas creadas (etapa ${r.etapa}).`);
      vistaPlan();
    } catch (e) {
      avisar(e.message);
    }
  }));

  vista.querySelectorAll('[data-completar]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const notas = prompt('Notas de la labor realizada (opcional):', '');
    if (notas === null) return;
    try {
      const r = await api(`/plan/${b.dataset.completar}/completar`, { metodo: 'POST', cuerpo: { notas } });
      avisar(r.siguiente ? `Labor registrada. Próxima: ${r.siguiente.fecha_programada}.` : 'Labor registrada.');
      vistaPlan();
    } catch (e) {
      avisar(e.message);
    }
  }));

  vista.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => abrirFormulario('plan_labores', Number(tr.dataset.id), vistaPlan)));
}

// ---------- Inicio ----------

dialogo.addEventListener('close', () => { formDialogo.innerHTML = ''; });
window.addEventListener('hashchange', enrutar);

// Si el enlace trae la clave (…/?token=…), se guarda y se quita de la dirección
// para que no quede a la vista ni en lo que se comparta después.
const tokenEnlace = new URLSearchParams(location.search).get('token');
if (tokenEnlace) {
  try { localStorage.setItem('cafe_token', tokenEnlace); } catch { /* sin almacenamiento */ }
  history.replaceState(null, '', location.pathname + location.hash);
}

async function arrancar() {
  esquema = await api('/esquema');
  usuario = (await api('/yo').catch(() => null))?.usuario ?? null;
  await enrutar();
  refrescarIndicadores();
}

try {
  await arrancar();
} catch (e) {
  if (e.auth) pantallaAcceso();
  else vista.innerHTML = `<div class="alerta alta">No se pudo conectar con el servidor: ${esc(e.message)}</div>`;
}

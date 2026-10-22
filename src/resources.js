// Definición única del modelo de datos.
// De aquí se derivan: tablas SQLite, validación, rutas CRUD y formularios del panel.
//
// Tipos de campo:
//   texto | entero | real | fecha (AAAA-MM-DD) | fechahora (ISO) | opcion | json | ref
// Todas las tablas tienen además: id, creado_en, actualizado_en.

import {
  ESTADOS_CAFE, TIPOS_PROCESO, NIVELES_MOLIENDA, PERFILES_TUESTE, CANALES_VENTA,
} from './conocimiento/procesos_cafe.js';

export const SUBPRODUCTOS = [
  'pulpa', 'cascara', 'mucilago', 'pergamino', 'cascarilla_silverskin',
  'borra', 'podas_madera', 'aguas_mieles',
];

export const TIPOS_LABOR = [
  'fertilizacion', 'poda', 'tratamiento_fitosanitario', 'control_arvenses', 'siembra', 'resiembra',
  'riego', 'muestreo', 'monitoreo_plagas', 'registro_floracion', 'vuelo_dron', 'cosecha', 'otra',
];

const PUNTAJE = { tipo: 'entero', min: 1, max: 5 };

// Criterios de la matriz de oportunidades (plan maestro §35).
// Escala de FAVORABILIDAD 1–5: 5 siempre es lo más conveniente
// (p. ej. inversion=5 significa inversión muy baja; regulacion=5, casi sin trámites).
export const CRITERIOS_OPORTUNIDAD = [
  ['disponibilidad', 'Disponibilidad de materia prima'],
  ['costo_adquisicion', 'Costo de adquisición (5 = muy bajo)'],
  ['logistica', 'Logística (5 = muy sencilla)'],
  ['estabilidad', 'Estabilidad / humedad (5 = muy estable)'],
  ['complejidad_tecnica', 'Complejidad técnica (5 = muy simple)'],
  ['inversion', 'Inversión inicial (5 = muy baja)'],
  ['rendimiento', 'Rendimiento del proceso'],
  ['precio_venta', 'Precio de venta potencial'],
  ['demanda', 'Demanda / tamaño de mercado'],
  ['competencia', 'Competencia (5 = poca)'],
  ['regulacion', 'Regulación (5 = pocos requisitos)'],
  ['diferenciacion', 'Diferenciación'],
  ['propiedad_intelectual', 'Posibilidad de propiedad intelectual'],
  ['escalabilidad', 'Escalabilidad'],
  ['impacto_ambiental', 'Impacto ambiental positivo'],
];

export const recursos = {
  fincas: {
    etiqueta: 'Fincas',
    campoEtiqueta: 'nombre',
    campos: {
      nombre: { tipo: 'texto', requerido: true },
      municipio: { tipo: 'texto' },
      departamento: { tipo: 'texto' },
      vereda: { tipo: 'texto' },
      hectareas: { tipo: 'real', min: 0 },
      latitud: { tipo: 'real', min: -90, max: 90 },
      longitud: { tipo: 'real', min: -180, max: 180 },
      altitud_msnm: { tipo: 'entero', min: 0 },
      notas: { tipo: 'texto', largo: true },
    },
  },

  lotes: {
    etiqueta: 'Lotes',
    campoEtiqueta: 'nombre',
    campoFecha: 'fecha_siembra',
    campos: {
      finca_id: { tipo: 'ref', ref: 'fincas', requerido: true },
      nombre: { tipo: 'texto', requerido: true },
      variedad: { tipo: 'texto' },
      num_plantas: { tipo: 'entero', min: 0 },
      fecha_siembra: { tipo: 'fecha' },
      area_ha: { tipo: 'real', min: 0 },
      estado: { tipo: 'opcion', opciones: ['vivero', 'levante', 'produccion', 'renovacion', 'inactivo'] },
      geometria: { tipo: 'json', geojson: true, ayuda: 'Polígono GeoJSON del lote (se dibuja en el Mapa)' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  actividades: {
    etiqueta: 'Labores',
    campoEtiqueta: 'tipo',
    campoFecha: 'fecha',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      tipo: { tipo: 'opcion', requerido: true, opciones: TIPOS_LABOR },
      producto: { tipo: 'texto' },
      dosis: { tipo: 'real', min: 0 },
      unidad: { tipo: 'texto', ayuda: 'g/planta, kg/ha, L/ha, cc/bomba…' },
      plantas_intervenidas: { tipo: 'entero', min: 0 },
      jornales: { tipo: 'real', min: 0 },
      costo_cop: { tipo: 'real', min: 0 },
      responsable: { tipo: 'texto' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Plan de cultivo: labores programadas. Al completarse generan una actividad
  // y, si se repiten, la siguiente tarea.
  plan_labores: {
    etiqueta: 'Plan de cultivo',
    campoEtiqueta: 'titulo',
    campoFecha: 'fecha_programada',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      tipo: { tipo: 'opcion', requerido: true, opciones: TIPOS_LABOR },
      titulo: { tipo: 'texto', requerido: true },
      fecha_programada: { tipo: 'fecha', requerido: true },
      ventana_dias: { tipo: 'entero', min: 0, max: 30, defecto: 3, ayuda: 'Flexibilidad ± días para buscar buen clima' },
      repetir_cada_dias: { tipo: 'entero', min: 1, ayuda: 'Vacío = no se repite' },
      prioridad: { tipo: 'opcion', opciones: ['alta', 'media', 'baja'], defecto: 'media' },
      estado: { tipo: 'opcion', opciones: ['pendiente', 'hecha', 'cancelada'], defecto: 'pendiente' },
      producto: { tipo: 'texto' },
      dosis: { tipo: 'real', min: 0 },
      unidad: { tipo: 'texto' },
      responsable: { tipo: 'texto' },
      origen: { tipo: 'opcion', opciones: ['manual', 'plantilla', 'recomendacion'], defecto: 'manual' },
      actividad_id: { tipo: 'ref', ref: 'actividades', ayuda: 'Labor registrada al completar' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  observaciones: {
    etiqueta: 'Observaciones',
    campoEtiqueta: 'problema',
    campoFecha: 'fecha',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      categoria: {
        tipo: 'opcion', requerido: true,
        opciones: ['plaga', 'enfermedad', 'nutricion', 'clima', 'fisiologico', 'crecimiento', 'otra'],
      },
      problema: { tipo: 'texto', ayuda: 'roya, broca, mancha de hierro, clorosis…' },
      severidad: { tipo: 'entero', min: 1, max: 5, ayuda: '1 leve – 5 muy grave' },
      incidencia_pct: { tipo: 'real', min: 0, max: 100, ayuda: '% de plantas afectadas' },
      planta_ref: { tipo: 'texto', ayuda: 'ID de planta, surco o zona' },
      latitud: { tipo: 'real', min: -90, max: 90 },
      longitud: { tipo: 'real', min: -180, max: 180 },
      estado: { tipo: 'opcion', opciones: ['abierta', 'en_seguimiento', 'resuelta'], defecto: 'abierta' },
      revisado_por: { tipo: 'texto', ayuda: 'Agrónomo u otra persona que validó' },
      comentario: { tipo: 'texto', largo: true },
    },
  },

  // La floración es un evento de primera clase (Cenicafé; plan §12).
  floraciones: {
    etiqueta: 'Floraciones',
    campoEtiqueta: 'fecha',
    campoFecha: 'fecha',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      intensidad: { tipo: 'entero', min: 1, max: 5, requerido: true, ayuda: '1 escasa – 5 floración principal' },
      porcentaje_plantas: { tipo: 'real', min: 0, max: 100 },
      es_principal: { tipo: 'opcion', opciones: ['si', 'no'], defecto: 'no' },
      observaciones: { tipo: 'texto', largo: true },
    },
  },

  clima: {
    etiqueta: 'Clima',
    campoEtiqueta: 'fecha_hora',
    campoFecha: 'fecha_hora',
    unico: ['finca_id', 'fecha_hora', 'fuente'],
    campos: {
      finca_id: { tipo: 'ref', ref: 'fincas', requerido: true },
      fecha_hora: { tipo: 'fechahora', requerido: true },
      temperatura_c: { tipo: 'real' },
      humedad_rel_pct: { tipo: 'real', min: 0, max: 100 },
      precipitacion_mm: { tipo: 'real', min: 0 },
      radiacion_wm2: { tipo: 'real', min: 0 },
      viento_ms: { tipo: 'real', min: 0 },
      fuente: { tipo: 'opcion', opciones: ['manual', 'estacion', 'sensor', 'open_meteo'], requerido: true, defecto: 'manual' },
      evento_extremo: { tipo: 'texto', ayuda: 'granizo, vendaval, sequía…' },
    },
  },

  suelo: {
    etiqueta: 'Suelo',
    campoEtiqueta: 'fecha',
    campoFecha: 'fecha',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      fuente: { tipo: 'opcion', opciones: ['laboratorio', 'sensor', 'campo'], requerido: true },
      profundidad_cm: { tipo: 'real', min: 0 },
      humedad_pct: { tipo: 'real', min: 0, max: 100 },
      temperatura_c: { tipo: 'real' },
      ph: { tipo: 'real', min: 0, max: 14 },
      conductividad_ds_m: { tipo: 'real', min: 0 },
      materia_organica_pct: { tipo: 'real', min: 0, max: 100 },
      nutrientes: { tipo: 'json', ayuda: '{"N_pct":0.3,"P_ppm":12,"K_cmol":0.4,…}' },
      laboratorio: { tipo: 'texto' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Protocolo de vuelos de dron (plan §7): todo vuelo con condiciones repetibles.
  vuelos: {
    etiqueta: 'Vuelos de dron',
    campoEtiqueta: 'fecha',
    campoFecha: 'fecha',
    campos: {
      finca_id: { tipo: 'ref', ref: 'fincas', requerido: true },
      lote_id: { tipo: 'ref', ref: 'lotes' },
      fecha: { tipo: 'fecha', requerido: true },
      hora: { tipo: 'texto', ayuda: 'HH:MM (ideal: siempre la misma franja)' },
      altura_m: { tipo: 'real', min: 0 },
      velocidad_ms: { tipo: 'real', min: 0 },
      solape_frontal_pct: { tipo: 'real', min: 0, max: 100 },
      solape_lateral_pct: { tipo: 'real', min: 0, max: 100 },
      condiciones_luz: { tipo: 'opcion', opciones: ['sol_directo', 'parcial', 'nublado'] },
      camara: { tipo: 'texto', ayuda: 'RGB, multiespectral, modelo…' },
      configuracion: { tipo: 'texto', ayuda: 'ISO, obturación, balance de blancos…' },
      ruta: { tipo: 'texto', ayuda: 'Nombre del plan de vuelo guardado' },
      archivo_original: { tipo: 'texto', ayuda: 'Carpeta/enlace a fotos originales' },
      ortomosaico: { tipo: 'texto', ayuda: 'Carpeta/enlace al ortomosaico' },
      observaciones_campo: { tipo: 'texto', largo: true },
    },
  },

  cosechas: {
    etiqueta: 'Cosechas',
    campoEtiqueta: 'fecha',
    campoFecha: 'fecha',
    campos: {
      lote_id: { tipo: 'ref', ref: 'lotes', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      kg_cereza: { tipo: 'real', min: 0 },
      kg_pergamino_seco: { tipo: 'real', min: 0 },
      plantas_cosechadas: { tipo: 'entero', min: 0 },
      proceso: { tipo: 'opcion', opciones: ['lavado', 'natural', 'honey', 'fermentacion_experimental', 'otro'] },
      humedad_grano_pct: { tipo: 'real', min: 0, max: 100 },
      factor_rendimiento: { tipo: 'real', min: 0 },
      puntaje_taza: { tipo: 'real', min: 0, max: 100 },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Red regional (plan §24).
  productores: {
    etiqueta: 'Productores',
    campoEtiqueta: 'nombre',
    campos: {
      nombre: { tipo: 'texto', requerido: true },
      finca: { tipo: 'texto' },
      municipio: { tipo: 'texto' },
      vereda: { tipo: 'texto' },
      telefono: { tipo: 'texto' },
      relacion: { tipo: 'opcion', opciones: ['vecino', 'amigo', 'conocido', 'asociado', 'familiar', 'otro'] },
      latitud: { tipo: 'real', min: -90, max: 90 },
      longitud: { tipo: 'real', min: -180, max: 180 },
      hectareas: { tipo: 'real', min: 0 },
      variedades: { tipo: 'texto' },
      produccion_kg_cereza_anual: { tipo: 'real', min: 0 },
      proceso_beneficio: { tipo: 'opcion', opciones: ['lavado', 'natural', 'honey', 'varios', 'no_beneficia'] },
      meses_cosecha: { tipo: 'texto', ayuda: 'p. ej. oct-dic, abr-may' },
      manejo_residuos_actual: { tipo: 'texto' },
      disposicion: { tipo: 'opcion', opciones: ['regalar', 'vender', 'acordar', 'no_definido'], defecto: 'no_definido' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Inventario de biomasa: cada registro es una partida concreta de subproducto.
  subproductos: {
    etiqueta: 'Subproductos',
    campoEtiqueta: 'tipo',
    campoFecha: 'fecha',
    campos: {
      tipo: { tipo: 'opcion', opciones: SUBPRODUCTOS, requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      kg_frescos: { tipo: 'real', min: 0, requerido: true },
      humedad_pct: { tipo: 'real', min: 0, max: 100 },
      kg_secos: { tipo: 'real', min: 0, ayuda: 'Medido; si falta se estima con la humedad' },
      origen: { tipo: 'opcion', opciones: ['finca_propia', 'productor', 'cafeteria', 'tostador', 'otro'], requerido: true },
      finca_id: { tipo: 'ref', ref: 'fincas' },
      lote_id: { tipo: 'ref', ref: 'lotes' },
      productor_id: { tipo: 'ref', ref: 'productores' },
      estado: {
        tipo: 'opcion', defecto: 'disponible',
        opciones: ['disponible', 'recolectado', 'almacenado', 'en_proceso', 'transformado', 'descartado'],
      },
      distancia_km: { tipo: 'real', min: 0 },
      costo_adquisicion_cop: { tipo: 'real', min: 0 },
      costo_transporte_cop: { tipo: 'real', min: 0 },
      costo_proceso_cop: { tipo: 'real', min: 0 },
      proceso_aplicado: { tipo: 'texto' },
      destino: { tipo: 'texto' },
      producto_obtenido: { tipo: 'texto' },
      kg_producto: { tipo: 'real', min: 0 },
      kg_residuo_final: { tipo: 'real', min: 0 },
      notas: { tipo: 'texto', largo: true },
    },
  },

  oportunidades: {
    etiqueta: 'Oportunidades',
    campoEtiqueta: 'nombre',
    campos: {
      nombre: { tipo: 'texto', requerido: true },
      subproducto: { tipo: 'opcion', opciones: SUBPRODUCTOS },
      linea: { tipo: 'opcion', opciones: ['bioinsumos', 'biomateriales', 'ingredientes', 'energia', 'otra'] },
      descripcion: { tipo: 'texto', largo: true },
      estado: {
        tipo: 'opcion', defecto: 'idea',
        opciones: ['idea', 'investigacion', 'prototipo', 'validacion', 'seleccionada', 'descartada'],
      },
      ...Object.fromEntries(CRITERIOS_OPORTUNIDAD.map(([c, et]) => [c, { ...PUNTAJE, etiqueta: et }])),
      notas: { tipo: 'texto', largo: true },
    },
  },

  // ---------- Contabilidad y trazabilidad del café ----------

  // Un lote de café es la unidad que se sigue de principio a fin: entra por
  // compra o por cosecha propia y de ahí cuelgan los procesos, el inventario y
  // las ventas. El código del lote es el que va impreso en la bolsa.
  lotes_cafe: {
    etiqueta: 'Lotes de café',
    campoEtiqueta: 'codigo',
    campoFecha: 'fecha',
    unico: ['codigo'],
    columnas: ['codigo', 'fecha', 'variedad', 'kg_inicial', 'precio_cop_kg', 'estado'],
    campos: {
      codigo: { tipo: 'texto', requerido: true, ayuda: 'El que va en la bolsa: L2026-001, DT-01…' },
      fecha: { tipo: 'fecha', requerido: true, ayuda: 'Fecha de compra o de entrada del lote' },
      origen: { tipo: 'opcion', requerido: true, opciones: ['compra', 'finca_propia'], defecto: 'compra' },
      productor_id: { tipo: 'ref', ref: 'productores', ayuda: 'A quién se le compró' },
      proveedor: { tipo: 'texto', ayuda: 'Si el vendedor no está en Productores' },
      lote_id: { tipo: 'ref', ref: 'lotes', ayuda: 'Si es café propio: lote de la finca' },
      cosecha_id: { tipo: 'ref', ref: 'cosechas' },
      variedad: { tipo: 'texto', ayuda: 'castillo, caturra, colombia, tabi…' },
      proceso_beneficio: { tipo: 'opcion', opciones: ['lavado', 'natural', 'honey', 'fermentacion_experimental', 'desconocido'] },
      estado_inicial: { tipo: 'opcion', requerido: true, opciones: ESTADOS_CAFE, defecto: 'pergamino_seco' },
      kg_inicial: { tipo: 'real', min: 0, requerido: true },
      humedad_pct: { tipo: 'real', min: 0, max: 100, ayuda: 'Pergamino seco: 10–12 % es lo correcto' },
      factor_rendimiento: { tipo: 'real', min: 0, ayuda: 'Si se midió en la compra' },
      precio_cop_kg: { tipo: 'real', min: 0, ayuda: 'Precio pagado por kg' },
      valor_compra_cop: { tipo: 'real', min: 0, ayuda: 'Valor total pagado; si falta se calcula con el precio por kg' },
      costo_transporte_cop: { tipo: 'real', min: 0 },
      otros_costos_cop: { tipo: 'real', min: 0, ayuda: 'Empaque de llegada, análisis, comisiones…' },
      puntaje_taza: { tipo: 'real', min: 0, max: 100 },
      estado: {
        tipo: 'opcion', defecto: 'en_proceso',
        opciones: ['en_proceso', 'disponible', 'agotado', 'descartado'],
      },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Cada paso de transformación con sus kg reales y sus costos. De aquí sale el
  // costo por proceso y el costo acumulado por kg en cada estado.
  procesos_cafe: {
    etiqueta: 'Procesos',
    campoEtiqueta: 'tipo',
    campoFecha: 'fecha',
    columnas: ['fecha', 'tipo', 'lote_cafe_id', 'kg_entrada', 'kg_salida', 'registrado_por'],
    campos: {
      lote_cafe_id: { tipo: 'ref', ref: 'lotes_cafe', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      tipo: { tipo: 'opcion', requerido: true, opciones: TIPOS_PROCESO },
      estado_entrada: { tipo: 'opcion', requerido: true, opciones: ESTADOS_CAFE },
      estado_salida: { tipo: 'opcion', requerido: true, opciones: ESTADOS_CAFE },
      kg_entrada: { tipo: 'real', min: 0, requerido: true },
      kg_salida: { tipo: 'real', min: 0, ayuda: 'Pesar siempre: es lo que define el costo por kg' },
      kg_subproducto: { tipo: 'real', min: 0, ayuda: 'Cascarilla de la trilla, pasilla…' },
      subproducto_tipo: { tipo: 'opcion', opciones: SUBPRODUCTOS },
      valor_subproducto_cop: { tipo: 'real', min: 0, ayuda: 'Si el subproducto se vende o se usa: se descuenta del costo del lote' },
      maquila_cop: { tipo: 'real', min: 0, ayuda: 'Lo que se paga a un tercero por trillar o tostar' },
      mano_obra_cop: { tipo: 'real', min: 0 },
      jornales: { tipo: 'real', min: 0 },
      energia_cop: { tipo: 'real', min: 0, ayuda: 'Gas, luz, leña' },
      insumos_cop: { tipo: 'real', min: 0 },
      empaque_cop: { tipo: 'real', min: 0 },
      transporte_cop: { tipo: 'real', min: 0 },
      otros_cop: { tipo: 'real', min: 0 },
      perfil_tueste: { tipo: 'opcion', opciones: Object.keys(PERFILES_TUESTE) },
      molienda: { tipo: 'opcion', opciones: NIVELES_MOLIENDA },
      temperatura_c: { tipo: 'real' },
      duracion_min: { tipo: 'real', min: 0 },
      humedad_salida_pct: { tipo: 'real', min: 0, max: 100 },
      puntaje_taza: { tipo: 'real', min: 0, max: 100 },
      equipo: { tipo: 'texto', ayuda: 'Tostadora, trilladora, molino usado' },
      responsable: { tipo: 'texto' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Presentaciones de venta (lo que el cliente compra): bolsa de 250 g molido,
  // libra en grano, kg para cafetería…
  presentaciones: {
    etiqueta: 'Presentaciones',
    campoEtiqueta: 'nombre',
    columnas: ['nombre', 'estado_cafe', 'gramos', 'costo_empaque_cop', 'precio_venta_cop', 'activa'],
    campos: {
      nombre: { tipo: 'texto', requerido: true, ayuda: 'Bolsa 250 g molido, Libra grano…' },
      codigo: { tipo: 'texto' },
      estado_cafe: { tipo: 'opcion', requerido: true, opciones: ESTADOS_CAFE, defecto: 'tostado_grano' },
      gramos: { tipo: 'real', min: 0, requerido: true, ayuda: '250, 340 (libra), 500, 1000' },
      molienda: { tipo: 'opcion', opciones: NIVELES_MOLIENDA },
      costo_empaque_cop: { tipo: 'real', min: 0, ayuda: 'Bolsa, válvula, etiqueta y sello por unidad' },
      precio_venta_cop: { tipo: 'real', min: 0, ayuda: 'Precio de lista por unidad' },
      activa: { tipo: 'opcion', opciones: ['si', 'no'], defecto: 'si' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  ventas: {
    etiqueta: 'Ventas',
    campoEtiqueta: 'cliente',
    campoFecha: 'fecha',
    columnas: ['fecha', 'cliente', 'canal', 'unidades', 'total_cop', 'estado_pago', 'registrado_por'],
    campos: {
      fecha: { tipo: 'fecha', requerido: true },
      lote_cafe_id: { tipo: 'ref', ref: 'lotes_cafe', ayuda: 'De qué lote salió (trazabilidad)' },
      presentacion_id: { tipo: 'ref', ref: 'presentaciones' },
      estado_cafe: { tipo: 'opcion', opciones: ESTADOS_CAFE, ayuda: 'Si se vende a granel, sin presentación' },
      cliente: { tipo: 'texto' },
      canal: { tipo: 'opcion', requerido: true, opciones: Object.keys(CANALES_VENTA), defecto: 'directo' },
      unidades: { tipo: 'real', min: 0, ayuda: 'Bolsas vendidas' },
      kg: { tipo: 'real', min: 0, ayuda: 'Si falta, se calcula con los gramos de la presentación' },
      precio_unitario_cop: { tipo: 'real', min: 0 },
      descuento_cop: { tipo: 'real', min: 0 },
      total_cop: { tipo: 'real', min: 0, ayuda: 'Si falta, se calcula: unidades × precio − descuento' },
      estado_pago: { tipo: 'opcion', opciones: ['pagado', 'pendiente', 'parcial'], defecto: 'pagado' },
      fecha_pago: { tipo: 'fecha' },
      documento: { tipo: 'texto', ayuda: 'Factura, remisión o recibo' },
      notas: { tipo: 'texto', largo: true },
    },
  },

  // Gastos que no son de un lote en particular (o que sí, con lote_cafe_id).
  // Los que no tienen lote se reparten entre los kg producidos del periodo.
  gastos: {
    etiqueta: 'Gastos',
    campoEtiqueta: 'descripcion',
    campoFecha: 'fecha',
    columnas: ['fecha', 'descripcion', 'categoria', 'valor_cop', 'tipo_costo', 'amortizar_meses'],
    campos: {
      fecha: { tipo: 'fecha', requerido: true },
      categoria: {
        tipo: 'opcion', requerido: true,
        opciones: [
          'empaque', 'etiquetas', 'transporte', 'servicios', 'arriendo', 'mano_obra',
          'equipos', 'mantenimiento', 'marketing', 'registro_sanitario', 'analisis_calidad',
          'impuestos', 'financieros', 'insumos_finca', 'otros',
        ],
      },
      descripcion: { tipo: 'texto', requerido: true },
      valor_cop: { tipo: 'real', min: 0, requerido: true },
      proveedor: { tipo: 'texto' },
      lote_cafe_id: { tipo: 'ref', ref: 'lotes_cafe', ayuda: 'Solo si el gasto es de ese lote; si no, se reparte' },
      tipo_costo: {
        tipo: 'opcion', defecto: 'operativo',
        opciones: ['operativo', 'inversion'],
        ayuda: 'Inversión (tostadora, molino, diseño de marca) no es costo de un solo mes: se amortiza',
      },
      amortizar_meses: {
        tipo: 'entero', min: 1, max: 240,
        ayuda: 'Solo para inversión: en cuántos meses se reparte. Tostadora ~60, molino ~36, diseño de empaques ~24',
      },
      valor_residual_cop: {
        tipo: 'real', min: 0,
        ayuda: 'Lo que cree que valdrá al final de su vida útil. La cuota se reparte sobre valor − residual',
      },
      fecha_venta: {
        tipo: 'fecha',
        ayuda: 'Si ya se vendió o se dio de baja: la amortización se detiene ese mes',
      },
      valor_venta_cop: {
        tipo: 'real', min: 0,
        ayuda: 'Lo que recibió por venderlo. Si fue menos de lo que quedaba en libros, la diferencia es pérdida',
      },
      medio_pago: { tipo: 'opcion', opciones: ['efectivo', 'transferencia', 'tarjeta', 'credito', 'otro'] },
      notas: { tipo: 'texto', largo: true },
    },
  },

  adjuntos: {
    etiqueta: 'Adjuntos',
    campoEtiqueta: 'nombre_original',
    soloLectura: true, // se crean por /api/adjuntos (subida de archivo)
    campos: {
      entidad: { tipo: 'texto', requerido: true },
      entidad_id: { tipo: 'entero', requerido: true },
      archivo: { tipo: 'texto', requerido: true },
      nombre_original: { tipo: 'texto' },
      mime: { tipo: 'texto' },
      tamano_bytes: { tipo: 'entero' },
      descripcion: { tipo: 'texto' },
    },
  },
};

// Marca de quién registró cada cosa. La pone el servidor según la clave con la
// que se entró (ver USUARIOS en .env.example), nunca el formulario: por eso va
// con `auto`, que la saca de los formularios y la protege de cambios. Solo en
// los registros del negocio, que son los que importa poder atribuir.
for (const tabla of ['lotes_cafe', 'procesos_cafe', 'ventas', 'gastos']) {
  recursos[tabla].campos.registrado_por = {
    tipo: 'texto',
    auto: true,
    ayuda: 'Lo pone el sistema según la clave con la que se entró',
  };
}

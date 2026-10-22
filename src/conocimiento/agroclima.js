// Reglas agroclimáticas — VERSIÓN INICIAL, para validar y ajustar con el agrónomo.
//
// No son diagnósticos: indican CONDICIONES que históricamente favorecen un problema
// o que hacen conveniente/inconveniente una labor. Los umbrales se pueden ajustar
// aquí sin tocar el resto del código; con datos propios (estación + registros de
// observaciones) deben calibrarse para la finca.

export const UMBRALES = {
  lluvia_intensa_mm: { medio: 30, alto: 50 },
  lluvia_acumulada_3d_mm: { alto: 100 },
  dia_seco_mm: 1, // un día con menos de esto cuenta como seco
  racha_seca_dias: { medio: 8, alto: 15 },
  deficit_hidrico_15d_mm: { medio: -30, alto: -60 }, // lluvia − evapotranspiración (ET0)

  // Roya: las esporas necesitan agua libre en la hoja; germinación óptima ~21–25 °C.
  // Con medias diarias (que incluyen la noche) se usa un rango más amplio.
  roya_tmedia_c: [17, 26],
  roya_hr_media_pct: 85,
  roya_dias_favorables_de_14: { medio: 7, alto: 10 },

  // Broca: los periodos secos y cálidos favorecen la emergencia y el vuelo.
  broca_racha_seca_dias: 7,
  broca_tmedia_c: 21,

  calor_tmax_c: { medio: 30, alto: 32 },
  frio_tmin_c: { medio: 8, alto: 4 },
  rafaga_ms: { medio: 12, alto: 17 },

  // Floración: suele abrir 7–12 días después de una lluvia que rompe un periodo seco.
  floracion_lluvia_disparo_mm: 10,
  floracion_racha_seca_previa_dias: 7,
  floracion_dias_despues: [7, 12],

  enso_oni: { moderado: 0.5, fuerte: 1.0 },
};

export const RECOMENDACIONES = {
  lluvia_intensa: [
    'No aplicar fertilizantes al suelo 24–48 h antes de lluvias fuertes (se lavan y se pierden).',
    'Revisar zanjas, desagües y caminos; vigilar taludes y zonas de pendiente.',
    'Mantener coberturas nobles en las calles para reducir la erosión.',
    'Proteger el compost y la pulpa de la lluvia para evitar lixiviados.',
  ],
  sequia: [
    'Priorizar los lotes jóvenes o recién trasplantados: riego de auxilio si hay agua disponible.',
    'Cubrir el plato de las plantas con material vegetal (podas, arvenses cortadas) para conservar humedad.',
    'No fertilizar al suelo sin humedad; esperar la lluvia.',
    'Aumentar el monitoreo de broca, minador y arañita roja.',
  ],
  roya: [
    'Intensificar el monitoreo de incidencia de roya por lote (muestreo de hojas).',
    'Revisar con el agrónomo el calendario de manejo según la fecha de la floración principal.',
    'Registrar cada observación con foto: construye el dataset para modelos futuros.',
    'Mantener la nutrición al día: plantas bien nutridas toleran mejor la enfermedad.',
  ],
  broca: [
    'Hacer muestreo de frutos brocados por lote.',
    'Recoger los frutos maduros, sobremaduros y caídos (repase o "re-re").',
    'Consultar con el agrónomo el control biológico o las trampas.',
  ],
  calor: [
    'Evitar labores pesadas al mediodía; hidratación del personal.',
    'Si hay floración reciente, anotar posibles pérdidas de flor.',
    'Evaluar sombrío transitorio en los lotes jóvenes.',
  ],
  frio: ['Revisar hojas tiernas y brotes después del evento y registrar los daños.'],
  viento: [
    'No hacer aspersiones (hay deriva y se pierde el producto).',
    'Revisar el sombrío y las ramas que puedan caer; asegurar plásticos y marquesinas.',
  ],
  floracion: [
    'Recorrer los lotes y registrar la floración (fecha, intensidad, fotos) en el módulo Floraciones.',
    'La floración principal define la ventana de cosecha y el manejo de roya.',
  ],
  el_nino: [
    'Tendencia a menos lluvia y más calor en la región Andina: preparar el manejo de sequía.',
    'Mayor riesgo de broca y de incendios; asegurar agua para los lotes jóvenes.',
  ],
  la_nina: [
    'Tendencia a más lluvia en la región Andina: mayor riesgo de roya, erosión y deslizamientos.',
    'Revisar drenajes y planear un secado de café bajo techo.',
  ],
};

// Condiciones para que un día sea apto para cada labor (pronóstico diario).
// Cada regla devuelve un motivo en contra (texto) o null si la condición se cumple.
export const VENTANAS_LABORES = {
  fertilizacion: {
    nombre: 'Fertilización al suelo',
    reglas: [
      (d) => (d.lluvia_mm > 20 ? `lluvia fuerte ese día (${d.lluvia_mm} mm)` : null),
      (d, ctx) => (ctx.siguiente && ctx.siguiente.lluvia_mm >= 30 ? `lluvia fuerte al día siguiente (${ctx.siguiente.lluvia_mm} mm)` : null),
      (_d, ctx) => (ctx.lluviaPrevia3d < 5 && ctx.dia.lluvia_mm < 2 ? 'suelo probablemente seco (poca lluvia en los 3 días previos)' : null),
    ],
  },
  tratamiento_fitosanitario: {
    nombre: 'Aspersión / fumigación',
    reglas: [
      (d) => (d.lluvia_mm >= 2 ? `lluvia prevista (${d.lluvia_mm} mm)` : null),
      (d) => (d.prob_lluvia != null && d.prob_lluvia >= 60 ? `probabilidad de lluvia ${d.prob_lluvia}%` : null),
      (d) => (d.viento_max != null && d.viento_max > 4 ? `viento hasta ${d.viento_max} m/s` : null),
    ],
  },
  control_arvenses: {
    nombre: 'Control de arvenses',
    reglas: [
      (d) => (d.lluvia_mm >= 10 ? `lluvia prevista (${d.lluvia_mm} mm)` : null),
    ],
  },
  poda: {
    nombre: 'Poda / zoqueo',
    reglas: [
      (d) => (d.lluvia_mm >= 5 ? `lluvia prevista (${d.lluvia_mm} mm): los cortes húmedos se infectan más` : null),
    ],
  },
  siembra: {
    nombre: 'Siembra / resiembra',
    reglas: [
      (_d, ctx) => (ctx.lluviaPrevia3d < 10 && ctx.dia.lluvia_mm < 5 ? 'suelo probablemente seco' : null),
      (_d, ctx) => (ctx.lluviaSiguientes5d < 10 ? 'poca lluvia prevista en los 5 días siguientes' : null),
      (d) => (d.lluvia_mm >= 50 ? `aguacero fuerte (${d.lluvia_mm} mm)` : null),
    ],
  },
  vuelo_dron: {
    nombre: 'Vuelo de dron',
    reglas: [
      (d) => (d.lluvia_mm >= 1 ? `lluvia prevista (${d.lluvia_mm} mm)` : null),
      (d) => (d.prob_lluvia != null && d.prob_lluvia >= 50 ? `probabilidad de lluvia ${d.prob_lluvia}%` : null),
      (d) => (d.rafaga_max != null && d.rafaga_max > 10 ? `ráfagas hasta ${d.rafaga_max} m/s` : null),
    ],
  },
  cosecha: {
    nombre: 'Cosecha y secado',
    reglas: [
      (d) => (d.lluvia_mm >= 5 ? `lluvia prevista (${d.lluvia_mm} mm): difícil secado` : null),
    ],
  },
};

// A qué ventana de clima corresponde cada tipo de tarea del plan.
export const TIPO_A_VENTANA = {
  fertilizacion: 'fertilizacion',
  tratamiento_fitosanitario: 'tratamiento_fitosanitario',
  control_arvenses: 'control_arvenses',
  poda: 'poda',
  siembra: 'siembra',
  resiembra: 'siembra',
  vuelo_dron: 'vuelo_dron',
  cosecha: 'cosecha',
};

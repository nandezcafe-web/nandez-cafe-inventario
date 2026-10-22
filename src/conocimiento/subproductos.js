// Base de conocimiento de subproductos del café — VERSIÓN INICIAL.
//
// IMPORTANTE: todos los valores numéricos son RANGOS ORIENTATIVOS para priorizar
// investigación, no datos de diseño. Deben reemplazarse por mediciones propias
// (humedad, composición, rendimientos de prototipo) a medida que existan.
//
// rendimiento: kg de producto por kg de materia prima.
//   base 'seco'   → se multiplica por los kg de materia seca
//   base 'fresco' → se multiplica por los kg frescos
//   null          → no hay cifra confiable sin caracterización/laboratorio
// Si hay humedad_producto_pct, el resultado de base 'seco' se expresa con esa humedad.
//
// confianza: 'media' = balance de masa o práctica bien documentada;
//            'baja'  = depende mucho del proceso y de la materia prima.

export const REFERENCIAS = {
  cenicafe_bioeconomia: 'Rodríguez-Valencia, N. (2023). Bioeconomía circular en el beneficio con cero residuos. Cenicafé. https://publicaciones.cenicafe.org/index.php/col85/article/view/1266',
  cenicafe_pulpa_alimentos: 'Rodríguez-Valencia, N. et al. (2025). Usos de la pulpa de café en la elaboración de alimentos. Cenicafé. https://publicaciones.cenicafe.org/index.php/libros_manuales/article/view/4898',
  cenicafe_microorganismos_pulpa: 'Figueroa Varela, P. A. et al. (2025). Microorganismos nativos de la pulpa para poscosecha y compost. Cenicafé. https://publicaciones.cenicafe.org/index.php/pex/article/view/4305',
  rashwan_2026: 'Rashwan, A. K. et al. (2026). Valorization of coffee processing by-products for circular economy. Bioresource Technology 449. https://pubmed.ncbi.nlm.nih.gov/41819345/',
  polisacaridos_2026: 'Coffee by-products polysaccharides (2026). Food Bioscience 82. https://www.sciencedirect.com/science/article/pii/S2212429226012253',
  borra_2018: 'Valorization of spent coffee grounds: A review (2018). Food and Bioproducts Processing 110. https://www.sciencedirect.com/science/article/pii/S0960308518302797',
  borra_2015: 'Spent coffee grounds: current research and future prospects (2015). Trends in Food Science & Technology 45(1). https://www.sciencedirect.com/science/article/pii/S0924224415001193',
};

export const SUBPRODUCTOS_INFO = {
  pulpa: {
    nombre: 'Pulpa',
    genera: 'Despulpado en beneficio húmedo (lavado/honey).',
    // Proporción muy citada para café arábica en Colombia; verificar con la báscula en la finca.
    kg_por_kg_cereza: 0.436,
    humedad_tipica_pct: [75, 85],
    vida_util_fresco_horas: 48,
    densidad_kg_m3: 550,
    advertencias: [
      'Fermenta rápido: procesar o estabilizar en 1–2 días.',
      'Fresca puede ser fitotóxica; no aplicarla directamente al cultivo sin compostar.',
      'Genera lixiviados: almacenar bajo techo y con manejo de líquidos.',
    ],
    referencias: ['cenicafe_bioeconomia', 'cenicafe_pulpa_alimentos', 'cenicafe_microorganismos_pulpa'],
    usos: [
      {
        id: 'compost_pulpa', nombre: 'Compost', linea: 'bioinsumos',
        proceso: 'Compostaje aeróbico con volteos, mezclada con material seco (podas, cisco).',
        rendimiento: { base: 'fresco', min: 0.15, max: 0.30 }, confianza: 'media',
        complejidad: 1, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 200,
        equipos: ['Techo o cubierta', 'Pala/volteador', 'Termómetro de compost'],
        regulacion: 'Uso propio: bajo. Venta como abono: registro ICA.',
        uso_en_finca: true,
      },
      {
        id: 'lombricompuesto_pulpa', nombre: 'Lombricompuesto', linea: 'bioinsumos',
        proceso: 'Precompostaje corto y lombricultura (lombriz roja californiana).',
        rendimiento: { base: 'fresco', min: 0.15, max: 0.30 }, confianza: 'baja',
        complejidad: 2, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 200,
        equipos: ['Camas o lechos techados', 'Pie de cría de lombriz'],
        regulacion: 'Uso propio: bajo. Venta: registro ICA.',
        uso_en_finca: true,
      },
      {
        id: 'harina_pulpa', nombre: 'Pulpa deshidratada / harina', linea: 'ingredientes',
        proceso: 'Selección, lavado, secado controlado y molienda con prácticas de inocuidad.',
        rendimiento: { base: 'seco', min: 0.80, max: 0.95 }, humedad_producto_pct: 10, confianza: 'media',
        complejidad: 4, inversion: 'media', requiere_laboratorio: true, minimo_kg: 100,
        equipos: ['Secador (solar o de aire caliente)', 'Molino', 'Medidor de humedad'],
        regulacion: 'Alimento humano: INVIMA y BPM. Alimento animal: ICA.',
      },
      {
        id: 'biogas_pulpa', nombre: 'Biogás', linea: 'energia',
        proceso: 'Digestión anaerobia, idealmente junto con aguas mieles.',
        rendimiento: null, confianza: 'baja',
        complejidad: 4, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 1000,
        equipos: ['Biodigestor', 'Sistema de conducción y uso del gas'],
        regulacion: 'Seguridad del gas y manejo de efluentes.',
      },
    ],
  },

  cascara: {
    nombre: 'Cáscara (cereza seca / husk)',
    genera: 'Trilla de café procesado por vía natural o seca.',
    kg_por_kg_cereza: null,
    humedad_tipica_pct: [10, 15],
    vida_util_fresco_horas: null,
    densidad_kg_m3: 200,
    advertencias: ['Estable si se mantiene seca; vigilar hongos y micotoxinas si se humedece.'],
    referencias: ['rashwan_2026', 'polisacaridos_2026'],
    usos: [
      {
        id: 'infusion_cascara', nombre: 'Infusión de cáscara ("cascara")', linea: 'ingredientes',
        proceso: 'Secado cuidadoso de la cereza, selección, limpieza y empaque.',
        rendimiento: { base: 'seco', min: 0.80, max: 0.95 }, humedad_producto_pct: 10, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: true, minimo_kg: 50,
        equipos: ['Secador/marquesina', 'Mesa de selección', 'Empacadora'],
        regulacion: 'Alimento: INVIMA. Verificar análisis microbiológico y de micotoxinas.',
      },
      {
        id: 'pellets_cascara', nombre: 'Pellets / briquetas combustibles', linea: 'energia',
        proceso: 'Molienda, ajuste de humedad y densificación.',
        rendimiento: { base: 'seco', min: 0.85, max: 0.95 }, humedad_producto_pct: 10, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 500,
        equipos: ['Molino de martillos', 'Peletizadora o briquetadora'],
        regulacion: 'Baja.',
      },
      {
        id: 'compost_cascara', nombre: 'Material de soporte para compost', linea: 'bioinsumos',
        proceso: 'Mezclar como fuente de carbono con pulpa u otros materiales húmedos.',
        rendimiento: { base: 'seco', min: 0.40, max: 0.60 }, humedad_producto_pct: 40, confianza: 'baja',
        complejidad: 1, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 50,
        equipos: ['Pala'], regulacion: 'Uso propio: bajo.', uso_en_finca: true,
      },
    ],
  },

  mucilago: {
    nombre: 'Mucílago',
    genera: 'Desmucilaginado/fermentación en beneficio húmedo.',
    kg_por_kg_cereza: 0.149,
    humedad_tipica_pct: [85, 91],
    vida_util_fresco_horas: 12,
    densidad_kg_m3: 1000,
    advertencias: [
      'Muy perecedero y húmedo: poco viable transportarlo lejos.',
      'Procesar en el punto de generación o estabilizar de inmediato.',
      'Vertido sin tratamiento contamina fuentes de agua.',
    ],
    referencias: ['cenicafe_bioeconomia', 'rashwan_2026'],
    usos: [
      {
        id: 'cocompostaje_mucilago', nombre: 'Co-compostaje con pulpa', linea: 'bioinsumos',
        proceso: 'Incorporarlo a pilas de pulpa con material seco para absorber el líquido.',
        rendimiento: null, confianza: 'baja',
        complejidad: 2, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 50,
        equipos: ['Material de soporte seco'], regulacion: 'Uso propio: bajo.', uso_en_finca: true,
      },
      {
        id: 'fermentados_mucilago', nombre: 'Fermentados (vinagre, bebidas, bioetanol)', linea: 'ingredientes',
        proceso: 'Fermentación controlada con cepas definidas.',
        rendimiento: null, confianza: 'baja',
        complejidad: 5, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 100,
        equipos: ['Fermentadores', 'Control de pH y temperatura'],
        regulacion: 'Alimentos: INVIMA. Alcohol: normativa específica.',
      },
      {
        id: 'pectinas_mucilago', nombre: 'Extracción de pectinas', linea: 'ingredientes',
        proceso: 'Extracción y precipitación de polisacáridos.',
        rendimiento: null, confianza: 'baja',
        complejidad: 5, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 100,
        equipos: ['Equipo de extracción', 'Secado de producto'], regulacion: 'Ingrediente alimentario: INVIMA.',
      },
    ],
  },

  pergamino: {
    nombre: 'Pergamino (cisco)',
    genera: 'Trilla del café pergamino seco.',
    // Proporción citada respecto a la cereza fresca; verificar localmente.
    kg_por_kg_cereza: 0.042,
    humedad_tipica_pct: [8, 15],
    vida_util_fresco_horas: null,
    densidad_kg_m3: 130,
    advertencias: ['Estable y seco, pero muy voluminoso: el transporte se limita por volumen, no por peso.'],
    referencias: ['rashwan_2026', 'polisacaridos_2026'],
    usos: [
      {
        id: 'combustible_cisco', nombre: 'Combustible para secado de café', linea: 'energia',
        proceso: 'Uso directo en hornillas o secadores de biomasa.',
        rendimiento: { base: 'seco', min: 0.95, max: 1.0 }, humedad_producto_pct: 12, confianza: 'media',
        complejidad: 1, inversion: 'media', requiere_laboratorio: false, minimo_kg: 100,
        equipos: ['Secador con hornilla de biomasa'], regulacion: 'Baja (emisiones de combustión).',
        uso_en_finca: true,
      },
      {
        id: 'pellets_cisco', nombre: 'Pellets / briquetas', linea: 'energia',
        proceso: 'Molienda y densificación.',
        rendimiento: { base: 'seco', min: 0.85, max: 0.95 }, humedad_producto_pct: 10, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 500,
        equipos: ['Molino', 'Peletizadora o briquetadora'], regulacion: 'Baja.',
      },
      {
        id: 'biochar_cisco', nombre: 'Biochar', linea: 'bioinsumos',
        proceso: 'Pirólisis lenta (horno de retorta o tipo kon-tiki).',
        rendimiento: { base: 'seco', min: 0.25, max: 0.35 }, humedad_producto_pct: 5, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 100,
        equipos: ['Horno de pirólisis'], regulacion: 'Uso propio: bajo. Venta como enmienda: ICA.',
        uso_en_finca: true,
      },
      {
        id: 'biomaterial_cisco', nombre: 'Biomateriales / aglomerados', linea: 'biomateriales',
        proceso: 'Molienda, mezcla con aglutinante y prensado; formulación y ensayos mecánicos.',
        rendimiento: null, confianza: 'baja',
        complejidad: 5, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 50,
        equipos: ['Molino', 'Prensa', 'Moldes', 'Ensayos mecánicos (aliado)'],
        regulacion: 'Según producto final.',
      },
    ],
  },

  cascarilla_silverskin: {
    nombre: 'Cascarilla plateada (silverskin)',
    genera: 'Tostión del café (tostadores).',
    kg_por_kg_cereza: null,
    humedad_tipica_pct: [5, 10],
    vida_util_fresco_horas: null,
    densidad_kg_m3: 100,
    advertencias: ['Se genera en tostadores, no en la finca: requiere red de tostadores.', 'Muy liviana y volátil.'],
    referencias: ['rashwan_2026', 'polisacaridos_2026'],
    usos: [
      {
        id: 'fibra_silverskin', nombre: 'Fibra dietaria / antioxidantes', linea: 'ingredientes',
        proceso: 'Limpieza, molienda fina y/o extracción de compuestos.',
        rendimiento: null, confianza: 'baja',
        complejidad: 5, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 20,
        equipos: ['Molino fino', 'Equipo de extracción'], regulacion: 'Alimentos/cosméticos: INVIMA.',
      },
      {
        id: 'biochar_silverskin', nombre: 'Biochar', linea: 'bioinsumos',
        proceso: 'Pirólisis lenta.',
        rendimiento: { base: 'seco', min: 0.25, max: 0.35 }, humedad_producto_pct: 5, confianza: 'baja',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 50,
        equipos: ['Horno de pirólisis'], regulacion: 'Venta: ICA.',
      },
    ],
  },

  borra: {
    nombre: 'Borra de café',
    genera: 'Preparación de bebida (cafeterías, restaurantes, solubles, hogares).',
    kg_por_kg_cereza: null,
    humedad_tipica_pct: [50, 65],
    vida_util_fresco_horas: 72,
    densidad_kg_m3: 500,
    advertencias: [
      'Se enmohece en pocos días si queda húmeda.',
      'Riesgo de contaminantes (filtros, azúcar, leche, basura): exigir separación en la fuente.',
    ],
    referencias: ['borra_2018', 'borra_2015', 'rashwan_2026'],
    usos: [
      {
        id: 'hongos_borra', nombre: 'Sustrato para hongos comestibles (orellana)', linea: 'ingredientes',
        proceso: 'Pasteurización/mezcla con otro sustrato, inoculación y fructificación.',
        rendimiento: { base: 'seco', min: 0.3, max: 0.8 }, confianza: 'baja',
        complejidad: 3, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 20,
        equipos: ['Cuarto de incubación', 'Bolsas', 'Semilla (micelio)'],
        regulacion: 'Venta de alimentos: INVIMA/BPM.',
        nota: 'Rendimiento expresado en kg de hongo fresco.',
      },
      {
        id: 'compost_borra', nombre: 'Compost / enmienda', linea: 'bioinsumos',
        proceso: 'Compostar mezclada con material rico en carbono; no aplicar en exceso directamente.',
        rendimiento: { base: 'fresco', min: 0.3, max: 0.5 }, confianza: 'baja',
        complejidad: 1, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 50,
        equipos: ['Pala'], regulacion: 'Venta como abono: ICA.', uso_en_finca: true,
      },
      {
        id: 'aceite_borra', nombre: 'Extracción de aceite', linea: 'ingredientes',
        proceso: 'Secado y extracción con solvente o prensado.',
        rendimiento: { base: 'seco', min: 0.10, max: 0.15 }, humedad_producto_pct: 0, confianza: 'baja',
        complejidad: 5, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 200,
        equipos: ['Secador', 'Extractor', 'Recuperación de solvente'],
        regulacion: 'Cosméticos/alimentos: INVIMA. Solventes: seguridad industrial.',
      },
      {
        id: 'briquetas_borra', nombre: 'Briquetas / pellets', linea: 'energia',
        proceso: 'Secado y densificación.',
        rendimiento: { base: 'seco', min: 0.85, max: 0.95 }, humedad_producto_pct: 10, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 300,
        equipos: ['Secador', 'Briquetadora'], regulacion: 'Baja.',
      },
    ],
  },

  podas_madera: {
    nombre: 'Podas y madera',
    genera: 'Zoqueo, podas y renovación de cafetales y sombrío.',
    kg_por_kg_cereza: null,
    humedad_tipica_pct: [30, 50],
    vida_util_fresco_horas: null,
    densidad_kg_m3: 300,
    advertencias: ['Picar para compostar o usar como cobertura.'],
    referencias: ['cenicafe_bioeconomia'],
    usos: [
      {
        id: 'biochar_podas', nombre: 'Biochar', linea: 'bioinsumos',
        proceso: 'Secado al aire y pirólisis lenta.',
        rendimiento: { base: 'seco', min: 0.25, max: 0.35 }, humedad_producto_pct: 5, confianza: 'media',
        complejidad: 3, inversion: 'media', requiere_laboratorio: false, minimo_kg: 100,
        equipos: ['Horno de pirólisis', 'Picadora'], regulacion: 'Venta: ICA.', uso_en_finca: true,
      },
      {
        id: 'mulch_podas', nombre: 'Cobertura (mulch) / soporte de compost', linea: 'bioinsumos',
        proceso: 'Picado y aplicación en calles o pilas de compost.',
        rendimiento: { base: 'fresco', min: 0.9, max: 1.0 }, confianza: 'media',
        complejidad: 1, inversion: 'baja', requiere_laboratorio: false, minimo_kg: 20,
        equipos: ['Picadora o machete'], regulacion: 'Ninguna para uso propio.', uso_en_finca: true,
      },
    ],
  },

  aguas_mieles: {
    nombre: 'Aguas mieles',
    genera: 'Lavado del café en beneficio húmedo.',
    kg_por_kg_cereza: null,
    humedad_tipica_pct: [97, 99.5],
    vida_util_fresco_horas: 12,
    densidad_kg_m3: 1000,
    advertencias: [
      'Alta carga contaminante: su manejo es primero una obligación ambiental.',
      'Reducir su volumen con beneficio ecológico antes de pensar en aprovecharlas.',
    ],
    referencias: ['cenicafe_bioeconomia'],
    usos: [
      {
        id: 'tratamiento_aguas', nombre: 'Tratamiento (SMTA / biodigestión)', linea: 'otra',
        proceso: 'Sistema modular de tratamiento anaerobio o equivalente.',
        rendimiento: null, confianza: 'baja',
        complejidad: 4, inversion: 'alta', requiere_laboratorio: true, minimo_kg: 0,
        equipos: ['Sistema de tratamiento'], regulacion: 'Permiso de vertimientos (CAR/Corponor).',
        uso_en_finca: true,
      },
    ],
  },
};

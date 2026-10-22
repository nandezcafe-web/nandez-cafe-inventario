// Rendimientos y mermas de la cadena de transformación del café — VERSIÓN INICIAL.
//
// IMPORTANTE: los rangos son ORIENTATIVOS, para estimar antes de pesar y para
// avisar cuando un pesaje real se sale de lo esperado. El dato que manda siempre
// es la báscula: cada proceso registrado guarda kg_entrada y kg_salida reales, y
// de ahí salen los costos. Estas cifras solo sirven de referencia y de alerta.
//
// confianza: 'alta'  = balance de masa estable y muy documentado;
//            'media' = depende del equipo y del operario;
//            'baja'  = varía mucho según materia prima y proceso.

export const REFERENCIAS_PROCESO = {
  cenicafe_factor: 'Cenicafé — Factor de rendimiento: kg de café pergamino seco por cada 125 kg de café cereza. https://www.cenicafe.org',
  cenicafe_beneficio: 'Cenicafé — Beneficio del café y manejo de subproductos. https://publicaciones.cenicafe.org',
  sca_roasting: 'Specialty Coffee Association — Roasting best practices: pérdida de peso por tueste (organic loss + humedad).',
  fnc_trilla: 'FNC — Trilla: el pergamino (cisco/cascarilla) representa cerca de la quinta parte del peso del café pergamino seco.',
};

// Estados por los que pasa el café. El orden importa: define la cadena.
export const ESTADOS_CAFE = [
  'cereza',
  'pergamino_humedo',
  'pergamino_seco',
  'verde',
  'tostado_grano',
  'tostado_molido',
];

export const ESTADOS_CAFE_INFO = {
  cereza: { nombre: 'Cereza', unidad: 'kg', vendible: true },
  pergamino_humedo: { nombre: 'Pergamino húmedo (baba lavada)', unidad: 'kg', vendible: false },
  pergamino_seco: { nombre: 'Pergamino seco (cps)', unidad: 'kg', vendible: true },
  verde: { nombre: 'Verde / almendra (trillado)', unidad: 'kg', vendible: true },
  tostado_grano: { nombre: 'Tostado en grano', unidad: 'kg', vendible: true },
  tostado_molido: { nombre: 'Tostado molido', unidad: 'kg', vendible: true },
};

export const TIPOS_PROCESO = [
  'despulpado', 'fermentacion', 'lavado', 'secado', 'trilla', 'seleccion',
  'tueste', 'molienda', 'empaque', 'otro',
];

// Transiciones esperadas: rendimiento = kg_salida / kg_entrada.
export const TRANSICIONES = {
  despulpado: {
    nombre: 'Despulpado', de: 'cereza', a: 'pergamino_humedo',
    rendimiento: { min: 0.52, tipico: 0.56, max: 0.60 },
    subproducto: 'pulpa',
    confianza: 'alta',
    referencias: ['cenicafe_beneficio'],
  },
  secado: {
    nombre: 'Secado', de: 'pergamino_humedo', a: 'pergamino_seco',
    // De ~50-55 % de humedad a 10-12 %: se evapora cerca de la mitad del peso.
    rendimiento: { min: 0.42, tipico: 0.47, max: 0.55 },
    confianza: 'media',
    referencias: ['cenicafe_beneficio'],
    nota: 'Humedad objetivo 10–12 %. Por encima de 12,5 % hay riesgo de hongos; por debajo de 10 % se pierde peso y calidad en taza.',
  },
  trilla: {
    nombre: 'Trilla', de: 'pergamino_seco', a: 'verde',
    // El cisco/cascarilla es cerca del 18-22 % del peso del pergamino seco.
    rendimiento: { min: 0.78, tipico: 0.81, max: 0.83 },
    subproducto: 'cascarilla_silverskin',
    confianza: 'alta',
    referencias: ['fnc_trilla', 'cenicafe_beneficio'],
    nota: 'Incluye la merma por clasificación. Si se saca pasilla y grano defectuoso aparte, el rendimiento de excelso baja a 0,72–0,78.',
  },
  seleccion: {
    nombre: 'Selección / clasificación', de: 'verde', a: 'verde',
    rendimiento: { min: 0.88, tipico: 0.94, max: 0.99 },
    confianza: 'baja',
    nota: 'Lo que se retira es pasilla y defectos: tiene valor propio, no es pérdida total.',
  },
  tueste: {
    nombre: 'Tueste', de: 'verde', a: 'tostado_grano',
    rendimiento: { min: 0.80, tipico: 0.845, max: 0.88 },
    confianza: 'alta',
    referencias: ['sca_roasting'],
    nota: 'La merma es agua más pérdida orgánica. Depende sobre todo del punto de tueste.',
  },
  molienda: {
    nombre: 'Molienda', de: 'tostado_grano', a: 'tostado_molido',
    rendimiento: { min: 0.97, tipico: 0.99, max: 1.0 },
    confianza: 'alta',
    nota: 'La pérdida es lo que queda en el molino. Moler solo lo que se va a vender pronto: molido pierde aroma en días.',
  },
};

// Merma de tueste por punto. Es el dato que más mueve el costo del kg tostado.
export const PERFILES_TUESTE = {
  claro: { nombre: 'Claro (filtro / Agtron alto)', rendimiento: { min: 0.86, tipico: 0.875, max: 0.89 } },
  medio_claro: { nombre: 'Medio-claro', rendimiento: { min: 0.85, tipico: 0.86, max: 0.875 } },
  medio: { nombre: 'Medio', rendimiento: { min: 0.835, tipico: 0.85, max: 0.865 } },
  medio_oscuro: { nombre: 'Medio-oscuro', rendimiento: { min: 0.82, tipico: 0.835, max: 0.85 } },
  oscuro: { nombre: 'Oscuro (espresso tradicional)', rendimiento: { min: 0.79, tipico: 0.815, max: 0.835 } },
};

export const NIVELES_MOLIENDA = ['grueso', 'medio_grueso', 'medio', 'medio_fino', 'fino', 'turco'];

// Canales de venta con márgenes de referencia SOBRE EL PRECIO DE VENTA.
// Son puntos de partida del mercado de café especial; ajustar con los números propios.
export const CANALES_VENTA = {
  directo: { nombre: 'Directo al consumidor', margen_pct: 50, confianza: 'media' },
  feria: { nombre: 'Feria o evento', margen_pct: 45, confianza: 'media', nota: 'Descontar transporte, puesto y horas de la feria.' },
  online: { nombre: 'Tienda online / domicilio', margen_pct: 45, confianza: 'baja', nota: 'El envío se come el margen en pedidos de una bolsa.' },
  tienda: { nombre: 'Tienda o consignación', margen_pct: 35, confianza: 'media', nota: 'En consignación el pago llega después de la venta: afecta el flujo de caja.' },
  cafeteria: { nombre: 'Cafetería (mayoreo)', margen_pct: 30, confianza: 'media', nota: 'Compran por kg y repiten; el volumen compensa el margen.' },
  mayorista: { nombre: 'Mayorista / distribuidor', margen_pct: 22, confianza: 'media' },
  institucional: { nombre: 'Empresa o institución', margen_pct: 28, confianza: 'baja' },
};

// Impuestos: el café tostado en Colombia está gravado a tarifa reducida y el
// pergamino/verde al productor tiene tratamiento distinto. Confirmar con el
// contador antes de facturar: aquí solo se calcula lo que se le indique.
export const IVA_SUGERIDO_PCT = { tostado: 5, verde: 5, pergamino: 0 };

export const AVISO_IVA = 'El IVA del café tostado en Colombia suele ser del 5 %, y la venta de pergamino del productor puede estar excluida o exenta. Confirme el caso con su contador: el sistema solo aplica el porcentaje que usted indique.';

// Rendimiento acumulado esperado entre dos estados (p. ej. pergamino_seco → tostado_grano).
export function rendimientoEsperado(de, a) {
  const orden = ESTADOS_CAFE.indexOf(de);
  const destino = ESTADOS_CAFE.indexOf(a);
  if (orden < 0 || destino < 0 || destino < orden) return null;

  let min = 1;
  let tipico = 1;
  let max = 1;
  const pasos = [];
  for (const [id, t] of Object.entries(TRANSICIONES)) {
    const i = ESTADOS_CAFE.indexOf(t.de);
    const j = ESTADOS_CAFE.indexOf(t.a);
    if (j <= i) continue; // selección no avanza de estado
    if (i < orden || j > destino) continue;
    min *= t.rendimiento.min;
    tipico *= t.rendimiento.tipico;
    max *= t.rendimiento.max;
    pasos.push(id);
  }
  if (!pasos.length) return null;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return { de, a, pasos, min: r3(min), tipico: r3(tipico), max: r3(max) };
}

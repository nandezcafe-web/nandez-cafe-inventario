import { SUBPRODUCTOS_INFO, REFERENCIAS } from '../conocimiento/subproductos.js';
import { invalido } from './errores.js';

const r1 = (n) => Math.round(n * 10) / 10;
const PENALIZACION_INVERSION = { baja: 0, media: 15, alta: 30 };

export const AVISO =
  'Estimación preliminar con rangos de referencia. Validar con análisis de laboratorio, prototipos y cotizaciones antes de invertir.';

function humedadDe(info, humedad_pct) {
  if (humedad_pct !== undefined && humedad_pct !== null && humedad_pct !== '') {
    const h = Number(humedad_pct);
    if (!Number.isFinite(h) || h < 0 || h >= 100) throw invalido({ humedad_pct: 'debe estar entre 0 y 99.9' });
    return { humedad: h, estimada: false };
  }
  const [a, b] = info.humedad_tipica_pct;
  return { humedad: (a + b) / 2, estimada: true };
}

// "Tengo X kg de Y": equivalencias + usos posibles ordenados por viabilidad.
export function evaluarBiomasa({ tipo, kg, humedad_pct, horas_desde_generacion }) {
  const info = SUBPRODUCTOS_INFO[tipo];
  if (!info) throw invalido({ tipo: `use: ${Object.keys(SUBPRODUCTOS_INFO).join(', ')}` });
  const kgFrescos = Number(kg);
  if (!Number.isFinite(kgFrescos) || kgFrescos <= 0) throw invalido({ kg: 'debe ser un número mayor que 0' });

  const { humedad, estimada } = humedadDe(info, humedad_pct);
  const kgSecos = kgFrescos * (1 - humedad / 100);
  const horas = horas_desde_generacion == null || horas_desde_generacion === '' ? null : Number(horas_desde_generacion);
  const vencido = horas != null && info.vida_util_fresco_horas != null && horas > info.vida_util_fresco_horas;

  const advertencias = [...info.advertencias];
  if (estimada) advertencias.unshift(`Humedad no medida: se asumió ${humedad}% (valor típico). Medirla cambia mucho el resultado.`);
  const [hMin, hMax] = info.humedad_tipica_pct;
  if (!estimada && (humedad < hMin || humedad > hMax)) {
    advertencias.push(`La humedad indicada (${humedad}%) está fuera del rango típico ${hMin}–${hMax}%. Verificar la medición.`);
  }
  if (vencido) {
    advertencias.unshift(`Han pasado ${horas} h y la vida útil de referencia en fresco es ~${info.vida_util_fresco_horas} h: probablemente ya fermentó o se deterioró.`);
  }

  const oportunidades = info.usos.map((uso) => {
    let producto = null;
    if (uso.rendimiento) {
      const base = uso.rendimiento.base === 'seco' ? kgSecos : kgFrescos;
      const aHumedad = uso.rendimiento.base === 'seco' && uso.humedad_producto_pct != null
        ? 1 / (1 - uso.humedad_producto_pct / 100)
        : 1;
      producto = {
        kg_min: r1(base * uso.rendimiento.min * aHumedad),
        kg_max: r1(base * uso.rendimiento.max * aHumedad),
        base: uso.rendimiento.base,
        humedad_producto_pct: uso.humedad_producto_pct ?? null,
      };
    }

    const notas = [];
    let puntaje = 100 - (uso.complejidad - 1) * 12 - PENALIZACION_INVERSION[uso.inversion];
    if (uso.requiere_laboratorio) puntaje -= 20;
    if (!uso.rendimiento) {
      puntaje -= 10;
      notas.push('Sin rendimiento de referencia confiable: requiere caracterización.');
    }
    if (kgFrescos < uso.minimo_kg) {
      puntaje -= 25;
      notas.push(`Cantidad por debajo del lote mínimo práctico (~${uso.minimo_kg} kg): acumular o agrupar con otros productores.`);
    }
    if (vencido && uso.linea !== 'energia') {
      puntaje -= 30;
      notas.push('Material posiblemente deteriorado para este uso.');
    }
    if (uso.uso_en_finca) notas.push('Se puede usar en la propia finca: validación rápida.');
    if (uso.nota) notas.push(uso.nota);

    puntaje = Math.max(0, Math.min(100, puntaje));
    const viabilidad = uso.requiere_laboratorio
      ? 'requiere_laboratorio'
      : puntaje >= 70 ? 'alta' : puntaje >= 45 ? 'media' : 'baja';

    return {
      id: uso.id,
      nombre: uso.nombre,
      linea: uso.linea,
      viabilidad,
      puntaje,
      producto_estimado: producto,
      confianza: uso.confianza,
      proceso: uso.proceso,
      complejidad: uso.complejidad,
      inversion: uso.inversion,
      equipos: uso.equipos,
      regulacion: uso.regulacion,
      notas,
    };
  }).sort((a, b) => b.puntaje - a.puntaje);

  return {
    entrada: { tipo, nombre: info.nombre, kg: kgFrescos, humedad_pct: humedad, humedad_estimada: estimada, horas_desde_generacion: horas },
    equivalencias: {
      kg_materia_seca: r1(kgSecos),
      kg_agua: r1(kgFrescos - kgSecos),
      volumen_m3_aprox: Math.round((kgFrescos / info.densidad_kg_m3) * 100) / 100,
      kg_cereza_que_la_generaron: info.kg_por_kg_cereza ? r1(kgFrescos / info.kg_por_kg_cereza) : null,
    },
    genera: info.genera,
    advertencias,
    oportunidades,
    referencias: info.referencias.map((id) => REFERENCIAS[id]),
    aviso: AVISO,
  };
}

// Subproductos esperados a partir de café cereza, según el proceso de beneficio.
export function estimarGeneracion(kgCereza, proceso = 'lavado') {
  const kg = Number(kgCereza);
  if (!Number.isFinite(kg) || kg <= 0) throw invalido({ kg_cereza: 'debe ser un número mayor que 0' });
  const procesos = ['lavado', 'honey', 'natural'];
  if (!procesos.includes(proceso)) throw invalido({ proceso: `use: ${procesos.join(', ')}` });

  const I = SUBPRODUCTOS_INFO;
  const items = [];
  if (proceso === 'lavado' || proceso === 'honey') {
    items.push({ tipo: 'pulpa', kg: r1(kg * I.pulpa.kg_por_kg_cereza) });
    items.push({
      tipo: 'mucilago',
      kg: proceso === 'lavado' ? r1(kg * I.mucilago.kg_por_kg_cereza) : null,
      nota: proceso === 'honey' ? 'En honey buena parte del mucílago queda en el grano; medir.' : undefined,
    });
    items.push({ tipo: 'aguas_mieles', kg: null, nota: 'Depende del volumen de agua usado; medir.' });
  } else {
    items.push({ tipo: 'cascara', kg: null, nota: 'Se obtiene al trillar la cereza seca; pesar en la trilla.' });
  }
  items.push({ tipo: 'pergamino', kg: r1(kg * I.pergamino.kg_por_kg_cereza), nota: 'Al trillar el pergamino seco.' });

  return { kg_cereza: kg, proceso, subproductos: items, aviso: AVISO };
}

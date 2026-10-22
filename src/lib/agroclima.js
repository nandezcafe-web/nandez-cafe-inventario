import { UMBRALES as U, RECOMENDACIONES as R, VENTANAS_LABORES } from '../conocimiento/agroclima.js';
import { sumarDias } from './derivados.js';

const r1 = (n) => Math.round(n * 10) / 10;
const suma = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);
const fechaCorta = (f) => {
  const [, m, d] = f.split('-');
  return `${Number(d)}/${Number(m)}`;
};
const ORDEN_NIVEL = { alto: 0, medio: 1, info: 2 };

export function separarDias(dias, hoy) {
  return {
    historial: dias.filter((d) => d.fecha < hoy),
    pronostico: dias.filter((d) => d.fecha >= hoy),
  };
}

// Racha más larga de días secos que termina o continúa a partir de "hoy".
function rachaSecaVigente(historial, pronostico) {
  const seco = (d) => (d.lluvia_mm ?? 0) < U.dia_seco_mm;
  let previa = 0;
  for (let i = historial.length - 1; i >= 0 && seco(historial[i]); i--) previa++;

  let mejor = { dias: previa, desde: previa ? historial[historial.length - previa].fecha : null, hasta: previa ? historial.at(-1).fecha : null };
  let actual = previa;
  let desde = mejor.desde;
  for (const d of pronostico) {
    if (seco(d)) {
      if (!actual) desde = d.fecha;
      actual++;
      if (actual > mejor.dias) mejor = { dias: actual, desde, hasta: d.fecha };
    } else {
      actual = 0;
    }
  }
  return mejor;
}

function lotesJovenes(lotes, hoy) {
  return lotes.filter((l) => l.estado === 'vivero' || l.estado === 'levante'
    || (l.fecha_siembra && sumarDias(l.fecha_siembra, 540) > hoy));
}

// Lotes con frutos en desarrollo: en producción o con floración hace 60–260 días.
function lotesConFrutos(lotes, floraciones, hoy) {
  const conFlor = new Set(floraciones
    .filter((f) => f.fecha <= sumarDias(hoy, -60) && f.fecha >= sumarDias(hoy, -260))
    .map((f) => f.lote_id));
  return lotes.filter((l) => l.estado === 'produccion' || conFlor.has(l.id));
}

export function evaluarRiesgos({ historial, pronostico, lotes = [], floraciones = [], enso = null, hoy }) {
  const riesgos = [];
  const agregar = (r) => riesgos.push({ confianza: 'media', ...r });
  const nombres = (ls) => ls.map((l) => l.nombre).join(', ');

  // 1. Lluvias intensas
  const fuertes = pronostico.filter((d) => d.lluvia_mm >= U.lluvia_intensa_mm.medio);
  let max3d = { mm: 0, desde: null };
  for (let i = 0; i + 2 < pronostico.length; i++) {
    const mm = suma(pronostico.slice(i, i + 3), (d) => d.lluvia_mm);
    if (mm > max3d.mm) max3d = { mm: r1(mm), desde: pronostico[i].fecha };
  }
  if (fuertes.length || max3d.mm >= U.lluvia_acumulada_3d_mm.alto) {
    const alto = fuertes.some((d) => d.lluvia_mm >= U.lluvia_intensa_mm.alto) || max3d.mm >= U.lluvia_acumulada_3d_mm.alto;
    const evidencia = fuertes.map((d) => `${fechaCorta(d.fecha)}: ${d.lluvia_mm} mm`);
    if (max3d.mm >= U.lluvia_acumulada_3d_mm.alto) evidencia.push(`${max3d.mm} mm acumulados en 3 días desde el ${fechaCorta(max3d.desde)}`);
    agregar({
      id: 'lluvia_intensa', nombre: 'Lluvias intensas', nivel: alto ? 'alto' : 'medio',
      periodo: { desde: (fuertes[0] ?? { fecha: max3d.desde }).fecha, hasta: (fuertes.at(-1) ?? { fecha: sumarDias(max3d.desde, 2) }).fecha },
      evidencia, recomendaciones: R.lluvia_intensa,
    });
  }

  // 2. Sequía / déficit hídrico
  const racha = rachaSecaVigente(historial, pronostico);
  const ult15 = historial.slice(-15);
  const prox15 = pronostico.slice(0, 15);
  const balancePasado = ult15.length ? r1(suma(ult15, (d) => d.lluvia_mm) - suma(ult15, (d) => d.et0_mm)) : null;
  const balanceFuturo = prox15.length ? r1(suma(prox15, (d) => d.lluvia_mm) - suma(prox15, (d) => d.et0_mm)) : null;
  const peorBalance = Math.min(balancePasado ?? 0, balanceFuturo ?? 0);
  const nivelSequia = racha.dias >= U.racha_seca_dias.alto || peorBalance <= U.deficit_hidrico_15d_mm.alto ? 'alto'
    : racha.dias >= U.racha_seca_dias.medio || peorBalance <= U.deficit_hidrico_15d_mm.medio ? 'medio' : null;
  if (nivelSequia) {
    const jovenes = lotesJovenes(lotes, hoy);
    const evidencia = [];
    if (racha.dias >= U.racha_seca_dias.medio) evidencia.push(`${racha.dias} días seguidos sin lluvia útil (${fechaCorta(racha.desde)} a ${fechaCorta(racha.hasta)})`);
    if (balancePasado != null) evidencia.push(`Balance lluvia − evapotranspiración, últimos 15 días: ${balancePasado} mm`);
    if (balanceFuturo != null) evidencia.push(`Balance pronosticado, próximos 15 días: ${balanceFuturo} mm`);
    if (jovenes.length) evidencia.push(`Lotes más sensibles (jóvenes): ${nombres(jovenes)}`);
    agregar({
      id: 'sequia', nombre: 'Déficit hídrico / sequía', nivel: nivelSequia,
      periodo: { desde: racha.desde ?? hoy, hasta: racha.hasta ?? sumarDias(hoy, 14) },
      evidencia, recomendaciones: R.sequia,
    });
  }

  // 3. Condiciones favorables para roya (7 días pasados + 7 pronosticados)
  const ventanaRoya = [...historial.slice(-7), ...pronostico.slice(0, 7)];
  const favorables = ventanaRoya.filter((d) => d.tmedia != null
    && d.tmedia >= U.roya_tmedia_c[0] && d.tmedia <= U.roya_tmedia_c[1]
    && (d.lluvia_mm >= 1 || (d.hr_media ?? 0) >= U.roya_hr_media_pct));
  const nivelRoya = favorables.length >= U.roya_dias_favorables_de_14.alto ? 'alto'
    : favorables.length >= U.roya_dias_favorables_de_14.medio ? 'medio' : null;
  if (nivelRoya && ventanaRoya.length) {
    agregar({
      id: 'roya', nombre: 'Condiciones favorables para roya', nivel: nivelRoya,
      periodo: { desde: ventanaRoya[0].fecha, hasta: ventanaRoya.at(-1).fecha },
      evidencia: [
        `${favorables.length} de ${ventanaRoya.length} días con hoja mojada probable (lluvia o humedad ≥ ${U.roya_hr_media_pct}%) y temperatura media entre ${U.roya_tmedia_c[0]} y ${U.roya_tmedia_c[1]} °C`,
        ...(enso?.fase === 'la_nina' ? ['Fase La Niña activa: tiende a más lluvia'] : []),
      ],
      recomendaciones: R.roya,
      confianza: 'media (indica condiciones, no presencia de la enfermedad)',
    });
  }

  // 4. Condiciones favorables para broca (solo si hay frutos)
  const conFrutos = lotesConFrutos(lotes, floraciones, hoy);
  if (conFrutos.length) {
    const ventana = [...historial.slice(-10), ...pronostico.slice(0, 10)];
    const secos = rachaSecaVigente(historial.slice(-10), pronostico.slice(0, 10));
    const tProm = ventana.length ? suma(ventana, (d) => d.tmedia) / ventana.length : 0;
    if (secos.dias >= U.broca_racha_seca_dias && tProm >= U.broca_tmedia_c) {
      agregar({
        id: 'broca', nombre: 'Condiciones favorables para broca',
        nivel: enso?.fase === 'el_nino' ? 'alto' : 'medio',
        periodo: { desde: secos.desde, hasta: secos.hasta },
        evidencia: [`${secos.dias} días secos con temperatura media de ${r1(tProm)} °C`, `Lotes con frutos: ${nombres(conFrutos)}`],
        recomendaciones: R.broca,
      });
    }
  }

  // 5–7. Calor, frío, viento
  const calor = pronostico.filter((d) => d.tmax != null && d.tmax >= U.calor_tmax_c.medio);
  if (calor.length) {
    const florReciente = floraciones.filter((f) => f.fecha >= sumarDias(hoy, -20));
    agregar({
      id: 'calor', nombre: 'Temperaturas altas', nivel: calor.some((d) => d.tmax >= U.calor_tmax_c.alto) ? 'alto' : 'medio',
      periodo: { desde: calor[0].fecha, hasta: calor.at(-1).fecha },
      evidencia: [...calor.map((d) => `${fechaCorta(d.fecha)}: máxima ${d.tmax} °C`), ...(florReciente.length ? ['Hay floración reciente registrada'] : [])],
      recomendaciones: R.calor,
    });
  }
  const frio = pronostico.filter((d) => d.tmin != null && d.tmin <= U.frio_tmin_c.medio);
  if (frio.length) {
    agregar({
      id: 'frio', nombre: 'Temperaturas bajas', nivel: frio.some((d) => d.tmin <= U.frio_tmin_c.alto) ? 'alto' : 'medio',
      periodo: { desde: frio[0].fecha, hasta: frio.at(-1).fecha },
      evidencia: frio.map((d) => `${fechaCorta(d.fecha)}: mínima ${d.tmin} °C`), recomendaciones: R.frio,
    });
  }
  const viento = pronostico.filter((d) => d.rafaga_max != null && d.rafaga_max >= U.rafaga_ms.medio);
  if (viento.length) {
    agregar({
      id: 'viento', nombre: 'Vientos fuertes', nivel: viento.some((d) => d.rafaga_max >= U.rafaga_ms.alto) ? 'alto' : 'medio',
      periodo: { desde: viento[0].fecha, hasta: viento.at(-1).fecha },
      evidencia: viento.map((d) => `${fechaCorta(d.fecha)}: ráfagas de ${d.rafaga_max} m/s`), recomendaciones: R.viento,
    });
  }

  // 8. Floración probable: lluvia que rompe un periodo seco
  const todos = [...historial, ...pronostico];
  for (let i = U.floracion_racha_seca_previa_dias; i < todos.length; i++) {
    const lluvia = todos[i].lluvia_mm + (todos[i + 1]?.lluvia_mm ?? 0);
    const previosSecos = todos.slice(i - U.floracion_racha_seca_previa_dias, i).every((d) => d.lluvia_mm < U.dia_seco_mm);
    if (todos[i].lluvia_mm >= 1 && lluvia >= U.floracion_lluvia_disparo_mm && previosSecos) {
      const desde = sumarDias(todos[i].fecha, U.floracion_dias_despues[0]);
      const hasta = sumarDias(todos[i].fecha, U.floracion_dias_despues[1]);
      if (hasta >= sumarDias(hoy, -3)) {
        agregar({
          id: `floracion_${todos[i].fecha}`, nombre: 'Floración probable', nivel: 'info',
          periodo: { desde, hasta },
          evidencia: [`Lluvia de ${r1(lluvia)} mm el ${fechaCorta(todos[i].fecha)} después de ${U.floracion_racha_seca_previa_dias}+ días secos${todos[i].fecha >= hoy ? ' (pronosticada)' : ''}`],
          recomendaciones: R.floracion,
          confianza: 'baja-media (patrón general del cafeto; confirmar en campo)',
        });
      }
    }
  }

  // 9. El Niño / La Niña
  if (enso && enso.fase !== 'neutral') {
    const fuerte = Math.abs(enso.anomalia) >= U.enso_oni.fuerte;
    agregar({
      id: 'enso', nombre: enso.fase === 'el_nino' ? 'Fenómeno El Niño activo' : 'Fenómeno La Niña activo',
      nivel: fuerte ? 'alto' : 'medio',
      periodo: { desde: hoy, hasta: sumarDias(hoy, 90) },
      evidencia: [`Índice ONI ${enso.anomalia > 0 ? '+' : ''}${enso.anomalia} °C (trimestre ${enso.trimestre} ${enso.anio})`],
      recomendaciones: enso.fase === 'el_nino' ? R.el_nino : R.la_nina,
      confianza: 'tendencia estacional regional, no pronóstico local',
    });
  }

  return riesgos.sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
}

// Aptitud de cada día pronosticado para cada labor.
export function ventanasLabores(historial, pronostico) {
  const todos = [...historial, ...pronostico];
  const offset = historial.length;
  const salida = {};
  for (const [id, def] of Object.entries(VENTANAS_LABORES)) {
    salida[id] = {
      nombre: def.nombre,
      dias: pronostico.map((dia, i) => {
        const idx = offset + i;
        const ctx = {
          dia,
          siguiente: todos[idx + 1] ?? null,
          lluviaPrevia3d: suma(todos.slice(Math.max(0, idx - 3), idx), (d) => d.lluvia_mm),
          lluviaSiguientes5d: suma(todos.slice(idx + 1, idx + 6), (d) => d.lluvia_mm),
        };
        const motivos = def.reglas.map((regla) => regla(dia, ctx)).filter(Boolean);
        return { fecha: dia.fecha, apto: motivos.length === 0, motivos };
      }),
    };
  }
  return salida;
}

// Mejor día apto dentro de la ventana de una tarea programada.
export function mejorDia(diasLabor, fechaProgramada, ventanaDias, hoy) {
  const desde = [sumarDias(fechaProgramada, -ventanaDias), hoy].sort().at(-1);
  const hasta = sumarDias(fechaProgramada, ventanaDias);
  const ultimaFecha = diasLabor.at(-1)?.fecha;
  if (!ultimaFecha || desde > ultimaFecha) return { estado: 'sin_pronostico' };

  const candidatos = diasLabor.filter((d) => d.fecha >= desde && d.fecha <= hasta);
  const distancia = (f) => Math.abs(Date.parse(f) - Date.parse(fechaProgramada));
  const aptos = candidatos.filter((d) => d.apto).sort((a, b) => distancia(a.fecha) - distancia(b.fecha));
  if (aptos.length) {
    return { estado: aptos[0].fecha === fechaProgramada ? 'apto' : 'mover', fecha_sugerida: aptos[0].fecha, desde, hasta };
  }
  const referencia = candidatos.find((d) => d.fecha === fechaProgramada) ?? candidatos[0];
  return { estado: 'sin_dia_apto', desde, hasta, motivos: referencia?.motivos ?? [] };
}

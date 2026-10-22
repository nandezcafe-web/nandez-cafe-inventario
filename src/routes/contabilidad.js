import { Router } from 'express';
import {
  cadenaCostoLote, inventarioCafe, estadoResultados, gastoGeneralPorKg, simularCadena,
} from '../lib/costos.js';
import { sugerirPrecio, preciosDeLote } from '../lib/precios.js';
import { noEncontrado } from '../lib/errores.js';
import {
  ESTADOS_CAFE, ESTADOS_CAFE_INFO, TRANSICIONES, PERFILES_TUESTE,
  CANALES_VENTA, REFERENCIAS_PROCESO, AVISO_IVA, IVA_SUGERIDO_PCT, rendimientoEsperado,
} from '../conocimiento/procesos_cafe.js';

export function routerContabilidad(db) {
  const r = Router();

  // Rendimientos, perfiles de tueste y márgenes de referencia.
  r.get('/costos/conocimiento', (_req, res) => {
    res.json({
      estados: ESTADOS_CAFE.map((e) => ({ id: e, ...ESTADOS_CAFE_INFO[e] })),
      transiciones: TRANSICIONES,
      perfiles_tueste: PERFILES_TUESTE,
      canales_venta: CANALES_VENTA,
      iva_sugerido_pct: IVA_SUGERIDO_PCT,
      aviso_iva: AVISO_IVA,
      referencias: REFERENCIAS_PROCESO,
      cadena_pergamino_a_tostado: rendimientoEsperado('pergamino_seco', 'tostado_grano'),
    });
  });

  // Costo completo de un lote: cada proceso, costo por kg en cada estado,
  // inventario y avisos de pesos raros.
  r.get('/costos/lote/:id', async (req, res) => {
    const c = await cadenaCostoLote(db, Number(req.params.id));
    if (!c) throw noEncontrado('Lote de café');
    res.json(c);
  });

  // Resumen de todos los lotes para la lista del panel.
  r.get('/costos/lotes', async (_req, res) => {
    const ids = await db.todos('SELECT id FROM lotes_cafe ORDER BY fecha DESC, id DESC');
    const cadenas = await Promise.all(ids.map(({ id }) => cadenaCostoLote(db, id)));
    const lotes = cadenas.map((c) => {
      return {
        ...c.lote,
        costo_entrada_cop: c.entrada.total_cop,
        cop_por_kg_entrada: c.entrada.cop_por_kg,
        costo_total_cop: c.totales.costo_total_cop,
        procesos: c.pasos.length,
        estado_final: c.totales.estado_final,
        cop_por_kg_final: c.totales.cop_por_kg_final,
        rendimiento_global: c.totales.rendimiento_global,
        kg_disponible: c.etapas.reduce((s, e) => s + e.kg_disponible, 0),
        valor_inventario_cop: c.totales.valor_inventario_cop,
        ingresos_cop: c.totales.ingresos_cop,
        avisos: c.avisos.length,
      };
    });
    res.json({ datos: lotes, total: lotes.length });
  });

  // Inventario de café por estado y por lote, valorizado al costo.
  r.get('/inventario', async (req, res) => {
    res.json(await inventarioCafe(db, { incluirAgotados: req.query.agotados === 'si' }));
  });

  // Estado de resultados del periodo.
  r.get('/contabilidad/resultados', async (req, res) => {
    res.json(await estadoResultados(db, { desde: req.query.desde, hasta: req.query.hasta }));
  });

  // Gastos generales por kg producido: para repartirlos al fijar precios.
  r.get('/costos/gastos-por-kg', async (req, res) => {
    res.json(await gastoGeneralPorKg(db, {
      desde: req.query.desde,
      hasta: req.query.hasta,
      estado: req.query.estado ?? 'tostado_grano',
    }));
  });

  // Proyección antes de comprar.
  r.post('/costos/simular', (req, res) => res.json(simularCadena(req.body ?? {})));

  // Precio recomendado a partir de un costo por kg.
  r.post('/precios/sugerir', (req, res) => res.json(sugerirPrecio(req.body ?? {})));

  // Precio recomendado de cada presentación con el costo real de un lote.
  r.get('/precios/lote/:id', async (req, res) => {
    const cadena = await cadenaCostoLote(db, Number(req.params.id));
    if (!cadena) throw noEncontrado('Lote de café');
    const generalesCalc = await gastoGeneralPorKg(db, {});
    const generales = req.query.gastos_generales_cop_kg !== undefined
      ? Number(req.query.gastos_generales_cop_kg)
      : (generalesCalc.cop_por_kg ?? 0);
    const precios = await preciosDeLote(db, {
      cadena,
      gastos_generales_cop_kg: Number.isFinite(generales) ? generales : 0,
      iva_pct: Number(req.query.iva_pct ?? 0) || 0,
      redondeo_cop: Number(req.query.redondeo_cop ?? 500) || 500,
    });
    res.json({
      lote: cadena.lote,
      etapas: cadena.etapas,
      gastos_generales_cop_kg: Number.isFinite(generales) ? generales : 0,
      gastos_generales: generalesCalc,
      presentaciones: precios,
      aviso: 'Los gastos generales por kg salen de los gastos sin lote dividido entre los kg tostados registrados. Con pocos registros el número es inestable.',
    });
  });

  return r;
}

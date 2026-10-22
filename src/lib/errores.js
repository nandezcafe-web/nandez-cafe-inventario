export class ErrorHttp extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export const noEncontrado = (que = 'Registro') => new ErrorHttp(404, `${que} no encontrado`);
export const invalido = (detalles) => new ErrorHttp(400, 'Datos inválidos', detalles);

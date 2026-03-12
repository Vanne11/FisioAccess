/**
 * Sistema de escala ECG — zoom solo horizontal.
 *
 * Eje Y: auto-escala (calculada en el canvas según min/max visibles).
 * Eje X: sweep speed * zoom.
 */

/** Pixeles CSS por milimetro logico (base, sin DPR) */
export const PX_PER_MM = 4;

export interface ECGScaleConfig {
  sweepSpeed: number;   // mm/s  (12.5 | 25 | 50)
  zoom: number;         // multiplicador horizontal
  canvasWidth: number;  // px CSS
  canvasHeight: number; // px CSS (zona de chart, sin scrollbar)
  marginLeft: number;   // px CSS
}

export interface ECGScale {
  config: ECGScaleConfig;

  // Derivados
  pxPerMm: number;
  pxPerMs: number;
  visibleDurationMs: number;

  // Cuadricula (tamaño fijo en px, sin zoom)
  gridSmallPx: number;
  gridLargePx: number;

  // Conversion temporal
  timeToX(timeMs: number, viewStartMs: number): number;
  xToTime(x: number, viewStartMs: number): number;

  // Intervalos de cuadricula temporal (se adaptan al zoom)
  getGridTimeInterval(): { smallMs: number; largeMs: number };
}

export function createECGScale(config: ECGScaleConfig): ECGScale {
  const pxPerMm = PX_PER_MM;
  const chartW = config.canvasWidth - config.marginLeft;

  const pxPerMs = (pxPerMm * config.sweepSpeed * config.zoom) / 1000;
  const visibleDurationMs = chartW / pxPerMs;

  // Grid fijo en pixeles (no crece con zoom)
  const gridSmallPx = pxPerMm;
  const gridLargePx = pxPerMm * 5;

  // Intervalo temporal por cuadro se adapta al zoom
  // smallMs * pxPerMs = pxPerMm (constante)
  const smallMs = 1000 / (config.sweepSpeed * config.zoom);
  const largeMs = smallMs * 5;

  return {
    config,
    pxPerMm,
    pxPerMs,
    visibleDurationMs,
    gridSmallPx,
    gridLargePx,

    timeToX(timeMs: number, viewStartMs: number): number {
      return config.marginLeft + (timeMs - viewStartMs) * pxPerMs;
    },

    xToTime(x: number, viewStartMs: number): number {
      return viewStartMs + (x - config.marginLeft) / pxPerMs;
    },

    getGridTimeInterval() {
      return { smallMs, largeMs };
    },
  };
}

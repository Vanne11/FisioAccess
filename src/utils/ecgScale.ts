/**
 * Sistema de escala ECG basado en milimetros logicos.
 *
 * Concepto central: 1 mm logico = PX_PER_MM pixeles CSS.
 * Todo se deriva de ahi:
 *   - pxPerSecond = pxPerMm * sweepSpeed
 *   - pxPerMv     = pxPerMm * gain
 *   - cuadricula  = pxPerMm (1mm) y pxPerMm*5 (5mm)
 */

/** Pixeles CSS por milimetro logico (base, sin DPR) */
export const PX_PER_MM = 4;

export interface ECGScaleConfig {
  sweepSpeed: number;   // mm/s  (12.5 | 25 | 50)
  gain: number;         // mm/mV (5 | 10 | 20 | 40)
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
  pxPerMv: number;
  visibleDurationMs: number;
  visibleAmplitudeMv: number;
  baselineY: number;

  // Cuadricula
  gridSmallPx: number;
  gridLargePx: number;

  // Conversion
  timeToX(timeMs: number, viewStartMs: number): number;
  mvToY(millivolts: number): number;
  xToTime(x: number, viewStartMs: number): number;
  yToMv(y: number): number;

  // Informacion de cuadricula
  getGridTimeInterval(): { smallMs: number; largeMs: number };
  getGridMvInterval(): { smallMv: number; largeMv: number };
}

export function createECGScale(config: ECGScaleConfig): ECGScale {
  const pxPerMm = PX_PER_MM;
  const chartW = config.canvasWidth - config.marginLeft;
  const chartH = config.canvasHeight;
  const baselineY = chartH / 2;

  const pxPerSecond = pxPerMm * config.sweepSpeed * config.zoom;
  const pxPerMs = pxPerSecond / 1000;
  const pxPerMv = pxPerMm * config.gain;

  const visibleDurationMs = chartW / pxPerMs;
  const visibleAmplitudeMv = chartH / pxPerMv;

  const gridSmallPx = pxPerMm;
  const gridLargePx = pxPerMm * 5;

  // Intervalo temporal por cuadro (derivado de sweepSpeed y zoom)
  // 1mm = 1/sweepSpeed segundos → smallMs = 1000/(sweepSpeed*zoom)
  const smallMs = 1000 / (config.sweepSpeed * config.zoom);
  const largeMs = smallMs * 5;

  // Intervalo de mV por cuadro (derivado de gain)
  // 1mm = 1/gain mV
  const smallMv = 1 / config.gain;
  const largeMv = smallMv * 5;

  return {
    config,
    pxPerMm,
    pxPerMs,
    pxPerMv,
    visibleDurationMs,
    visibleAmplitudeMv,
    baselineY,
    gridSmallPx,
    gridLargePx,

    timeToX(timeMs: number, viewStartMs: number): number {
      return config.marginLeft + (timeMs - viewStartMs) * pxPerMs;
    },

    mvToY(millivolts: number): number {
      // Positivo hacia arriba → Y decrece
      return baselineY - millivolts * pxPerMv;
    },

    xToTime(x: number, viewStartMs: number): number {
      return viewStartMs + (x - config.marginLeft) / pxPerMs;
    },

    yToMv(y: number): number {
      return (baselineY - y) / pxPerMv;
    },

    getGridTimeInterval() {
      return { smallMs, largeMs };
    },

    getGridMvInterval() {
      return { smallMv, largeMv };
    },
  };
}

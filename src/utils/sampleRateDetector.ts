/**
 * Autodeteccion de frecuencia de muestreo.
 *
 * Durante los primeros segundos de conexion cuenta muestras/segundo,
 * redondea al estandar mas cercano y expone confianza.
 */

const STANDARD_RATES = [125, 250, 360, 500, 1000] as const;

export interface SampleRateInfo {
  /** Frecuencia medida (Hz) */
  rate: number;
  /** Estandar mas cercano */
  standardRate: number;
  /** 0-1 basado en varianza de intervalos */
  confidence: number;
  /** true tras >=3 s con confianza >0.5 */
  calibrated: boolean;
  sampleCount: number;
}

const EMPTY_INFO: SampleRateInfo = {
  rate: 0,
  standardRate: 0,
  confidence: 0,
  calibrated: false,
  sampleCount: 0,
};

export class SampleRateDetector {
  private timestamps: number[] = [];
  private readonly windowMs: number;
  private _info: SampleRateInfo = { ...EMPTY_INFO };

  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  get info(): SampleRateInfo {
    return this._info;
  }

  addSample(timestampMs: number): void {
    this.timestamps.push(timestampMs);

    // Mantener ventana deslizante
    const cutoff = timestampMs - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }

    this.recalculate();
  }

  reset(): void {
    this.timestamps = [];
    this._info = { ...EMPTY_INFO };
  }

  private recalculate(): void {
    const n = this.timestamps.length;
    if (n < 10) {
      this._info = { ...EMPTY_INFO, sampleCount: n };
      return;
    }

    // Intervalos entre muestras
    const intervals: number[] = [];
    for (let i = 1; i < n; i++) {
      intervals.push(this.timestamps[i] - this.timestamps[i - 1]);
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean <= 0) return;

    const rate = 1000 / mean;

    // Coeficiente de variacion para confianza
    const variance =
      intervals.reduce((acc, dt) => acc + (dt - mean) ** 2, 0) /
      intervals.length;
    const cv = Math.sqrt(variance) / mean;
    const confidence = Math.max(0, Math.min(1, 1 - cv * 2));

    // Estandar mas cercano
    let nearest: number = STANDARD_RATES[0];
    let minDist = Math.abs(rate - nearest);
    for (const sr of STANDARD_RATES) {
      const d = Math.abs(rate - sr);
      if (d < minDist) {
        minDist = d;
        nearest = sr;
      }
    }

    const elapsed = this.timestamps[n - 1] - this.timestamps[0];

    this._info = {
      rate: Math.round(rate * 10) / 10,
      standardRate: nearest,
      confidence,
      calibrated: elapsed >= 3000 && confidence > 0.5,
      sampleCount: n,
    };
  }
}

/** Funcion de conveniencia: analiza un array de timestamps de golpe */
export function detectSampleRate(timestamps: number[]): SampleRateInfo {
  if (timestamps.length < 10) return { ...EMPTY_INFO, sampleCount: timestamps.length };
  const det = new SampleRateDetector();
  for (const ts of timestamps) det.addSample(ts);
  return det.info;
}

/**
 * DSP - Filtros IIR Butterworth de segundo orden (biquad)
 *
 * Transferencia: H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)
 */

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Butterworth pasa-bajos 2do orden */
export function lowpass(fc: number, fs: number): BiquadCoeffs {
  const omega = (2 * Math.PI * fc) / fs;
  const s = Math.sin(omega);
  const c = Math.cos(omega);
  const alpha = s / Math.SQRT2; // Q = 1/√2 para Butterworth
  const a0 = 1 + alpha;
  return {
    b0: (1 - c) / 2 / a0,
    b1: (1 - c) / a0,
    b2: (1 - c) / 2 / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Butterworth pasa-altos 2do orden */
export function highpass(fc: number, fs: number): BiquadCoeffs {
  const omega = (2 * Math.PI * fc) / fs;
  const s = Math.sin(omega);
  const c = Math.cos(omega);
  const alpha = s / Math.SQRT2;
  const a0 = 1 + alpha;
  return {
    b0: (1 + c) / 2 / a0,
    b1: -(1 + c) / a0,
    b2: (1 + c) / 2 / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Filtro notch (rechaza-banda) 2do orden */
export function notch(fc: number, fs: number, Q = 30): BiquadCoeffs {
  const omega = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(omega) / (2 * Q);
  const c = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: 1 / a0,
    b1: (-2 * c) / a0,
    b2: 1 / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Aplica un filtro biquad a un array de valores */
export function applyBiquad(values: number[], coeffs: BiquadCoeffs): number[] {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const n = values.length;
  const out = new Float64Array(n);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;

  for (let i = 0; i < n; i++) {
    const x = values[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }

  return Array.from(out);
}

export interface FilterConfig {
  notchEnabled: boolean;
  notchFreq: 50 | 60;
  highpassEnabled: boolean;
  highpassFreq: 0.05 | 0.5;
  lowpassEnabled: boolean;
  lowpassFreq: 40 | 150;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  notchEnabled: true,
  notchFreq: 50,
  highpassEnabled: true,
  highpassFreq: 0.5,
  lowpassEnabled: true,
  lowpassFreq: 40,
};

/** Estima la frecuencia de muestreo a partir de los timestamps */
export function estimateSampleRate(
  timestamps: number[],
  fallback = 80,
): number {
  if (timestamps.length < 10) return fallback;
  const dt =
    (timestamps[timestamps.length - 1] - timestamps[0]) /
    (timestamps.length - 1);
  return dt > 0 ? 1000 / dt : fallback;
}

/**
 * Aplica la cadena de filtros configurada a los valores crudos.
 * El orden es: HP → Notch → LP (clinicamente estandar).
 */
export function applyFilterChain(
  values: number[],
  fs: number,
  config: FilterConfig,
): number[] {
  let out = values;

  if (config.highpassEnabled) {
    out = applyBiquad(out, highpass(config.highpassFreq, fs));
  }

  if (config.notchEnabled) {
    out = applyBiquad(out, notch(config.notchFreq, fs));
  }

  if (config.lowpassEnabled) {
    out = applyBiquad(out, lowpass(config.lowpassFreq, fs));
  }

  return out;
}

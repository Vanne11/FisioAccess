/**
 * Deteccion de tipo de ADC y conversion a milivoltios.
 *
 * Analiza el rango de valores para determinar si son:
 *   - ADC 10 bits (0-1023)
 *   - ADC 12 bits (0-4095)
 *   - ADC 14 bits (0-16383)
 *   - ADC 16 bits (0-65535)
 *   - Ya en mV (valores pequenos con decimales)
 *
 * Permite override manual de los parametros del hardware.
 */

export type ADCResolution = 0 | 10 | 12 | 14 | 16;

export interface CalibrationConfig {
  /** 0 = los datos ya vienen en mV */
  adcBits: ADCResolution;
  /** Voltaje de referencia del ADC (V) */
  vRef: number;
  /** Ganancia del amplificador de instrumentacion */
  hwGain: number;
  /** Factor multiplicador final (ajustado por calibracion) */
  calibrationFactor: number;
}

/**
 * Valores por defecto para AD8232 + ESP32-C3 Super Mini:
 *   - ADC 12 bits (0-4095)
 *   - Vref 3.3V
 *   - AD8232 ganancia ~100x
 */
export const DEFAULT_CALIBRATION: CalibrationConfig = {
  adcBits: 12,
  vRef: 3.3,
  hwGain: 100,
  calibrationFactor: 1.0,
};

export interface ADCDetectionResult {
  detectedBits: ADCResolution;
  confidence: number;
  minValue: number;
  maxValue: number;
  hasDecimals: boolean;
}

/** Analiza valores crudos para detectar tipo de ADC */
export function detectADCType(values: number[]): ADCDetectionResult {
  if (values.length < 10) {
    return {
      detectedBits: 0,
      confidence: 0,
      minValue: 0,
      maxValue: 0,
      hasDecimals: false,
    };
  }

  let min = Infinity;
  let max = -Infinity;
  let hasDecimals = false;

  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    if (!hasDecimals && v !== Math.floor(v)) hasDecimals = true;
  }

  // Si valores tienen decimales y rango pequeno → ya en mV
  if (hasDecimals && max < 10 && min > -10) {
    return { detectedBits: 0, confidence: 0.8, minValue: min, maxValue: max, hasDecimals };
  }

  // Detectar resolucion por rango
  let detectedBits: ADCResolution = 10;
  let confidence = 0.5;

  if (max <= 1023 && min >= 0) {
    detectedBits = 10;
    confidence = max > 500 ? 0.9 : 0.6;
  } else if (max <= 4095 && min >= 0) {
    detectedBits = 12;
    confidence = max > 2000 ? 0.9 : 0.6;
  } else if (max <= 16383 && min >= 0) {
    detectedBits = 14;
    confidence = max > 8000 ? 0.9 : 0.6;
  } else if (max <= 65535 && min >= 0) {
    detectedBits = 16;
    confidence = max > 30000 ? 0.9 : 0.6;
  }

  return { detectedBits, confidence, minValue: min, maxValue: max, hasDecimals };
}

/**
 * Convierte un valor crudo a milivoltios.
 *
 *   mV = ((raw - adcMid) / adcMax) * vRef / hwGain * 1000 * calibrationFactor
 */
export function toMillivolts(rawValue: number, config: CalibrationConfig): number {
  if (config.adcBits === 0) {
    return rawValue * config.calibrationFactor;
  }

  const adcMax = (1 << config.adcBits) - 1;
  const adcMid = adcMax / 2;
  const voltage = ((rawValue - adcMid) / adcMax) * config.vRef;
  const mv = (voltage / config.hwGain) * 1000;

  return mv * config.calibrationFactor;
}

/**
 * Factor de escala para convertir valores ADC a mV (sin restar offset).
 * Usar con datos ya filtrados (el filtro HP remueve el DC).
 *
 *   mV = raw * adcToMvScale(config)
 */
export function adcToMvScale(config: CalibrationConfig): number {
  if (config.adcBits === 0) return config.calibrationFactor;
  const adcMax = (1 << config.adcBits) - 1;
  return (config.vRef / adcMax / config.hwGain) * 1000 * config.calibrationFactor;
}

/**
 * Calibra a partir de senal conocida de 1 mV.
 *
 * Mide el pico-a-pico de los datos y devuelve un calibrationFactor
 * que hace que ese pico equivalga a 1 mV exacto.
 */
export function calibrateFrom1mV(
  data: number[],
  config: CalibrationConfig,
): number {
  if (data.length < 20) return 1.0;

  const tempConfig: CalibrationConfig = { ...config, calibrationFactor: 1.0 };
  const mvValues = data.map((v) => toMillivolts(v, tempConfig));

  let min = Infinity;
  let max = -Infinity;
  for (const v of mvValues) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const pp = max - min;
  if (pp <= 0) return 1.0;

  return 1.0 / pp;
}

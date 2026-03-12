/**
 * Deteccion de picos R y calculo de BPM.
 *
 * Algoritmo: umbral adaptativo basado en media + k*desviacion estandar
 * con periodo refractario minimo de 200ms.
 */

const REFRACTORY_MS = 200;

export interface RPeak {
  index: number;
  timestamp_ms: number;
  value: number;
}

/**
 * Detecta picos R en la senal ECG filtrada.
 * Busca maximos locales que superen mean + k * std.
 */
export function detectRPeaks(
  data: { timestamp_ms: number; value: number }[],
  k = 1.2,
): RPeak[] {
  if (data.length < 20) return [];

  const values = data.map((d) => d.value);

  // Estadisticas de la senal
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
  }
  const mean = sum / values.length;
  const std = Math.sqrt(sumSq / values.length - mean * mean);
  const threshold = mean + k * std;

  const peaks: RPeak[] = [];

  for (let i = 2; i < values.length - 2; i++) {
    const v = values[i];

    // Debe superar el umbral
    if (v < threshold) continue;

    // Maximo local (mayor que sus 2 vecinos a cada lado)
    if (
      v > values[i - 1] &&
      v > values[i - 2] &&
      v > values[i + 1] &&
      v > values[i + 2]
    ) {
      // Periodo refractario: ignorar si esta muy cerca del pico anterior
      const lastPeak = peaks[peaks.length - 1];
      if (
        lastPeak &&
        data[i].timestamp_ms - lastPeak.timestamp_ms < REFRACTORY_MS
      ) {
        // Si este pico es mayor, reemplazar el anterior
        if (v > lastPeak.value) {
          peaks[peaks.length - 1] = {
            index: i,
            timestamp_ms: data[i].timestamp_ms,
            value: v,
          };
        }
        continue;
      }

      peaks.push({
        index: i,
        timestamp_ms: data[i].timestamp_ms,
        value: v,
      });
    }
  }

  return peaks;
}

/**
 * Calcula BPM promedio a partir de los picos R detectados.
 * Usa los ultimos N intervalos RR para un valor estable.
 */
export function calculateBPM(peaks: RPeak[], lastN = 10): number {
  if (peaks.length < 2) return 0;

  const start = Math.max(0, peaks.length - lastN - 1);
  const recentPeaks = peaks.slice(start);

  let totalRR = 0;
  let count = 0;

  for (let i = 1; i < recentPeaks.length; i++) {
    const rr = recentPeaks[i].timestamp_ms - recentPeaks[i - 1].timestamp_ms;
    // Descartar RR imposibles (<300ms = >200bpm, >2000ms = <30bpm)
    if (rr > 300 && rr < 2000) {
      totalRR += rr;
      count++;
    }
  }

  if (count === 0) return 0;
  const avgRR = totalRR / count;
  return 60000 / avgRR;
}

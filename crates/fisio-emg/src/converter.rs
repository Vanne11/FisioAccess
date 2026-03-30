//! Conversión de valores ADS1115 para EMG
//!
//! El firmware envía mV directos vía `ads.computeVolts(adc) * 1000`.
//! El procesador recibe mV, NO raw counts — evitando dependencia de la ganancia.
//!
//! Ganancias y resoluciones de referencia:
//! - GAIN_TWOTHIRDS (±6.144V): 0.1875 mV/bit
//! - GAIN_ONE       (±4.096V): 0.125  mV/bit
//! - GAIN_TWO       (±2.048V): 0.0625 mV/bit

/// Resolución del ADS1115 en mV por LSB (GAIN_ONE, ±4.096V)
/// Se usa como fallback cuando el firmware envía raw counts sin conversión.
/// Con el firmware CSV (que envía mV), este valor no se usa en el pipeline.
pub const ADS_RESOLUTION_MV: f64 = 0.125;

/// Offset por defecto en mV (hasta calibración)
/// 14143 counts × 0.125 = ~1768 mV con GAIN_ONE.
/// Se recalcula automáticamente al calibrar.
pub const DEFAULT_OFFSET_MV: f64 = 1768.0;

/// Frecuencia de muestreo del hardware (Hz) - ADS1115 a 860 SPS
pub const SAMPLE_RATE_HZ: f64 = 860.0;

/// Convierte valor RAW del ADS1115 a voltaje en mV
/// Solo se usa para procesamiento offline de raw counts.
/// En el pipeline normal, el firmware ya envía mV.
#[inline]
pub fn raw_to_mv(raw_value: f64) -> f64 {
    raw_value * ADS_RESOLUTION_MV
}

/// Centra la señal restando el offset calibrado (resultado en mV)
#[inline]
pub fn center(voltage_mv: f64, offset_mv: f64) -> f64 {
    voltage_mv - offset_mv
}

/// Rectificación de onda completa (valor absoluto)
#[inline]
pub fn rectify(centered_mv: f64) -> f64 {
    centered_mv.abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raw_to_mv() {
        // 14143 counts × 0.125 = 1767.875 mV
        let mv = raw_to_mv(14143.0);
        assert!((mv - 1767.875).abs() < 0.01);
    }

    #[test]
    fn test_center_at_baseline() {
        let centered = center(1768.0, 1768.0);
        assert!(centered.abs() < 0.01);
    }

    #[test]
    fn test_rectify() {
        assert!((rectify(-1.5) - 1.5).abs() < 0.001);
        assert!((rectify(2.0) - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_center_with_signal() {
        let c = center(1770.0, 1768.0);
        assert!((c - 2.0).abs() < 0.01);
    }
}

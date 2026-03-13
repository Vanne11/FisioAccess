//! Conversión de valores ADS1115 para EMG

/// Resolución del ADS1115 en mV por LSB (gain = 2/3)
pub const ADS_RESOLUTION_MV: f64 = 0.1875;

/// Ganancia típica del sistema de amplificación EMG
pub const DEFAULT_SYSTEM_GAIN: f64 = 1200.0;

/// Offset por defecto en mV (hasta calibración)
pub const DEFAULT_OFFSET_MV: f64 = 666.0;

/// Frecuencia de muestreo del hardware (Hz)
pub const SAMPLE_RATE_HZ: f64 = 100.0;

/// Convierte valor RAW del ADS1115 a voltaje en mV
/// `voltage_mv = raw_value * 0.1875`
#[inline]
pub fn raw_to_mv(raw_value: f64) -> f64 {
    raw_value * ADS_RESOLUTION_MV
}

/// Convierte voltaje en mV a potencial muscular en µV
/// `muscle_potential_uv = ((voltage_mv - offset) / 1200.0) * 1000`
#[inline]
pub fn mv_to_emg_uv(voltage_mv: f64, offset_mv: f64) -> f64 {
    ((voltage_mv - offset_mv) / DEFAULT_SYSTEM_GAIN) * 1000.0
}

/// Pipeline completo: RAW → mV → µV
#[inline]
pub fn raw_to_emg_uv(raw_value: f64, offset_mv: f64) -> f64 {
    let voltage_mv = raw_to_mv(raw_value);
    mv_to_emg_uv(voltage_mv, offset_mv)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raw_to_mv() {
        let mv = raw_to_mv(3552.0); // ~666 mV
        assert!((mv - 666.0).abs() < 0.1);
    }

    #[test]
    fn test_mv_to_emg_uv() {
        // Con offset = 666, voltage = 667 → ((667-666)/1200)*1000 = 0.833 µV
        let uv = mv_to_emg_uv(667.0, 666.0);
        assert!((uv - 0.833).abs() < 0.01);
    }

    #[test]
    fn test_raw_to_emg_uv_at_baseline() {
        // En reposo, raw ≈ 3552 → ~666 mV → ~0 µV
        let uv = raw_to_emg_uv(3552.0, 666.0);
        assert!(uv.abs() < 1.0);
    }
}

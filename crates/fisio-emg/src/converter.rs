//! Conversión de valores ADS1115 para EMG

use fisio_core::utils::{raw_to_mv, mv_to_emg_uv};

/// Constantes del ADS1115
pub const ADS_RESOLUTION_MV: f64 = 0.1875;  // mV por LSB (gain = 2/3)

/// Ganancia típica del sistema de amplificación EMG
pub const DEFAULT_SYSTEM_GAIN: f64 = 1200.0;

/// Convierte valor RAW del ADS1115 a potencial muscular en µV
/// 
/// # Arguments
/// * `raw_value` - Valor RAW del ADC
/// * `offset_mv` - Offset de baseline (calculado en calibración)
/// * `gain` - Ganancia del sistema (default: 1200)
/// 
/// # Returns
/// Potencial muscular en microvolts (µV)
pub fn raw_to_emg_uv(raw_value: u16, offset_mv: f64, gain: f64) -> f64 {
    let voltage_mv = raw_to_mv(raw_value, ADS_RESOLUTION_MV);
    mv_to_emg_uv(voltage_mv, offset_mv, gain)
}

/// Convierte valor RAW a voltaje del sistema (mV)
pub fn raw_to_system_mv(raw_value: u16) -> f64 {
    raw_to_mv(raw_value, ADS_RESOLUTION_MV)
}

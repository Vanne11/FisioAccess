//! Utilidades compartidas para FisioAccess

use chrono::{DateTime, Utc};

/// Convierte un valor RAW del ADS1115 a milivolts
/// 
/// # Arguments
/// * `raw_value` - Valor RAW del ADC (0-65535 para 16-bit)
/// * `resolution` - Resolución en mV por LSB (ej: 0.1875 para gain=2/3)
/// 
/// # Returns
/// Valor en milivolts
#[inline]
pub fn raw_to_mv(raw_value: u16, resolution: f64) -> f64 {
    raw_value as f64 * resolution
}

/// Convierte voltaje a potencial muscular en microvolts
/// 
/// # Arguments
/// * `voltage_mv` - Voltaje en milivolts
/// * `offset_mv` - Offset de baseline en milivolts
/// * `gain` - Ganancia del sistema de amplificación
/// 
/// # Returns
/// Potencial muscular en microvolts (µV)
#[inline]
pub fn mv_to_emg_uv(voltage_mv: f64, offset_mv: f64, gain: f64) -> f64 {
    ((voltage_mv - offset_mv) / gain) * 1000.0
}

/// Calcula el tiempo relativo en milisegundos desde un timestamp de inicio
/// 
/// # Arguments
/// * `start_time` - Timestamp de inicio en milisegundos
/// * `current_time` - Timestamp actual en milisegundos
/// 
/// # Returns
/// Tiempo relativo en milisegundos
#[inline]
pub fn relative_time_ms(start_time: f64, current_time: f64) -> f64 {
    current_time - start_time
}

/// Obtiene el timestamp actual en milisegundos
#[inline]
pub fn now_ms() -> f64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}

/// Obtiene el timestamp actual como DateTime UTC
#[inline]
pub fn now_iso() -> DateTime<Utc> {
    Utc::now()
}

/// Formatea un valor con precisión específica
/// 
/// # Arguments
/// * `value` - Valor a formatear
/// * `decimals` - Número de decimales
/// 
/// # Returns
/// String formateado
#[inline]
pub fn format_value(value: f64, decimals: u8) -> String {
    format!("{:.1$}", value, decimals as usize)
}

/// Calcula el promedio de un slice de valores
/// 
/// # Arguments
/// * `values` - Slice de valores
/// 
/// # Returns
/// Promedio o None si el slice está vacío
pub fn calculate_mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

/// Calcula la desviación estándar de un slice de valores
/// 
/// # Arguments
/// * `values` - Slice de valores
/// 
/// # Returns
/// Desviación estándar o None si hay menos de 2 valores
pub fn calculate_std_dev(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    
    let mean = calculate_mean(values)?;
    let variance = values.iter()
        .map(|x| (x - mean).powi(2))
        .sum::<f64>() / (values.len() - 1) as f64;
    
    Some(variance.sqrt())
}

/// Encuentra el valor máximo en un slice
#[inline]
pub fn find_max(values: &[f64]) -> Option<f64> {
    values.iter().cloned().fold(None, |max, x| {
        Some(max.map_or(x, |m: f64| m.max(x)))
    })
}

/// Encuentra el valor mínimo en un slice
#[inline]
pub fn find_min(values: &[f64]) -> Option<f64> {
    values.iter().cloned().fold(None, |min, x| {
        Some(min.map_or(x, |m: f64| m.min(x)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raw_to_mv() {
        assert!((raw_to_mv(1000, 0.1875) - 187.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_mv_to_emg_uv() {
        let result = mv_to_emg_uv(100.0, 50.0, 1200.0);
        assert!((result - 41.666666).abs() < 0.001);
    }

    #[test]
    fn test_calculate_mean() {
        let values = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(calculate_mean(&values), Some(3.0));
    }

    #[test]
    fn test_calculate_std_dev() {
        let values = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        let std_dev = calculate_std_dev(&values).unwrap();
        assert!((std_dev - 2.138).abs() < 0.01);
    }
}

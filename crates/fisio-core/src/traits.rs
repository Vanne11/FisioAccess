//! Traits comunes para FisioAccess

use crate::types::{CalibrationResult, ConnectionState, DataPoint, DeviceType, FilterParams, SerialConfig};
use async_trait::async_trait;

/// Trait para dispositivos seriales
#[async_trait]
pub trait SerialDevice: Send + Sync {
    /// Conectar al dispositivo
    async fn connect(&mut self, config: SerialConfig) -> Result<(), String>;
    
    /// Desconectar del dispositivo
    async fn disconnect(&mut self);
    
    /// Iniciar lectura de datos
    async fn start_reading(&mut self);
    
    /// Detener lectura de datos
    async fn stop_reading(&mut self);
    
    /// Enviar comando al dispositivo
    async fn write(&mut self, data: &[u8]) -> Result<(), String>;
    
    /// Verificar si está conectado
    fn is_connected(&self) -> bool;
    
    /// Obtener tipo de dispositivo
    fn device_type(&self) -> DeviceType;
}

/// Trait para filtros de señal
pub trait Filter: Send + Sync {
    /// Aplicar filtro a un valor
    fn apply(&mut self, value: f64) -> f64;
    
    /// Resetear el estado del filtro
    fn reset(&mut self);
    
    /// Habilitar/deshabilitar filtro
    fn set_enabled(&mut self, enabled: bool);
    
    /// Verificar si está habilitado
    fn is_enabled(&self) -> bool;
}

/// Trait para handlers de dispositivo (nivel más alto)
#[async_trait]
pub trait DeviceHandler: SerialDevice {
    /// Obtener último dato procesado
    fn get_latest_data(&self) -> Option<DataPoint>;
    
    /// Obtener buffer de datos recientes
    fn get_data_buffer(&self) -> Vec<DataPoint>;
    
    /// Aplicar configuración de filtros
    fn set_filter_params(&mut self, params: FilterParams);
    
    /// Obtener estado de conexión actual
    fn connection_state(&self) -> ConnectionState;
}

/// Trait para dispositivos con calibración (como EMG)
#[async_trait]
pub trait Calibratable: DeviceHandler {
    /// Iniciar proceso de calibración
    async fn start_calibration(&mut self, duration_ms: u32) -> Result<(), String>;
    
    /// Detener calibración y obtener resultado
    async fn stop_calibration(&mut self) -> Result<CalibrationResult, String>;
    
    /// Obtener progreso de calibración (0.0 a 1.0)
    fn get_calibration_progress(&self) -> f32;
    
    /// Verificar si está calibrado
    fn is_calibrated(&self) -> bool;
}

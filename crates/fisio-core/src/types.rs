//! Tipos compartidos para FisioAccess

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Punto de datos de una señal médica
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPoint {
    /// Timestamp en milisegundos desde el inicio de la adquisición
    pub timestamp_ms: f64,
    /// Valor de la señal
    pub value: f64,
    /// Timestamp ISO absoluto (opcional, para logging)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_iso: Option<DateTime<Utc>>,
}

impl DataPoint {
    pub fn new(timestamp_ms: f64, value: f64) -> Self {
        Self {
            timestamp_ms,
            value,
            timestamp_iso: Some(Utc::now()),
        }
    }
}

/// Configuración de conexión serial
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    /// Nombre del puerto (ej: "COM3", "/dev/ttyUSB0")
    pub port: String,
    /// Baudios (ej: 9600, 115200)
    pub baud_rate: u32,
}

impl SerialConfig {
    pub fn new(port: &str, baud_rate: u32) -> Self {
        Self {
            port: port.to_string(),
            baud_rate,
        }
    }
}

/// Parámetros de configuración de filtros
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterParams {
    /// Frecuencia de corte para low-pass (Hz)
    pub lowpass_cutoff: Option<f64>,
    /// Frecuencia de corte para high-pass (Hz)
    pub highpass_cutoff: Option<f64>,
    /// Frecuencia del notch filter (Hz)
    pub notch_freq: Option<f64>,
    /// Ventana del promedio móvil (muestras)
    pub moving_avg_window: Option<usize>,
}

impl Default for FilterParams {
    fn default() -> Self {
        Self {
            lowpass_cutoff: Some(30.0),
            highpass_cutoff: Some(0.5),
            notch_freq: Some(50.0),
            moving_avg_window: Some(10),
        }
    }
}

/// Estado de conexión de un dispositivo
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

/// Resultado de calibración
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationResult {
    /// Si la calibración fue exitosa
    pub success: bool,
    /// Valor de offset calculado (en mV)
    pub offset_mv: f64,
    /// Mensaje descriptivo
    pub message: String,
}

/// Tipos de dispositivo soportados
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DeviceType {
    ECG,
    EMG,
    Spirometer,
}

impl std::fmt::Display for DeviceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeviceType::ECG => write!(f, "ECG"),
            DeviceType::EMG => write!(f, "EMG"),
            DeviceType::Spirometer => write!(f, "Espirómetro"),
        }
    }
}

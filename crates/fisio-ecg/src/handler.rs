//! Handler para dispositivo ECG

use fisio_core::{DeviceType, SerialConfig, ConnectionState, DataPoint, FilterParams};
use fisio_serial::SerialManager;

/// Handler para procesamiento de señales ECG
pub struct EcgHandler {
    serial: SerialManager,
    state: ConnectionState,
    buffer: Vec<DataPoint>,
    bpm: Option<u32>,
    lead_off: bool,
    saturation: bool,
}

impl EcgHandler {
    pub fn new() -> Self {
        Self {
            serial: SerialManager::new(),
            state: ConnectionState::Disconnected,
            buffer: Vec::with_capacity(2000),
            bpm: None,
            lead_off: false,
            saturation: false,
        }
    }

    /// Obtener BPM actual
    pub fn get_bpm(&self) -> Option<u32> {
        self.bpm
    }

    /// Verificar si hay lead-off
    pub fn is_lead_off(&self) -> bool {
        self.lead_off
    }

    /// Verificar si hay saturación
    pub fn is_saturation(&self) -> bool {
        self.saturation
    }

    /// Enviar comando al dispositivo ECG
    pub async fn send_command(&mut self, cmd: &str) -> Result<(), String> {
        self.serial.write(cmd.as_bytes()).await
    }
}

impl Default for EcgHandler {
    fn default() -> Self {
        Self::new()
    }
}

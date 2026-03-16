//! Handler para espirómetro

use fisio_core::ConnectionState;
use fisio_serial::SerialManager;
use crate::test_manager::TestRecord;

/// Handler para procesamiento de espirómetro
#[allow(dead_code)]
pub struct SpiroHandler {
    serial: SerialManager,
    state: ConnectionState,
    is_calibrated: bool,
    is_testing: bool,
    tests: Vec<TestRecord>,
}

impl SpiroHandler {
    pub fn new() -> Self {
        Self {
            serial: SerialManager::new(),
            state: ConnectionState::Disconnected,
            is_calibrated: false,
            is_testing: false,
            tests: Vec::new(),
        }
    }

    /// Iniciar calibración del espirómetro
    pub async fn calibrate(&mut self) -> Result<(), String> {
        if !self.serial.is_connected() {
            return Err("No conectado".to_string());
        }
        // TODO: Implementar calibración
        self.is_calibrated = true;
        Ok(())
    }

    /// Iniciar prueba de volumen
    pub async fn start_test(&mut self) -> Result<(), String> {
        if !self.is_calibrated {
            return Err("Debe calibrar antes de iniciar prueba".to_string());
        }
        self.is_testing = true;
        Ok(())
    }

    /// Detener prueba
    pub async fn stop_test(&mut self) -> Result<(), String> {
        self.is_testing = false;
        Ok(())
    }

    /// Obtener lista de pruebas
    pub fn get_tests(&self) -> &[TestRecord] {
        &self.tests
    }

    /// Verificar si está calibrado
    pub fn is_calibrated(&self) -> bool {
        self.is_calibrated
    }

    /// Verificar si está en prueba
    pub fn is_testing(&self) -> bool {
        self.is_testing
    }
}

impl Default for SpiroHandler {
    fn default() -> Self {
        Self::new()
    }
}

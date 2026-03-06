//! Gestor de conexiones seriales

use fisio_core::{SerialConfig, ConnectionState, DeviceType};
use tokio::sync::mpsc;

/// Gestor principal de conexiones seriales
pub struct SerialManager {
    config: Option<SerialConfig>,
    state: ConnectionState,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            config: None,
            state: ConnectionState::Disconnected,
        }
    }

    /// Obtener lista de puertos disponibles
    pub fn get_available_ports() -> Vec<SerialPortInfo> {
        use serialport::available_ports;
        
        match available_ports() {
            Ok(ports) => ports
                .into_iter()
                .map(|p| SerialPortInfo {
                    name: p.port_name,
                    port_type: format!("{:?}", p.port_type),
                })
                .collect(),
            Err(_) => vec![],
        }
    }

    /// Conectar a un puerto serial
    pub async fn connect(&mut self, config: SerialConfig) -> Result<(), String> {
        self.config = Some(config);
        self.state = ConnectionState::Connected;
        Ok(())
    }

    /// Desconectar del puerto serial
    pub async fn disconnect(&mut self) {
        self.config = None;
        self.state = ConnectionState::Disconnected;
    }

    /// Enviar datos por serial
    pub async fn write(&mut self, _data: &[u8]) -> Result<(), String> {
        if self.state != ConnectionState::Connected {
            return Err("Not connected".to_string());
        }
        Ok(())
    }

    /// Verificar si está conectado
    pub fn is_connected(&self) -> bool {
        self.state == ConnectionState::Connected
    }

    /// Obtener estado actual
    pub fn state(&self) -> &ConnectionState {
        &self.state
    }
}

impl Default for SerialManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Información de un puerto serial
#[derive(Debug, Clone)]
pub struct SerialPortInfo {
    pub name: String,
    pub port_type: String,
}

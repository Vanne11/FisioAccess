//! Servidor WebSocket

use tokio::sync::broadcast;

/// Servidor WebSocket para transmisión en tiempo real
pub struct WebSocketServer {
    is_running: bool,
    port: u16,
    tx: broadcast::Sender<String>,
}

impl WebSocketServer {
    pub fn new(port: u16) -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            is_running: false,
            port,
            tx,
        }
    }

    /// Iniciar servidor
    pub async fn start(&mut self) -> Result<(), String> {
        self.is_running = true;
        // TODO: Implementar servidor WebSocket real
        Ok(())
    }

    /// Detener servidor
    pub async fn stop(&mut self) -> Result<(), String> {
        self.is_running = false;
        Ok(())
    }

    /// Broadcast de datos a clientes conectados
    pub fn broadcast(&self, data: &str) -> Result<(), String> {
        if !self.is_running {
            return Err("Servidor no está corriendo".to_string());
        }
        
        self.tx.send(data.to_string())
            .map_err(|e| format!("Error al broadcast: {}", e))?;
        
        Ok(())
    }

    /// Obtener puerto del servidor
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Verificar si está corriendo
    pub fn is_running(&self) -> bool {
        self.is_running
    }
}

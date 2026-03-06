//! Envío de datos por HTTP

use fisio_core::DataPoint;
use reqwest::Client;

/// Enviador de datos a servidor HTTP
pub struct HttpSender {
    client: Client,
    base_url: String,
    is_transmitting: bool,
}

impl HttpSender {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.to_string(),
            is_transmitting: false,
        }
    }

    /// Iniciar transmisión
    pub fn start(&mut self) -> Result<(), String> {
        self.is_transmitting = true;
        Ok(())
    }

    /// Detener transmisión
    pub fn stop(&mut self) -> Result<(), String> {
        self.is_transmitting = false;
        Ok(())
    }

    /// Enviar muestra al servidor
    pub async fn send_sample(&self, raw_mv: f64, filtered_uv: f64) -> Result<(), String> {
        if !self.is_transmitting {
            return Ok(());
        }

        let payload = serde_json::json!({
            "raw_mv": raw_mv,
            "filtered_uv": filtered_uv,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        self.client
            .post(&format!("{}/api/data", self.base_url))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Error HTTP: {}", e))?;

        Ok(())
    }

    /// Limpiar datos en el servidor
    pub async fn clear_server_data(&self) -> Result<(), String> {
        self.client
            .post(&format!("{}/api/clear", self.base_url))
            .send()
            .await
            .map_err(|e| format!("Error HTTP: {}", e))?;

        Ok(())
    }

    /// Verificar si está transmitiendo
    pub fn is_transmitting(&self) -> bool {
        self.is_transmitting
    }
}

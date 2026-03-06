//! Grabación de datos a CSV

use fisio_core::DataPoint;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

/// Grabador de datos a archivo CSV
pub struct DataLogger {
    file_path: Option<PathBuf>,
    writer: Option<BufWriter<File>>,
    is_logging: bool,
    sample_count: u32,
    start_time_ms: f64,
}

impl DataLogger {
    pub fn new() -> Self {
        Self {
            file_path: None,
            writer: None,
            is_logging: false,
            sample_count: 0,
            start_time_ms: 0.0,
        }
    }

    /// Iniciar grabación
    pub fn start(&mut self, directory: &str, prefix: &str) -> Result<String, String> {
        use chrono::Utc;
        
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("{}_{}.csv", prefix, timestamp);
        let path = PathBuf::from(directory).join(&filename);

        // Crear directorio si no existe
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Error al crear directorio: {}", e))?;
        }

        let file = File::create(&path)
            .map_err(|e| format!("Error al crear archivo: {}", e))?;
        
        let mut writer = BufWriter::new(file);
        
        // Escribir encabezados
        writeln!(writer, "timestamp_iso,time_ms,sample_number,raw_value_mv,filtered_value_uv")
            .map_err(|e| format!("Error al escribir encabezados: {}", e))?;

        self.file_path = Some(path.clone());
        self.writer = Some(writer);
        self.is_logging = true;
        self.sample_count = 0;
        self.start_time_ms = fisio_core::utils::now_ms();

        Ok(filename)
    }

    /// Grabar muestra
    pub fn log(&mut self, raw_mv: f64, filtered_uv: f64) -> Result<(), String> {
        if !self.is_logging || self.writer.is_none() {
            return Err("Grabación no iniciada".to_string());
        }

        let now_ms = fisio_core::utils::now_ms();
        let time_ms = now_ms - self.start_time_ms;
        self.sample_count += 1;

        let timestamp_iso = fisio_core::utils::now_iso();
        
        let writer = self.writer.as_mut().unwrap();
        writeln!(writer, "{},{},{},{:.3},{:.1}", 
            timestamp_iso.format("%Y-%m-%dT%H:%M:%S%.3fZ"),
            time_ms,
            self.sample_count,
            raw_mv,
            filtered_uv
        ).map_err(|e| format!("Error al escribir: {}", e))?;

        // Flush cada 100 muestras
        if self.sample_count % 100 == 0 {
            writer.flush().map_err(|e| format!("Error al hacer flush: {}", e))?;
        }

        Ok(())
    }

    /// Detener grabación
    pub fn stop(&mut self) -> Result<u32, String> {
        if !self.is_logging {
            return Ok(0);
        }

        if let Some(ref mut writer) = self.writer {
            writer.flush().map_err(|e| format!("Error al finalizar: {}", e))?;
        }

        self.is_logging = false;
        self.writer = None;
        
        let count = self.sample_count;
        self.sample_count = 0;
        
        Ok(count)
    }

    /// Obtener ruta del archivo actual
    pub fn get_file_path(&self) -> Option<&PathBuf> {
        self.file_path.as_ref()
    }

    /// Verificar si está grabando
    pub fn is_logging(&self) -> bool {
        self.is_logging
    }
}

impl Default for DataLogger {
    fn default() -> Self {
        Self::new()
    }
}

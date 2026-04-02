use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use fisio_emg::{EmgProcessor, EmgConfig};

#[derive(Debug, Clone, Serialize)]
pub struct SerialDataPoint {
    pub timestamp_ms: f64,
    /// Señal filtrada (forma de onda, puede ser negativa)
    pub filtered: f64,
    /// Envolvente suavizada (siempre >= 0, amplitud de contracción)
    pub envelope: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalibrationStatus {
    pub calibrating: bool,
    pub calibrated: bool,
    pub progress: f64,
    pub offset_mv: f64,
}

struct SerialInner {
    running: Arc<AtomicBool>,
    connected: bool,
}

pub struct SerialManager {
    inner: Mutex<SerialInner>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(SerialInner {
                running: Arc::new(AtomicBool::new(false)),
                connected: false,
            }),
        }
    }

    pub fn connect(
        &self,
        port_name: &str,
        baud_rate: u32,
        app: AppHandle,
        emg_processor: Option<Arc<Mutex<EmgProcessor>>>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| format!("Lock: {e}"))?;

        if inner.connected {
            return Err("Ya conectado".into());
        }

        let port = serialport::new(port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| format!("Error al abrir {port_name}: {e}"))?;

        let running = Arc::new(AtomicBool::new(true));
        inner.running = running.clone();
        inner.connected = true;

        // Spawn reader thread
        std::thread::spawn(move || {
            // Buffer de 64KB: a 860 SPS con ~30 bytes/línea, caben ~2100 líneas (~2.5s)
            // Evita pérdida de paquetes si el procesamiento se retrasa momentáneamente
            let mut reader = std::io::BufReader::with_capacity(64 * 1024, port);
            let mut line = String::new();
            let start = Instant::now();
            let mut last_progress_emit = Instant::now();

            while running.load(Ordering::Relaxed) {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();

                        // Ignorar líneas vacías
                        if trimmed.is_empty() {
                            continue;
                        }

                        // Capturar lineas "BPM: xx" del firmware
                        if let Some(bpm_str) = trimmed.strip_prefix("BPM:") {
                            if let Ok(bpm) = bpm_str.trim().parse::<f64>() {
                                let _ = app.emit("serial-bpm", bpm);
                            }
                            continue;
                        }

                        // Ignorar headers y líneas no numéricas del firmware
                        // (ej: "ADS1115 EMG Ready", "timestamp_ms,adc_raw,mv")
                        let first_char = trimmed.as_bytes().first().copied().unwrap_or(0);
                        if !first_char.is_ascii_digit() && first_char != b'-' {
                            log::debug!("Serial skip header: {trimmed}");
                            continue;
                        }

                        // Detectar formato:
                        // - Solo un número: "14143" → raw ADC counts, convertir a mV
                        // - CSV con comas: "ts,raw,mv" → tomar último campo (ya es mV)
                        let mv_value = if trimmed.contains(',') {
                            // CSV: último campo es mV (firmware envía computeVolts)
                            trimmed
                                .split(',')
                                .last()
                                .unwrap_or("")
                                .trim()
                                .parse::<f64>()
                                .ok()
                        } else {
                            // Valor único: raw ADC counts → convertir a mV
                            trimmed.parse::<f64>().ok().map(|raw| {
                                raw * fisio_emg::converter::ADS_RESOLUTION_MV
                            })
                        };

                        if let Some(mv) = mv_value {
                            let (filtered, envelope) = if let Some(ref proc) = emg_processor {
                                if let Ok(mut p) = proc.lock() {
                                    let was_calibrating = p.is_calibrating();

                                    let sample = p.process(mv);

                                    // Emitir progreso max 10 veces/segundo (no saturar React)
                                    if p.is_calibrating() {
                                        if last_progress_emit.elapsed() >= Duration::from_millis(100) {
                                            let progress = p.calibration_progress();
                                            let _ = app.emit("emg-calibration-progress", progress);
                                            last_progress_emit = Instant::now();
                                        }
                                    } else if was_calibrating && p.is_calibrated() {
                                        // Calibración acaba de terminar (solo una vez)
                                        let status = CalibrationStatus {
                                            calibrating: false,
                                            calibrated: true,
                                            progress: 1.0,
                                            offset_mv: p.offset_mv(),
                                        };
                                        let _ = app.emit("emg-calibration-done", &status);
                                    }

                                    (sample.filtered, sample.envelope)
                                } else {
                                    (mv, mv.abs())
                                }
                            } else {
                                (mv, mv.abs())
                            };

                            let point = SerialDataPoint {
                                timestamp_ms: start.elapsed().as_millis() as f64,
                                filtered,
                                envelope,
                            };
                            let _ = app.emit("serial-data", &point);
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                    Err(e) => {
                        let _ = app.emit("serial-error", format!("{e}"));
                        break;
                    }
                }
            }

            let _ = app.emit("serial-disconnected", ());
        });

        Ok(())
    }

    pub fn disconnect(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.running.store(false, Ordering::Relaxed);
            inner.connected = false;
        }
    }

    pub fn is_connected(&self) -> bool {
        self.inner
            .lock()
            .map(|i| i.connected)
            .unwrap_or(false)
    }
}

pub struct AppState {
    pub serial: SerialManager,
    pub emg_processor: Arc<Mutex<EmgProcessor>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            serial: SerialManager::new(),
            emg_processor: Arc::new(Mutex::new(EmgProcessor::new(EmgConfig::default()))),
        }
    }
}

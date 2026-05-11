use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serialport::SerialPort;
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

/// Muestra cruda del firmware del espirómetro Venturi.
/// `t_ms` es el tiempo del Arduino tal cual (puede resetear); el frontend
/// detecta el reset y lleva el tiempo relativo de la grabación.
#[derive(Debug, Clone, Serialize)]
pub struct SpiroDataPoint {
    pub t_ms: f64,
    pub p: f64,
    pub f: f64,
    pub v: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalibrationStatus {
    pub calibrating: bool,
    pub calibrated: bool,
    pub progress: f64,
    pub offset_mv: f64,
}

type SharedWriter = Arc<Mutex<Box<dyn SerialPort>>>;

struct SerialInner {
    running: Arc<AtomicBool>,
    connected: bool,
    writer: Option<SharedWriter>,
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
                writer: None,
            }),
        }
    }

    pub fn connect(
        &self,
        port_name: &str,
        baud_rate: u32,
        app: AppHandle,
        emg_processor: Option<Arc<Mutex<EmgProcessor>>>,
        mode: Option<String>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| format!("Lock: {e}"))?;

        if inner.connected {
            return Err("Ya conectado".into());
        }

        let port = serialport::new(port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| format!("Error al abrir {port_name}: {e}"))?;

        // Clonar handle para escritura desde otros hilos (comandos PC→Arduino)
        let writer = port
            .try_clone()
            .map_err(|e| format!("No se pudo clonar puerto: {e}"))?;

        let running = Arc::new(AtomicBool::new(true));
        inner.running = running.clone();
        inner.connected = true;
        inner.writer = Some(Arc::new(Mutex::new(writer)));
        let is_spiro = mode.as_deref() == Some("spiro");

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

                        // Modo espirómetro: protocolo CSV de 4 columnas
                        // "t_ms,presion_kpa,flujo_L/s,volumen_L".
                        // Las líneas de texto ("Iniciando calibración...", etc.)
                        // se reenvían como spiro-calibration-msg para que la UI
                        // muestre el progreso de calibración del firmware.
                        if is_spiro {
                            let first_char = trimmed.as_bytes().first().copied().unwrap_or(0);
                            if !first_char.is_ascii_digit() && first_char != b'-' {
                                let _ = app.emit("spiro-calibration-msg", trimmed.to_string());
                                continue;
                            }
                            let parts: Vec<&str> = trimmed.split(',').collect();
                            if parts.len() == 4 {
                                if let (Ok(t), Ok(p), Ok(f), Ok(v)) = (
                                    parts[0].trim().parse::<f64>(),
                                    parts[1].trim().parse::<f64>(),
                                    parts[2].trim().parse::<f64>(),
                                    parts[3].trim().parse::<f64>(),
                                ) {
                                    let point = SpiroDataPoint { t_ms: t, p, f, v };
                                    let _ = app.emit("spiro-data", &point);
                                }
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
                        // - Solo un número: raw del ADC. Solo el EMG (ADS1115)
                        //   se convierte a mV en el backend; ECG/Spiro pasan
                        //   el crudo y el frontend lo convierte con su propia
                        //   calibración (Vref, ganancia, bits del ADC).
                        // - CSV "ts,raw,mv" → último campo, ya en mV.
                        let parsed = if trimmed.contains(',') {
                            trimmed
                                .split(',')
                                .last()
                                .unwrap_or("")
                                .trim()
                                .parse::<f64>()
                                .ok()
                        } else {
                            trimmed.parse::<f64>().ok().map(|raw| {
                                if emg_processor.is_some() {
                                    raw * fisio_emg::converter::ADS_RESOLUTION_MV
                                } else {
                                    raw
                                }
                            })
                        };

                        if let Some(value) = parsed {
                            let (filtered, envelope) = if let Some(ref proc) = emg_processor {
                                if let Ok(mut p) = proc.lock() {
                                    let was_calibrating = p.is_calibrating();

                                    let sample = p.process(value);

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
                                    (value, value.abs())
                                }
                            } else {
                                // ECG / Spiro: pasar raw del ADC. El frontend
                                // se encarga de filtrar y convertir a mV.
                                (value, value.abs())
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
            inner.writer = None;
        }
    }

    pub fn is_connected(&self) -> bool {
        self.inner
            .lock()
            .map(|i| i.connected)
            .unwrap_or(false)
    }

    /// Escribir bytes al puerto (PC → Arduino). Usado por comandos
    /// como `spiro_send_command` ('r' = calibrar, 'v' = reset volumen).
    pub fn write_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        let writer = {
            let inner = self.inner.lock().map_err(|e| format!("Lock: {e}"))?;
            if !inner.connected {
                return Err("Puerto no conectado".into());
            }
            inner.writer.clone().ok_or("Puerto sin writer")?
        };
        let mut w = writer.lock().map_err(|e| format!("Lock writer: {e}"))?;
        w.write_all(bytes).map_err(|e| format!("Write: {e}"))?;
        w.flush().map_err(|e| format!("Flush: {e}"))?;
        Ok(())
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

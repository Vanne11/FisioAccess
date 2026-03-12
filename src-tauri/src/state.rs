use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct SerialDataPoint {
    pub timestamp_ms: f64,
    pub value: f64,
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

    pub fn connect(&self, port_name: &str, baud_rate: u32, app: AppHandle) -> Result<(), String> {
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
            let mut reader = std::io::BufReader::new(port);
            let mut line = String::new();
            let start = Instant::now();

            while running.load(Ordering::Relaxed) {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        // Try parsing as f64 directly, or last CSV field (signal value)
                        // Capturar lineas "BPM: xx" del firmware
                        if let Some(bpm_str) = trimmed.strip_prefix("BPM:") {
                            if let Ok(bpm) = bpm_str.trim().parse::<f64>() {
                                let _ = app.emit("serial-bpm", bpm);
                            }
                            continue;
                        }

                        let value = trimmed
                            .parse::<f64>()
                            .or_else(|_| {
                                trimmed
                                    .split([',', '\t', ';'])
                                    .last()
                                    .unwrap_or("")
                                    .trim()
                                    .parse::<f64>()
                            })
                            .ok();

                        if let Some(value) = value {
                            let point = SerialDataPoint {
                                timestamp_ms: start.elapsed().as_millis() as f64,
                                value,
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            serial: SerialManager::new(),
        }
    }
}

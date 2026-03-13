use crate::state::AppState;
use fisio_serial::SerialPortInfo;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
pub struct PortInfo {
    pub name: String,
    pub port_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub port: Option<String>,
}

#[tauri::command]
pub fn list_ports() -> Vec<PortInfo> {
    SerialPortInfo::list_available()
        .into_iter()
        .map(|p| PortInfo {
            name: p.name,
            port_type: p.port_type,
        })
        .collect()
}

/// Conectar al puerto serial.
/// `mode`: opcional, "emg" activa el procesamiento DSP en Rust.
#[tauri::command]
pub fn serial_connect(
    state: State<'_, AppState>,
    app: AppHandle,
    port: String,
    baud_rate: u32,
    mode: Option<String>,
) -> Result<ConnectionStatus, String> {
    let emg_proc = if mode.as_deref() == Some("emg") {
        // Reset del procesador para nueva sesión
        if let Ok(mut proc) = state.emg_processor.lock() {
            *proc = fisio_emg::EmgProcessor::new(fisio_emg::EmgConfig::default());
        }
        Some(state.emg_processor.clone())
    } else {
        None
    };

    state.serial.connect(&port, baud_rate, app, emg_proc)?;
    Ok(ConnectionStatus {
        connected: true,
        port: Some(port),
    })
}

#[tauri::command]
pub fn serial_disconnect(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    state.serial.disconnect();
    Ok(ConnectionStatus {
        connected: false,
        port: None,
    })
}

#[tauri::command]
pub fn get_connection_state(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    Ok(ConnectionStatus {
        connected: state.serial.is_connected(),
        port: None,
    })
}

/// Iniciar calibración EMG (5 segundos por defecto)
#[tauri::command]
pub fn emg_start_calibration(
    state: State<'_, AppState>,
    duration_secs: Option<f64>,
) -> Result<(), String> {
    let mut proc = state
        .emg_processor
        .lock()
        .map_err(|e| format!("Lock: {e}"))?;
    let secs = duration_secs.unwrap_or(5.0);
    proc.start_calibration(secs);
    Ok(())
}

/// Obtener estado de calibración EMG
#[tauri::command]
pub fn emg_calibration_status(
    state: State<'_, AppState>,
) -> Result<crate::state::CalibrationStatus, String> {
    let proc = state
        .emg_processor
        .lock()
        .map_err(|e| format!("Lock: {e}"))?;
    Ok(crate::state::CalibrationStatus {
        calibrating: proc.is_calibrating(),
        calibrated: proc.is_calibrated(),
        progress: proc.calibration_progress(),
        offset_mv: proc.offset_mv(),
    })
}

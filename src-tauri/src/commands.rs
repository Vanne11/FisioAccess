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

#[tauri::command]
pub fn serial_connect(
    state: State<'_, AppState>,
    app: AppHandle,
    port: String,
    baud_rate: u32,
) -> Result<ConnectionStatus, String> {
    state.serial.connect(&port, baud_rate, app)?;
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

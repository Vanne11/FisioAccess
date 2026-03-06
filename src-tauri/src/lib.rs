mod commands;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::serial_connect,
            commands::serial_disconnect,
            commands::get_connection_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

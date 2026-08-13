mod error;
mod sftp;
mod ssh;
mod protocol;
mod serial;
mod telnet;
mod store;
mod docker;
mod forward;
mod performance;
mod services;
mod logs;

use tauri::Manager;
use sftp::SftpManager;
use ssh::SshManager;
use protocol::ProtocolManager;
use forward::ForwardManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(SshManager::default())
    .manage(ProtocolManager::default())
    .manage(SftpManager::default())
    .manage(ForwardManager::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Set the known_hosts file path for TOFU host key verification.
      if let Ok(config_dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&config_dir);
        ssh::set_known_hosts_path(config_dir.join("known_hosts.json"));
      }
      Ok(())
    });

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    builder = builder
      .plugin(tauri_plugin_updater::Builder::new().build())
      .plugin(tauri_plugin_process::init());
  }

  builder
    .invoke_handler(tauri::generate_handler![
      ssh::ssh_connect,
      ssh::ssh_send_input,
      ssh::ssh_resize,
      ssh::ssh_disconnect,
      protocol::protocol_connect,
      protocol::protocol_send_input,
      protocol::protocol_disconnect,
      serial::list_serial_ports,
      store::load_config,
      store::save_config,
      store::delete_server_secret,
      sftp::sftp_connect,
      sftp::sftp_home,
      sftp::sftp_list,
      sftp::sftp_download,
      sftp::sftp_download_dir,
      sftp::sftp_upload,
      sftp::sftp_upload_dir,
      sftp::sftp_cancel,
      sftp::sftp_mkdir,
      sftp::sftp_remove,
      sftp::sftp_rename,
      sftp::sftp_disconnect,
      docker::get_remote_docker_version,
      docker::get_remote_docker_info,
      docker::list_remote_containers,
      docker::control_remote_container,
      docker::create_remote_container,
      docker::rename_remote_container,
      docker::remove_remote_container,
      docker::get_remote_container_logs,
      performance::get_performance_snapshot,
      services::list_remote_services,
      services::control_remote_service,
      logs::list_remote_logs,
      logs::read_remote_log,
      forward::ssh_forward_start,
      forward::ssh_forward_stop,
      forward::ssh_forward_stop_all,
      forward::ssh_forward_list,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

mod sftp;
mod ssh;
mod store;
mod docker;

use sftp::SftpManager;
use ssh::SshManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(SshManager::default())
    .manage(SftpManager::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ssh::ssh_connect,
      ssh::ssh_send_input,
      ssh::ssh_resize,
      ssh::ssh_disconnect,
      store::load_config,
      store::save_config,
      store::delete_server_secret,
      sftp::sftp_connect,
      sftp::sftp_home,
      sftp::sftp_list,
      sftp::sftp_download,
      sftp::sftp_download_dir,
      sftp::sftp_upload,
      sftp::sftp_mkdir,
      sftp::sftp_remove,
      sftp::sftp_rename,
      sftp::sftp_disconnect,
      docker::get_remote_docker_version,
      docker::list_remote_containers,
      docker::control_remote_container,
      docker::create_remote_container,
      docker::rename_remote_container,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

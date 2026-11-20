mod env_path;
mod fs_tree;
mod git_ops;
mod lsp_bridge;
mod plugin_host;
mod pty_dock;
mod search;
mod task_runner;

use env_path::AppEnv;
use fs_tree::FsWatcherState;
use lsp_bridge::LspState;
use plugin_host::PluginWatcherState;
use pty_dock::PtyState;
use task_runner::TaskState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_env = AppEnv::init();
    let _ = plugin_host::ensure_spec_file(&app_env.ke_plugins_dir);

    tauri::Builder::default()
        .manage(app_env)
        .manage(FsWatcherState::new())
        .manage(TaskState::new())
        .manage(PtyState::new())
        .manage(LspState::new())
        .manage(PluginWatcherState::new())
        .invoke_handler(tauri::generate_handler![
            env_path::app_get_context,
            env_path::app_pick_workspace,
            env_path::app_open_workspace_window,
            env_path::app_open_external,
            fs_tree::fs_list_tree,
            fs_tree::fs_read_file,
            fs_tree::fs_write_file,
            fs_tree::fs_create_file,
            fs_tree::fs_rename,
            fs_tree::fs_delete,
            fs_tree::fs_watch_workspace,
            fs_tree::fs_reveal_in_finder,
            search::search_workspace,
            search::search_replace,
            git_ops::git_init,
            git_ops::git_status,
            git_ops::git_diff_file,
            git_ops::git_stage,
            git_ops::git_unstage,
            git_ops::git_discard,
            git_ops::git_commit,
            git_ops::git_log,
            git_ops::git_branches,
            git_ops::git_checkout,
            git_ops::git_fetch,
            git_ops::git_graph,
            git_ops::git_commit_detail,
            git_ops::git_diff_commit_file,
            git_ops::git_compare_refs,
            git_ops::git_diff_refs_file,
            git_ops::git_push,
            git_ops::git_pull,
            git_ops::git_stash_list,
            git_ops::git_stash_push,
            git_ops::git_stash_pop,
            git_ops::git_list_repos,
            task_runner::task_discover,
            task_runner::task_run,
            task_runner::task_run_custom,
            task_runner::task_stop,
            task_runner::task_restart,
            pty_dock::pty_spawn,
            pty_dock::pty_write,
            pty_dock::pty_resize,
            pty_dock::pty_kill,
            lsp_bridge::lsp_notify,
            lsp_bridge::lsp_request,
            lsp_bridge::lsp_status,
            plugin_host::plugin_list,
            plugin_host::plugin_execute,
            plugin_host::plugin_watch,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Klot IDE Tauri 应用失败");
}

//! 拡張フォルダ(パックの読み込み)。
//!
//! 指定したフォルダの直下にある `<id>/` を 1 つのパックとして読み、その中の JSON ファイルを文字列で返す。
//! 検証(マニフェストの形・コンテンツの中身・サイズ)は TypeScript 側(src/lib/extensions/)が、
//! レジストリのバンドルと同じ実装で行う。ここは「読むだけ」で、次を守る。
//!
//! - 読み取り専用。何も書き込まない・削除しない(既定のフォルダを作る場合を除く)。
//! - 拡張フォルダの外は読まない。シンボリックリンク(フォルダ・ファイルとも)はたどらない。
//! - 読むのは `.json` だけ。隠しファイルは読まない。階層・ファイル数・大きさに上限がある。

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// 1 ファイルの上限(バイト)。TypeScript 側の PACK_LIMITS.fileBytes と同じ
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// 1 パックの上限(バイト)。コンテンツの合計 1MB + マニフェストの余裕
const MAX_PACK_BYTES: u64 = 1024 * 1024 + 64 * 1024;
/// 1 パックのファイル数の上限
const MAX_FILES: usize = 40;
/// たどる階層の上限(パックのフォルダの下)
const MAX_DEPTH: usize = 3;
/// 読み込むパックの数の上限
const MAX_PACKS: usize = 100;

#[derive(Serialize)]
pub struct PackEntry {
    /// フォルダ名
    dir: String,
    /// フォルダからの相対パス("/" 区切り) → ファイルの中身
    files: BTreeMap<String, String>,
    /// 読めなかった理由
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
pub struct ScanResult {
    /// 読んだフォルダの絶対パス
    root: String,
    packs: Vec<PackEntry>,
}

/// 既定の拡張フォルダ(アプリのデータフォルダ内の extensions/)
pub fn default_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_data_dir(app)?.join("extensions"))
}

fn resolve_root(app: &tauri::AppHandle, path: Option<String>) -> Result<PathBuf, String> {
    match path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        Some(p) => {
            let path = PathBuf::from(p);
            if !path.is_absolute() {
                return Err("拡張フォルダは、絶対パスで指定してください".into());
            }
            Ok(path)
        }
        None => {
            let dir = default_dir(app)?;
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            Ok(dir)
        }
    }
}

/// フォルダ名が、拡張の ID として使える形か(小文字英数字とハイフン)
fn is_pack_dir_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// パックのフォルダ内の JSON を集める。シンボリックリンクはたどらず、隠しファイルは読まない
fn collect(
    dir: &Path,
    prefix: &str,
    depth: usize,
    files: &mut BTreeMap<String, String>,
    total: &mut u64,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // symlink_metadata はリンク自体を調べる(たどらない)
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                collect(&entry.path(), &rel, depth + 1, files, total)?;
            }
            continue;
        }
        if !meta.is_file() || !name.to_ascii_lowercase().ends_with(".json") {
            continue;
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!("{rel} が大きすぎます(256KB まで)"));
        }
        *total += meta.len();
        if *total > MAX_PACK_BYTES || files.len() >= MAX_FILES {
            return Err("ファイルが多すぎる、または大きすぎます".into());
        }
        let text = fs::read_to_string(entry.path())
            .map_err(|_| format!("{rel} を UTF-8 の文字列として読めません"))?;
        files.insert(rel, text);
    }
    Ok(())
}

/// `root` の直下のフォルダを、パックとして読む
pub fn scan(root: &Path) -> Result<ScanResult, String> {
    let root_meta = fs::metadata(root).map_err(|_| "拡張フォルダを開けません".to_string())?;
    if !root_meta.is_dir() {
        return Err("拡張フォルダがフォルダではありません".into());
    }
    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('_') {
            continue;
        }
        let meta = match fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        // シンボリックリンクのフォルダは、拡張フォルダの外を指しうるので読まない
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        dirs.push((name, entry.path()));
    }
    dirs.sort_by(|a, b| a.0.cmp(&b.0));
    dirs.truncate(MAX_PACKS);

    let mut packs = Vec::new();
    for (name, path) in dirs {
        if !path.join("manifest.json").is_file() {
            continue;
        }
        if !is_pack_dir_name(&name) {
            packs.push(PackEntry {
                dir: name,
                files: BTreeMap::new(),
                error: Some("フォルダ名は、小文字英数字とハイフンにしてください".into()),
            });
            continue;
        }
        let mut files = BTreeMap::new();
        let mut total = 0u64;
        match collect(&path, "", 1, &mut files, &mut total) {
            Ok(()) => packs.push(PackEntry {
                dir: name,
                files,
                error: None,
            }),
            Err(error) => packs.push(PackEntry {
                dir: name,
                files: BTreeMap::new(),
                error: Some(error),
            }),
        }
    }
    Ok(ScanResult {
        root: root.to_string_lossy().into_owned(),
        packs,
    })
}

#[tauri::command]
pub async fn extension_folder_scan(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<ScanResult, String> {
    let root = resolve_root(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || scan(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn extension_folder_open(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let dir = resolve_root(&app, path)?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("storift-ext-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_json_inside_pack_folders_only() {
        let root = temp("basic");
        fs::create_dir_all(root.join("my-pack/contents")).unwrap();
        fs::write(root.join("my-pack/manifest.json"), "{}").unwrap();
        fs::write(root.join("my-pack/contents/a.json"), "[]").unwrap();
        fs::write(root.join("my-pack/readme.md"), "x").unwrap();
        fs::write(root.join("my-pack/.hidden.json"), "x").unwrap();
        // manifest.json の無いフォルダ・隠しフォルダ・ひな形は読まない
        fs::create_dir_all(root.join("other")).unwrap();
        fs::write(root.join("other/a.json"), "{}").unwrap();
        fs::create_dir_all(root.join("_template")).unwrap();
        fs::write(root.join("_template/manifest.json"), "{}").unwrap();

        let result = scan(&root).unwrap();
        assert_eq!(result.packs.len(), 1);
        let pack = &result.packs[0];
        assert_eq!(pack.dir, "my-pack");
        assert!(pack.error.is_none());
        let keys: Vec<_> = pack.files.keys().cloned().collect();
        assert_eq!(keys, vec!["contents/a.json", "manifest.json"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;
        let outside = temp("outside");
        fs::write(outside.join("secret.json"), "secret").unwrap();
        let root = temp("links");
        fs::create_dir_all(root.join("my-pack")).unwrap();
        fs::write(root.join("my-pack/manifest.json"), "{}").unwrap();
        // ファイルへのリンク・フォルダへのリンク(パックの中)
        symlink(outside.join("secret.json"), root.join("my-pack/link.json")).unwrap();
        symlink(&outside, root.join("my-pack/dir-link")).unwrap();
        // フォルダ自体がリンクのパック
        symlink(&outside, root.join("linked-pack")).unwrap();

        let result = scan(&root).unwrap();
        assert_eq!(result.packs.len(), 1);
        let keys: Vec<_> = result.packs[0].files.keys().cloned().collect();
        assert_eq!(keys, vec!["manifest.json"]);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn rejects_bad_folder_names_and_big_files() {
        let root = temp("limits");
        fs::create_dir_all(root.join("Bad_Name")).unwrap();
        fs::write(root.join("Bad_Name/manifest.json"), "{}").unwrap();
        fs::create_dir_all(root.join("big-pack")).unwrap();
        fs::write(root.join("big-pack/manifest.json"), "{}").unwrap();
        fs::write(
            root.join("big-pack/big.json"),
            vec![b'a'; (MAX_FILE_BYTES + 1) as usize],
        )
        .unwrap();

        let result = scan(&root).unwrap();
        assert_eq!(result.packs.len(), 2);
        assert!(result.packs.iter().all(|p| p.error.is_some()));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn pack_dir_names() {
        assert!(is_pack_dir_name("my-pack-2"));
        assert!(!is_pack_dir_name("My-Pack"));
        assert!(!is_pack_dir_name("../x"));
        assert!(!is_pack_dir_name("-a"));
        assert!(!is_pack_dir_name(""));
    }
}

use anyhow::Context;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub content: String,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "__pycache__",
    "venv",
    ".venv",
    "static",
    "blog",
    ".docusaurus",
];

pub fn scan_repository(root: &Path, extensions: &[&str]) -> anyhow::Result<Vec<ScannedFile>> {
    let root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve path: {}", root.display()))?;

    let mut files = Vec::new();
    scan_dir(&root, &root, extensions, &mut files)?;
    Ok(files)
}

pub fn scan_specific_files(
    root: &Path,
    paths: &[PathBuf],
    extensions: &[&str],
) -> anyhow::Result<Vec<ScannedFile>> {
    let root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve path: {}", root.display()))?;

    let mut results = Vec::new();
    for relative in paths {
        let ext = relative
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !extensions.contains(&ext) {
            continue;
        }

        let absolute = root.join(relative);
        let content = fs::read_to_string(&absolute)
            .with_context(|| format!("failed to read file: {}", absolute.display()))?;

        results.push(ScannedFile {
            relative_path: relative.to_string_lossy().to_string(),
            absolute_path: absolute,
            content,
        });
    }
    Ok(results)
}

fn scan_dir(
    base: &Path,
    current: &Path,
    extensions: &[&str],
    files: &mut Vec<ScannedFile>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(current).context("failed to read directory")? {
        let entry = entry?;
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if path.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.contains(&name) {
                continue;
            }
            scan_dir(base, &path, extensions, files)?;
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if extensions.contains(&ext) {
                    let content = fs::read_to_string(&path)
                        .with_context(|| format!("failed to read: {}", path.display()))?;
                    let relative = path
                        .strip_prefix(base)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();

                    files.push(ScannedFile {
                        relative_path: relative,
                        absolute_path: path,
                        content,
                    });
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn setup_fixture() -> TempDir {
        let dir = TempDir::new().unwrap();
        let docs = dir.path().join("docs");
        fs::create_dir_all(&docs).unwrap();

        let mut f = fs::File::create(docs.join("intro.md")).unwrap();
        f.write_all(b"# Introduction\n\nHello world.\n").unwrap();

        let mut f = fs::File::create(docs.join("api.md")).unwrap();
        f.write_all(b"## API\n\nEndpoints.\n").unwrap();

        let mut f = fs::File::create(docs.join("config.json")).unwrap();
        f.write_all(b"{}").unwrap();

        let deep = docs.join("architecture");
        fs::create_dir(&deep).unwrap();
        let mut f = fs::File::create(deep.join("overview.md")).unwrap();
        f.write_all(b"# Overview\n\nDeep content.\n").unwrap();

        dir
    }

    #[test]
    fn test_scan_repository_finds_md_files_only() {
        let dir = setup_fixture();
        let files = scan_repository(dir.path(), &["md"]).unwrap();

        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"docs/intro.md"));
        assert!(paths.contains(&"docs/api.md"));
        assert!(paths.contains(&"docs/architecture/overview.md"));
        assert!(!paths.contains(&"docs/config.json"));
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_scan_repository_paths_are_relative() {
        let dir = setup_fixture();
        let files = scan_repository(dir.path(), &["md"]).unwrap();

        for file in &files {
            assert!(
                !file.relative_path.starts_with('/'),
                "relative_path should not be absolute: {}",
                file.relative_path
            );
            assert!(
                file.absolute_path.starts_with(dir.path()),
                "absolute_path should be within root"
            );
        }
    }

    #[test]
    fn test_scan_specific_files_subset() {
        let dir = setup_fixture();
        let files = scan_specific_files(
            dir.path(),
            &[PathBuf::from("docs/intro.md"), PathBuf::from("docs/api.md")],
            &["md"],
        )
        .unwrap();

        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_scan_specific_files_skips_wrong_extension() {
        let dir = setup_fixture();
        let files = scan_specific_files(
            dir.path(),
            &[PathBuf::from("docs/config.json")],
            &["md"],
        )
        .unwrap();

        assert!(files.is_empty());
    }

    #[test]
    fn test_scan_nonexistent_root_is_error() {
        let result = scan_repository(Path::new("/nonexistent/path"), &["md"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_scan_skips_hidden_dirs() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".hidden");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("secret.md"), "# Secret\n").unwrap();

        let mut f = fs::File::create(dir.path().join("visible.md")).unwrap();
        f.write_all(b"# Visible\n").unwrap();

        let files = scan_repository(dir.path(), &["md"]).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].relative_path.contains("visible"));
    }

    #[test]
    fn test_scan_skips_known_skip_dirs() {
        let dir = TempDir::new().unwrap();
        let node = dir.path().join("node_modules");
        fs::create_dir(&node).unwrap();
        fs::write(node.join("lib.md"), "# Lib\n").unwrap();

        let mut f = fs::File::create(dir.path().join("readme.md")).unwrap();
        f.write_all(b"# Readme\n").unwrap();

        let files = scan_repository(dir.path(), &["md"]).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].relative_path.contains("readme"));
    }
}
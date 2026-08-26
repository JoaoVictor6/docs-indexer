use std::path::Path;
use std::process::Command;

pub fn resolve_git_remote_url(repo_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8(output.stdout).ok()?;
    let url = url.trim().to_string();

    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

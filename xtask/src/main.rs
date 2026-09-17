// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::env;
use std::fs;
use std::path::Path;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let task = env::args().nth(1).unwrap_or_default();
    let result = match task.as_str() {
        "build" => build(),
        "test" => test(),
        "package" => {
            let target = env::args().nth(2).unwrap_or_default();
            package(&target)
        }
        other => {
            eprintln!("unknown xtask '{other}'. Available: build, test, package <chromium|safari>");
            return ExitCode::FAILURE;
        }
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("xtask failed to run: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cmd: &str, args: &[&str]) -> std::io::Result<bool> {
    println!("+ {cmd} {}", args.join(" "));
    let status = Command::new(cmd).args(args).status()?;
    Ok(status.success())
}

fn run_in(dir: &str, cmd: &str, args: &[&str]) -> std::io::Result<bool> {
    println!("+ (cd {dir} && {cmd} {})", args.join(" "));
    let status = Command::new(cmd).args(args).current_dir(dir).status()?;
    Ok(status.success())
}

fn build() -> std::io::Result<bool> {
    let ok_workspace = run("cargo", &["build", "--workspace"])?;
    let ok_wasm = run(
        "cargo",
        &[
            "build",
            "-p",
            "screenshot-wasm",
            "--target",
            "wasm32-unknown-unknown",
        ],
    )?;
    let ok_wasm_pack = match run_in(
        "crates/screenshot-wasm",
        "wasm-pack",
        &[
            "build",
            "--target",
            "web",
            "--out-dir",
            "../../extension/wasm",
            "--release",
        ],
    ) {
        Ok(success) => success,
        Err(e) => {
            eprintln!(
                "wasm-pack not runnable ({e}); install it with `cargo install wasm-pack` \
                 to build the extension's WASM package"
            );
            false
        }
    };
    let ok_chromium = run("browser/chromium/build.sh", &[])?;
    Ok(ok_workspace && ok_wasm && ok_wasm_pack && ok_chromium)
}

fn test() -> std::io::Result<bool> {
    let ok_fmt = run("cargo", &["fmt", "--check"])?;
    let ok_clippy = run(
        "cargo",
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
        ],
    )?;
    let ok_tests = run("cargo", &["test", "--workspace"])?;
    let ok_ts_typecheck = run_in("extension", "npm", &["run", "typecheck"])?;
    let ok_ts_tests = run_in("extension", "npm", &["test"])?;
    let ok_versions = check_versions_match();
    let ok_audit = run_optional_security_tool(
        "cargo",
        &["audit"],
        "cargo-audit",
        "cargo install cargo-audit",
    );
    let ok_deny = run_optional_security_tool(
        "cargo",
        &["deny", "check"],
        "cargo-deny",
        "cargo install cargo-deny",
    );
    Ok(ok_fmt
        && ok_clippy
        && ok_tests
        && ok_ts_typecheck
        && ok_ts_tests
        && ok_versions
        && ok_audit
        && ok_deny)
}

/// Runs a security-scanning subcommand that may not be installed. Unlike
/// the rest of the gate, a *missing* tool only warns (so `cargo xtask
/// test` still works for a fresh clone without extra installs) — but a
/// tool that IS installed and finds a real problem still fails the gate.
fn run_optional_security_tool(
    cmd: &str,
    args: &[&str],
    tool_name: &str,
    install_hint: &str,
) -> bool {
    match run(cmd, args) {
        Ok(success) => success,
        Err(_) => {
            eprintln!(
                "warning: `{tool_name}` not installed — skipping. Install with `{install_hint}`."
            );
            true
        }
    }
}

fn package(target: &str) -> std::io::Result<bool> {
    match target {
        "chromium" => package_chromium(),
        "safari" => run("browser/safari/convert.sh", &[]),
        other => {
            eprintln!("unknown package target '{other}'. Available: chromium, safari");
            Ok(false)
        }
    }
}

/// Reads `version = "..."` from the workspace `[workspace.package]`
/// table in the top-level Cargo.toml — the single source of truth every
/// other version string (extension manifest, extension package.json)
/// must match, per the project's "no version drift" requirement.
fn workspace_version() -> std::io::Result<String> {
    let content = fs::read_to_string("Cargo.toml")?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("version = \"") {
            if let Some(version) = rest.strip_suffix('"') {
                return Ok(version.to_string());
            }
        }
    }
    Err(std::io::Error::other(
        "could not find version = \"...\" in Cargo.toml",
    ))
}

fn check_versions_match() -> bool {
    let workspace = match workspace_version() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("version check failed: {e}");
            return false;
        }
    };

    let mut ok = true;
    for (path, needle_prefix) in [
        ("extension/manifest.base.json", "\"version\": \""),
        ("extension/package.json", "\"version\": \""),
    ] {
        match fs::read_to_string(path) {
            Ok(content) => {
                let found = content.lines().find_map(|line| {
                    let trimmed = line.trim();
                    trimmed
                        .strip_prefix(needle_prefix)
                        .and_then(|rest| rest.split('"').next())
                });
                match found {
                    Some(v) if v == workspace => {
                        println!("version OK: {path} = {v}");
                    }
                    Some(v) => {
                        eprintln!("version MISMATCH: {path} has \"{v}\", workspace Cargo.toml has \"{workspace}\"");
                        ok = false;
                    }
                    None => {
                        eprintln!("version check failed: no \"version\" field found in {path}");
                        ok = false;
                    }
                }
            }
            Err(e) => {
                eprintln!("version check failed: could not read {path}: {e}");
                ok = false;
            }
        }
    }
    ok
}

fn package_chromium() -> std::io::Result<bool> {
    if !Path::new("dist/chromium").exists() {
        eprintln!("dist/chromium not found — run 'cargo xtask build' first.");
        return Ok(false);
    }
    let version = workspace_version()?;
    fs::create_dir_all("artifacts")?;
    let zip_name = format!("fullscreen-shot-chromium-{version}.zip");
    let zip_path = format!("artifacts/{zip_name}");
    let _ = fs::remove_file(&zip_path);
    let ok = run_in(
        "dist/chromium",
        "zip",
        &["-r", &format!("../../{zip_path}"), "."],
    )?;
    if ok {
        println!("packaged {zip_path}");
    }
    Ok(ok)
}

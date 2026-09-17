// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::env;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let task = env::args().nth(1).unwrap_or_default();
    let result = match task.as_str() {
        "build" => build(),
        "test" => test(),
        other => {
            eprintln!("unknown xtask '{other}'. Available: build, test");
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
    Ok(ok_fmt && ok_clippy && ok_tests && ok_ts_typecheck && ok_ts_tests)
}

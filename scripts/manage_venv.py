from __future__ import annotations

import argparse
import subprocess
import sys
import venv
from pathlib import Path


def venv_python(venv_dir: Path) -> Path:
    scripts_dir = "Scripts" if sys.platform.startswith("win") else "bin"
    executable = "python.exe" if sys.platform.startswith("win") else "python"
    return venv_dir / scripts_dir / executable


def ensure_venv(venv_dir: Path) -> Path:
    python_path = venv_python(venv_dir)
    if python_path.exists():
        return python_path

    print(f"Creating virtual environment at {venv_dir}", flush=True)
    builder = venv.EnvBuilder(with_pip=True, clear=False, upgrade=False)
    builder.create(venv_dir)
    return venv_python(venv_dir)


def run_command(command: list[str], cwd: Path) -> int:
    print(f"$ {' '.join(command)}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    return process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage persistent venv for bot workspace.")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--venv", required=True, type=Path)

    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("install-deps")

    install_package = subparsers.add_parser("install-package")
    install_package.add_argument("package")

    args = parser.parse_args()
    workspace = args.workspace.resolve()
    venv_dir = args.venv.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    venv_dir.mkdir(parents=True, exist_ok=True)

    python_path = ensure_venv(venv_dir)

    bootstrap_command = [str(python_path), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]
    bootstrap_exit = run_command(bootstrap_command, workspace)
    if bootstrap_exit != 0:
        return bootstrap_exit

    if args.command == "install-deps":
        requirements_path = workspace / "requirements.txt"
        if not requirements_path.exists():
            print("requirements.txt not found in workspace.", flush=True)
            return 2
        return run_command([str(python_path), "-m", "pip", "install", "-r", str(requirements_path)], workspace)

    if args.command == "install-package":
        return run_command([str(python_path), "-m", "pip", "install", args.package], workspace)

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

r"""TicketPro FastAPI 서버를 동일한 명령 형식으로 실행한다.

Linux/macOS:
    ./venv/bin/python run_server.py auth
    ./venv/bin/python run_server.py backend

Windows PowerShell:
    .\venv\Scripts\python.exe run_server.py auth
    .\venv\Scripts\python.exe run_server.py backend
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SERVER_CONFIG = {
    "auth": {
        "app": "auth_server:app",
        "host_env": "AUTH_HOST",
        "port_env": "AUTH_PORT",
        "workers_env": "AUTH_WORKERS",
        "default_port": 8001,
    },
    "backend": {
        "app": "blockchain_backend:app",
        "host_env": "BACKEND_HOST",
        "port_env": "BACKEND_PORT",
        "workers_env": "BACKEND_WORKERS",
        "default_port": 8000,
    },
}


def positive_int(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise SystemExit(f"{name}은 정수여야 합니다: {value}") from exc
    if parsed < 1:
        raise SystemExit(f"{name}은 1 이상이어야 합니다: {value}")
    return parsed


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0"}:
        raise SystemExit(f"{name}은 true 또는 false여야 합니다: {value}")
    return value in {"true", "1"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="TicketPro Auth 또는 Main Backend 서버 실행"
    )
    parser.add_argument("server", choices=SERVER_CONFIG, help="실행할 서버")
    parser.add_argument(
        "--env-file",
        help="사용할 환경설정 파일. 기본값은 이 파일과 같은 폴더의 .env",
    )
    parser.add_argument(
        "--runtime-env-file",
        help="기존 .env 위에 적용할 실행 전용 설정 파일",
    )
    parser.add_argument("--host", help=".env의 역할별 HOST 값을 덮어씀")
    parser.add_argument("--port", type=int, help=".env의 역할별 PORT 값을 덮어씀")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="개발용 자동 재시작 활성화",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="설정과 앱 모듈만 검사하고 서버는 시작하지 않음",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = SERVER_CONFIG[args.server]

    try:
        import uvicorn
        from dotenv import dotenv_values, load_dotenv
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "서버 실행 패키지가 설치되어 있지 않습니다. 서버의 venv Python으로 실행하거나 "
            "requirements.txt를 설치하세요."
        ) from exc

    env_path = Path(args.env_file).expanduser() if args.env_file else BASE_DIR / ".env"
    if not env_path.is_absolute():
        env_path = (Path.cwd() / env_path).resolve()
    if not env_path.is_file():
        example = BASE_DIR / f".env.{args.server}.example"
        raise SystemExit(
            f"환경설정 파일을 찾을 수 없습니다: {env_path}\n"
            f"먼저 {example.name}을 .env로 복사하고 실제 값을 입력하세요."
        )

    # 우선순위: 터미널/systemd > 역할별 runtime 파일 > 기존 .env
    external_keys = set(os.environ)
    load_dotenv(env_path, override=False)
    runtime_path = (
        Path(args.runtime_env_file).expanduser()
        if args.runtime_env_file
        else BASE_DIR / f".env.{args.server}.runtime"
    )
    if not runtime_path.is_absolute():
        runtime_path = (Path.cwd() / runtime_path).resolve()
    if args.runtime_env_file and not runtime_path.is_file():
        raise SystemExit(f"실행 전용 환경설정 파일을 찾을 수 없습니다: {runtime_path}")
    if runtime_path.is_file():
        for key, value in dotenv_values(runtime_path).items():
            if key not in external_keys and value is not None:
                os.environ[key] = value

    host = args.host or os.getenv(config["host_env"], "0.0.0.0")
    port = args.port or positive_int(
        os.getenv(config["port_env"], str(config["default_port"])),
        config["port_env"],
    )
    workers = positive_int(os.getenv(config["workers_env"], "1"), config["workers_env"])
    reload_enabled = args.reload or env_bool(f"{args.server.upper()}_RELOAD")
    if reload_enabled and workers != 1:
        raise SystemExit("자동 재시작을 사용할 때 workers는 1이어야 합니다.")

    # 어느 위치에서 실행해도 auth_server.py와 blockchain_backend.py를 찾는다.
    if str(BASE_DIR) not in sys.path:
        sys.path.insert(0, str(BASE_DIR))

    print(f"설정 파일: {env_path}")
    if runtime_path.is_file():
        print(f"실행 전용 설정: {runtime_path}")
    print(f"실행 서버: {args.server} ({host}:{port})")
    if args.check:
        importlib.import_module(config["app"].split(":", 1)[0])
        print("설정 및 앱 모듈 검사: 정상")
        return
    uvicorn.run(
        config["app"],
        host=host,
        port=port,
        workers=workers,
        reload=reload_enabled,
    )


if __name__ == "__main__":
    main()

"""Prepare writable runtime configuration before starting the container command."""

import json
import os
import shutil
import sys
from pathlib import Path


def prepare_runtime_config() -> None:
    config_dir = Path("/app/config")
    config_dir.mkdir(parents=True, exist_ok=True)

    config_file = config_dir / "config.yaml"
    template_file = config_dir / "config.yaml.template"
    if not config_file.exists() and template_file.exists():
        shutil.copyfile(template_file, config_file)

    if token := os.getenv("TUSHARE_TOKEN"):
        tushare_file = config_dir / "tushare_config.json"
        tushare_file.write_text(
            json.dumps({"token": token}, ensure_ascii=False),
            encoding="utf-8",
        )
        tushare_file.chmod(0o600)


if __name__ == "__main__":
    prepare_runtime_config()
    os.execvp(sys.argv[1], sys.argv[1:])

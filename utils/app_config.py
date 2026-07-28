"""Application configuration loading with environment-based secret overrides."""

import os
from pathlib import Path
from typing import Any, Dict

import yaml


def load_app_config(config_file: str = "config/config.yaml") -> Dict[str, Any]:
    """Load YAML configuration and overlay secrets supplied by the environment."""
    config_path = Path(config_file)
    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as file:
            config = yaml.safe_load(file) or {}
    else:
        config = {}

    dingtalk = config.setdefault("dingtalk", {})
    if webhook := os.getenv("DINGTALK_WEBHOOK"):
        dingtalk["webhook_url"] = webhook
    if secret := os.getenv("DINGTALK_SECRET"):
        dingtalk["secret"] = secret

    if data_dir := os.getenv("KHUNTER_DATA_DIR"):
        config["data_dir"] = data_dir

    return config

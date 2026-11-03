from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    baseten_api_key: str = ""
    baseten_base_url: str = "https://inference.baseten.co/v1"
    muse_text_model: str = "meta-models/muse-spark-open"
    muse_vision_model: str = "meta-models/muse-spark-open-1026"
    modal_proxy_token_id: str = ""
    modal_proxy_token_secret: str = ""
    modal_base_url: str = "https://raviraj20022019--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct/v1"
    storage_root: Path = Path("./storage")
    max_upload_mb: int = 25
    max_pdf_pages: int = 30
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    allow_draft_export: bool = True
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


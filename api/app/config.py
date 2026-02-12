"""Application configuration."""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # Environment
    env: str = "dev"
    
    # Dev bypass (NEVER enable in production)
    dev_auth_bypass: bool = False
    
    # Azure AD
    azure_tenant_allowlist: str = ""
    api_app_client_id: str = ""
    api_app_id_uri: str = ""
    
    # Database
    database_url: str = "sqlite:///./dev.db"
    
    # Notifications
    notify_mode: str = "stub"

    # CORS (dev): comma-separated extra origins, e.g. "http://192.168.1.10:5173"
    additional_cors_origins: str = ""

    # Azure Application Insights
    appinsights_connection_string: str = ""
    
    @property
    def is_dev(self) -> bool:
        return self.env == "dev"
    
    @property
    def additional_cors_origins_list(self) -> list[str]:
        if not self.additional_cors_origins:
            return []
        return [o.strip() for o in self.additional_cors_origins.split(",") if o.strip()]

    @property
    def tenant_allowlist(self) -> list[str]:
        if not self.azure_tenant_allowlist:
            return []
        return [t.strip() for t in self.azure_tenant_allowlist.split(",") if t.strip()]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8-sig"


@lru_cache()
def get_settings() -> Settings:
    return Settings()

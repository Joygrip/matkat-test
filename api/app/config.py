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
    azure_tenant_id: str = ""       # Entra tenant GUID (required in non-dev mode)
    azure_tenant_allowlist: str = ""
    api_app_client_id: str = ""
    api_app_id_uri: str = ""

    # Microsoft Graph (OBO flow for login-time profile sync)
    graph_client_id: str = ""           # App client id (often same as api_app_client_id)
    graph_client_secret: str = ""       # Client secret for OBO token exchange
    graph_sync_interval_seconds: int = 3600  # Skip sync if synced within this window

    # Background sync behaviour (client credentials / app-only flow)
    # Requires User.Read.All *application* permission with admin consent in Entra.
    # When False (default): users missing from Graph (404) are logged but not deactivated.
    # When True: users missing from Graph are also marked is_active=False in the DB.
    graph_sync_deactivate_missing: bool = False
    
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

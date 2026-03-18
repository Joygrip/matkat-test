"""Database engine and session management."""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from api.app.config import get_settings


def get_engine():
    """Create database engine based on settings."""
    settings = get_settings()
    url = settings.database_url

    # SQLite needs special handling
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            echo=settings.is_dev,
        )

    # SQL Server / Azure SQL
    return create_engine(url, echo=settings.is_dev)


def run_dev_migrations(engine) -> None:
    """Run alembic upgrade head for SQLite (local dev) databases only.

    Non-SQLite (Azure SQL, Postgres, …): intentionally a no-op.
    Migrations against a shared database must NOT run automatically at every
    app start-up — they are a controlled release step.  Run before deploying:

        DATABASE_URL="mssql+pyodbc://…" alembic upgrade head

    - No-op during pytest runs (PYTEST_CURRENT_TEST guard).
    - Raises RuntimeError with clear instructions if migration fails
      (e.g. untracked schema created via create_all without Alembic).
    """
    import os
    if engine.dialect.name != "sqlite":
        return
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return

    from pathlib import Path
    from alembic.config import Config
    from alembic import command

    # Resolve api/ root from this file: api/app/db/engine.py -> up 3 levels
    api_root = Path(__file__).resolve().parent.parent.parent

    alembic_cfg = Config()  # no ini file — avoids reconfiguring root logger
    alembic_cfg.set_main_option("script_location", str(api_root / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", str(engine.url))

    def _upgrade(cfg: "Config") -> None:
        command.upgrade(cfg, "head")

    try:
        _upgrade(alembic_cfg)
        print("[DEV] SQLite schema is up to date (alembic upgrade head OK)")
    except Exception as first_exc:
        # Migration failed — likely an untracked schema created via create_all
        # without Alembic (no alembic_version table).  Safe in dev: delete the
        # stale file and let Alembic rebuild from scratch.
        db_path = os.path.abspath(str(engine.url).replace("sqlite:///", ""))
        print(
            f"[DEV] Schema migration failed ({first_exc}); "
            f"stale or untracked dev.db detected.\n"
            f"      Deleting {db_path} and rebuilding schema from scratch..."
        )
        engine.dispose()  # release all pooled connections before deleting
        if os.path.exists(db_path):
            os.remove(db_path)
        try:
            _upgrade(alembic_cfg)
            print("[DEV] SQLite schema rebuilt successfully (alembic upgrade head OK)")
        except Exception as second_exc:
            raise RuntimeError(
                f"Dev database could not be created even on a fresh file. "
                f"Original error: {second_exc}"
            ) from second_exc


engine = get_engine()
# ensure_resources_initials_column removed — superseded by Alembic migration 12
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

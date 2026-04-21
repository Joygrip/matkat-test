"""Database engine and session management."""
import threading
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

    # SQL Server / Azure SQL — explicit pool config for multi-user production.
    # pool_pre_ping: validates connections before use; Azure SQL silently drops
    #   idle connections after ~30 min, so without this callers get broken pipes.
    # pool_recycle: recycles connections every hour to avoid stale TDS sessions.
    # pool_size/max_overflow: supports up to 30 concurrent DB operations before
    #   queuing; tune based on Azure SQL tier and worker count.
    return create_engine(
        url,
        echo=settings.is_dev,
        pool_size=20,
        max_overflow=10,
        pool_timeout=30,
        pool_pre_ping=True,
        pool_recycle=3600,
    )


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


_engine = None
_engine_lock = threading.Lock()


def _get_or_create_engine():
    # Double-checked locking: avoids creating two engine instances (and two
    # separate connection pools) when multiple workers start simultaneously.
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = get_engine()
    return _engine


SessionLocal = sessionmaker(autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    engine = _get_or_create_engine()
    SessionLocal.configure(bind=engine)
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Roll back any uncommitted work so the connection returns to the pool
        # clean. Without this, a failed db.commit() anywhere in a route handler
        # leaves an open transaction on Azure SQL until the connection is recycled.
        db.rollback()
        raise
    finally:
        db.close()

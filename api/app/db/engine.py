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


def ensure_resources_initials_column(engine):
    """Add resources.initials column if missing (SQLite only). Idempotent."""
    if not engine.dialect.name == "sqlite":
        return
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(resources)"))
        columns = [row[1] for row in result.fetchall()]
        if "initials" in columns:
            return
        conn.execute(text("ALTER TABLE resources ADD COLUMN initials VARCHAR(20)"))
        conn.commit()


engine = get_engine()
ensure_resources_initials_column(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

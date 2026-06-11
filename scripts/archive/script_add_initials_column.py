"""
One-off script to add resources.initials column if missing.
Run from repo root: python api/script_add_initials_column.py
Or: python api/script_add_initials_column.py path/to/db.db
If no path given, uses DATABASE_URL from env/settings, then tries api/dev.db and dev.db.
"""
import os
import sys

_script_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.dirname(_script_dir)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from sqlalchemy import create_engine, text


def add_initials_column_to_db(db_path: str, log) -> bool:
    """Add resources.initials to the database at db_path. Return True if changed."""
    if not os.path.isfile(db_path):
        return False
    url = f"sqlite:///{db_path.replace(os.sep, '/')}"
    engine = create_engine(url, connect_args={"check_same_thread": False})
    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(resources)"))
        cols = [row[1] for row in r.fetchall()]
        if "initials" in cols:
            log(f"  {db_path}: column already exists")
            return False
        conn.execute(text("ALTER TABLE resources ADD COLUMN initials VARCHAR(20)"))
        conn.commit()
    log(f"  {db_path}: added column resources.initials")
    return True


def main():
    def log(msg: str) -> None:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()

    if len(sys.argv) >= 2:
        path = os.path.abspath(sys.argv[1])
        if not os.path.isfile(path):
            log(f"File not found: {path}")
            log("Use the full path to your database, e.g.:")
            log('  python api/script_add_initials_column.py "C:\\path\\to\\api\\dev.db"')
            return 1
        add_initials_column_to_db(path, log)
        return 0

    # No path: try DATABASE_URL then common locations
    tried = []
    from api.app.config import get_settings
    settings = get_settings()
    url = settings.database_url
    if url.startswith("sqlite:///"):
        raw = url.replace("sqlite:///", "").lstrip("/")
        if not os.path.isabs(raw):
            raw = os.path.join(os.getcwd(), raw)
        tried.append(os.path.normpath(raw))

    tried.append(os.path.join(_repo_root, "api", "dev.db"))
    tried.append(os.path.join(_repo_root, "dev.db"))
    tried.append(os.path.join(_repo_root, "test.db"))

    seen = set()
    changed = 0
    for path in tried:
        path = os.path.normpath(path)
        if path in seen:
            continue
        seen.add(path)
        if add_initials_column_to_db(path, log):
            changed += 1

    if not seen:
        log("No database path to try.")
        return 1
    if changed == 0:
        log("All checked databases already had resources.initials. Nothing to do.")
    else:
        log(f"Done. Updated {changed} database(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Manual script to seed example data for development.
Run with: .\venv\Scripts\python.exe api/app/seed_example_data.py
"""
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from api.app.example_data import create_example_data
from api.app.db.engine import get_engine

if __name__ == "__main__":
    # Use the same DATABASE_URL as your app
    import os
    db_url = os.environ.get("DATABASE_URL", "sqlite:///./api/dev.db")
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        create_example_data(session)
        print("✓ Example data seeded successfully.")
    finally:
        session.close()

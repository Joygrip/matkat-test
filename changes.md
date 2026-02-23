# Changes.md

## Date: 2026-02-16

### Summary
Resolved persistent database schema errors and enabled reliable local setup and seeding of example data for development/testing.

### Steps Taken

1. **Deleted the old SQLite database file**
   - Removed `api/dev.db` to clear out any mismatched or corrupted schema from previous runs.

2. **Set environment variables before running Alembic and backend**
   - Ensured `PYTHONPATH` was set to the `api` directory.
   - Set `DATABASE_URL` to the absolute path of the SQLite database (e.g., `sqlite:///absolute/path/to/api/dev.db`).
   - This ensured both Alembic and the backend used the same database file.

3. **Ran Alembic migrations to recreate the schema**
   - Used Alembic to apply all migrations and create the correct tables in the database.

4. **Seeded the database with example data**
   - Used the manual script `api/app/seed_example_data.py` to insert example data for development/testing.

### Notes
- The main issue was a mismatch in the database file paths between Alembic and the backend, caused by relative path confusion. Setting `PYTHONPATH` and using an absolute `DATABASE_URL` resolved this.
- Always ensure both Alembic and the backend are using the same database file for consistent results.
- The manual seeding script can be rerun as needed for fresh example data.

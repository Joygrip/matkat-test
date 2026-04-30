"""
Split the existing "Quality Control" cost center into QC DK and QC PL.

Usage:
    DATABASE_URL=<connection_string> python -m api.app.scripts.split_quality_control

Steps:
    1. Rename existing QC cost center to "Quality Control PL" (QC-PL, Poland)
    2. Create new "Quality Control DK" cost center (QC-DK, Denmark)
    3. Move DK users to QC DK
    4. Move DK resources to QC DK
    5. PL users are already in QC-PL — no change needed

Idempotent: skips QC DK creation if it already exists.
"""
import os
import uuid
import sys
from datetime import datetime
from sqlalchemy import create_engine, text

EXISTING_QC_ID = "b9394a8b-12ee-4b1c-97f2-b6bf7e750c1c"

RO_USER_ID = "5681eb44-a64c-472e-8c61-e0989f334218"       # Hanne Krogh
DIRECTOR_USER_ID = "64e71875-0615-40dc-9f55-7cfe5b093482"  # Christina Wulff
TENANT_ID = "3c356d1d-7740-4a57-921a-948c6a97c210"

DK_USER_IDS = [
    "8c3471e5",  # Anne Mette Jakobsen (partial — script uses LIKE match)
    "615446f2",  # Flemming Hansen
    "5681eb44",  # Hanne Krogh
    "c84db2e0",  # Heike Schlüter
    "4e9fad20",  # Jette Vibeke Sandsted
    "b75c0b20",  # Lise Moesby
    "5a9034ec",  # Liselotte Siim
    "d30b3231",  # Lone Josefsen
    "b09297e8",  # Nanna Teofelius
    "aeb2a5ad",  # Niels Ulrik Brandt Hansen
    "e99c377a",  # Nina Ohlhues
    "f48b6408",  # Søs Inger Dichmann
    "b93b2967",  # Tina Lercke Skytte
    "64e71875",  # Christina Wulff (Director, belongs to DK)
]


def get_full_user_ids(conn, partial_ids: list[str]) -> list[str]:
    """Resolve partial UUIDs to full UUIDs by prefix match."""
    full_ids = []
    for partial in partial_ids:
        row = conn.execute(
            text("SELECT id FROM users WHERE id LIKE :prefix"),
            {"prefix": f"{partial}%"},
        ).fetchone()
        if row:
            full_ids.append(row[0])
        else:
            print(f"  WARNING: could not resolve user partial ID '{partial}'")
    return full_ids


def run():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set.")
        sys.exit(1)

    engine = create_engine(database_url)

    with engine.begin() as conn:
        # ── STEP 1: Rename existing QC to QC PL ─────────────────────────────
        print("Step 1: Renaming existing Quality Control → Quality Control PL …")
        result = conn.execute(
            text("""
                UPDATE cost_centers
                SET code = 'QC-PL',
                    name = 'Quality Control PL',
                    graph_department_name = 'Quality Control PL',
                    location = 'Poland'
                WHERE id = :id
            """),
            {"id": EXISTING_QC_ID},
        )
        print(f"  Updated {result.rowcount} row(s).")

        # ── STEP 2: Create QC DK (idempotent) ───────────────────────────────
        print("Step 2: Creating Quality Control DK …")
        existing_dk = conn.execute(
            text("SELECT id FROM cost_centers WHERE code = 'QC-DK' AND tenant_id = :tid"),
            {"tid": TENANT_ID},
        ).fetchone()

        if existing_dk:
            qc_dk_id = existing_dk[0]
            print(f"  QC DK already exists (id={qc_dk_id}), skipping creation.")
        else:
            qc_dk_id = str(uuid.uuid4())
            now = datetime.utcnow()
            conn.execute(
                text("""
                    INSERT INTO cost_centers
                        (id, tenant_id, code, name, graph_department_name,
                         location, ro_user_id, director_user_id,
                         is_active, created_at, updated_at)
                    VALUES
                        (:id, :tenant_id, 'QC-DK', 'Quality Control DK', 'Quality Control DK',
                         'Denmark', :ro_user_id, :director_user_id,
                         1, :created_at, :updated_at)
                """),
                {
                    "id": qc_dk_id,
                    "tenant_id": TENANT_ID,
                    "ro_user_id": RO_USER_ID,
                    "director_user_id": DIRECTOR_USER_ID,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            print(f"  Created QC DK (id={qc_dk_id}).")

        # ── STEP 3: Move DK users to QC DK ──────────────────────────────────
        print("Step 3: Moving DK users to Quality Control DK …")
        dk_user_ids = get_full_user_ids(conn, DK_USER_IDS)
        if dk_user_ids:
            placeholders = ", ".join(f":uid{i}" for i in range(len(dk_user_ids)))
            params = {"qc_dk_id": qc_dk_id}
            params.update({f"uid{i}": uid for i, uid in enumerate(dk_user_ids)})
            result = conn.execute(
                text(f"UPDATE users SET cost_center_id = :qc_dk_id WHERE id IN ({placeholders})"),
                params,
            )
            print(f"  Updated {result.rowcount} user(s).")
        else:
            print("  No DK users resolved — skipping.")

        # ── STEP 4: Move DK resources to QC DK ──────────────────────────────
        print("Step 4: Moving DK resources to Quality Control DK …")
        if dk_user_ids:
            placeholders = ", ".join(f":uid{i}" for i in range(len(dk_user_ids)))
            params = {"qc_dk_id": qc_dk_id}
            params.update({f"uid{i}": uid for i, uid in enumerate(dk_user_ids)})
            result = conn.execute(
                text(f"UPDATE resources SET cost_center_id = :qc_dk_id WHERE user_id IN ({placeholders})"),
                params,
            )
            print(f"  Updated {result.rowcount} resource(s).")
        else:
            print("  No DK users resolved — skipping.")

        # ── STEP 5: Confirm PL users (no action needed) ──────────────────────
        print("Step 5: PL users remain in Quality Control PL (no action needed).")
        pl_count = conn.execute(
            text("SELECT COUNT(*) FROM users WHERE cost_center_id = :qcpl_id"),
            {"qcpl_id": EXISTING_QC_ID},
        ).scalar()
        print(f"  {pl_count} user(s) remain in QC PL.")

    print("\nDone.")


if __name__ == "__main__":
    run()

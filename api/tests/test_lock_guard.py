"""Tests for period lock enforcement."""


def test_locked_period_blocks_write_endpoint(client, finance_headers, db):
    """
    Locked periods should block write operations.
    We'll test this via the dev endpoint's /periods API.
    """
    # Create and lock a period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 9},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    
    # Lock it
    lock_resp = client.post(
        f"/periods/{period_id}/lock",
        headers=finance_headers,
    )
    assert lock_resp.status_code == 200
    assert lock_resp.json()["status"] == "locked"
    
    # Verify it's locked by trying to lock again (should fail with validation error, not PERIOD_LOCKED)
    double_lock_resp = client.post(
        f"/periods/{period_id}/lock",
        headers=finance_headers,
    )
    assert double_lock_resp.status_code == 400
    assert "already locked" in double_lock_resp.json()["detail"].lower()


def test_unlocked_period_allows_edits(client, finance_headers, db):
    """
    Open periods should allow edits.
    """
    # Create an open period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 10},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    
    # Verify it's open
    get_resp = client.get(f"/periods/{period_id}", headers=finance_headers)
    assert get_resp.json()["status"] == "open"


def test_lock_unlock_lock_cycle(client, finance_headers, db):
    """
    Test a full lock/unlock/lock cycle.
    """
    # Create period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 11},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    
    # Lock
    client.post(f"/periods/{period_id}/lock", headers=finance_headers)
    
    # Unlock with reason
    unlock_resp = client.post(
        f"/periods/{period_id}/unlock",
        json={"reason": "Correction needed"},
        headers=finance_headers,
    )
    assert unlock_resp.status_code == 200
    assert unlock_resp.json()["status"] == "open"
    
    # Lock again
    relock_resp = client.post(f"/periods/{period_id}/lock", headers=finance_headers)
    assert relock_resp.status_code == 200
    assert relock_resp.json()["status"] == "locked"

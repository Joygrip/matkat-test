from api.app.db.engine import get_engine
from sqlalchemy import text

engine = get_engine()
QC_DK_ID = 'FC897710-C47E-4994-AC4E-2A88B4EB72F6'

DK_USER_IDS = [
    'e8b5ece3-0c20-4294-a742-0d6ac7cff356',
    '748ef2d1-565b-4f2a-80a0-e4e3d0b1065a',
    '5e322597-4d5e-4851-b2eb-4450bc4c6f9d',
    '370aa232-f396-44ad-8ca2-fa363b7a6034',
    '30bfc728-27f6-40d5-9ccf-393bb49009ad',
    '69217119-4e9c-4e59-8599-a928dc9d80cf',
    'b2ae4c7d-fd25-410e-b4f3-849ca7be7002',
    'f74c3130-547b-4efc-bdcc-31afd40dd822',
    '73700b3e-5bee-4b73-8f94-5fbc7e21467a',
    'ec08605f-f150-421d-b28e-8f0754651a65',
    'beda8909-90db-4275-8604-4dac4d178a9d',
]

with engine.begin() as conn:
    r = conn.execute(text("""
        UPDATE cost_centers 
        SET name = 'Quality Control PL',
            graph_department_name = 'Quality Control',
            location = 'Poland'
        WHERE name = 'Quality Control'
        AND tenant_id = (SELECT TOP 1 tenant_id FROM cost_centers)
    """))
    print('Step 1: Renamed QC to QC PL -', r.rowcount, 'row(s)')

    conn.execute(text("""
        UPDATE cost_centers
        SET name = 'Quality Control DK',
            location = 'Denmark',
            ro_user_id = (SELECT id FROM users WHERE email = 'hari@ferrosanmd.com'),
            director_user_id = (SELECT id FROM users WHERE email = 'chwu@ferrosanmd.com')
        WHERE id = 'FC897710-C47E-4994-AC4E-2A88B4EB72F6'
    """))
    print('Step 2: Updated QC DK RO and Director')

    ids_str = ','.join(["'" + i + "'" for i in DK_USER_IDS])
    r = conn.execute(text("UPDATE users SET cost_center_id = 'FC897710-C47E-4994-AC4E-2A88B4EB72F6' WHERE id IN (" + ids_str + ")"))
    print('Step 3: Moved', r.rowcount, 'DK users to QC DK')

    r = conn.execute(text("UPDATE resources SET cost_center_id = 'FC897710-C47E-4994-AC4E-2A88B4EB72F6' WHERE user_id IN (" + ids_str + ")"))
    print('Step 4: Moved', r.rowcount, 'DK resources to QC DK')

    print('Done!')

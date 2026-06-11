import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
sql = text("""
SELECT i.name, i.is_unique, c.name, ic.key_ordinal
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name = :tbl
ORDER BY i.name, ic.key_ordinal
""")
with engine.connect() as conn:
    for row in conn.execute(sql, {"tbl": "cost_centers"}):
        print(row)

-- Duplicate check (same measurement and method)
SELECT measurement_id, method, COUNT(*)::int AS n FROM anomalies WHERE measurement_id IS NOT NULL GROUP BY measurement_id, method HAVING COUNT(*) > 1

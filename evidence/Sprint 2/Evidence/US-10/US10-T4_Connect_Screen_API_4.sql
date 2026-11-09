-- Database after saving from the screen
SELECT t.id, t.min_value, t.max_value, u.email AS updated_by, t.updated_at FROM thresholds t LEFT JOIN users u ON u.id = t.updated_by WHERE t.id = 'th-a1-temperature'

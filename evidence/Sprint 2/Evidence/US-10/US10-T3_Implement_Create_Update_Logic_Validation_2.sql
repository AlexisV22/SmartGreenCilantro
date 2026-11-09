-- Stored threshold with user and date of the change
SELECT t.id, t.area_id, t.sensor_type, t.min_value, t.max_value, t.unit, u.email AS updated_by, t.updated_at
      FROM thresholds t LEFT JOIN users u ON u.id = t.updated_by WHERE t.id = $1

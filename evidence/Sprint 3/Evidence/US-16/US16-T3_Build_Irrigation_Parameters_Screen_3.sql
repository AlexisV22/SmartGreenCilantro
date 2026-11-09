-- Values saved in the database
SELECT c.area_id, c.enabled, c.target_moisture, c.max_duration_min, c.cooldown_min, c.consecutive_readings, c.min_tank_level, u.email AS updated_by, c.updated_at FROM irrigation_config c LEFT JOIN users u ON u.id = c.updated_by WHERE c.area_id = 'AREA-1'

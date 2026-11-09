-- Default cilantro thresholds stored for AREA-1
SELECT sensor_type, min_value, max_value, unit, crop_stage FROM thresholds WHERE area_id = 'AREA-1' ORDER BY sensor_type

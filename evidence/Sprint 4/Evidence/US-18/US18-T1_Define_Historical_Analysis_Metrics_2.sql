-- Parameters of the analysis
SELECT key, value, description FROM system_parameters WHERE key IN ('analysis.trend_tolerance','light.day_start_hour','light.day_end_hour','platform.timezone') ORDER BY key

-- Recommendation stored with score, type, confidence and inputs
SELECT id, type, score, confidence, confidence_text, recommended_duration_min, status, inputs, created_at FROM recommendations WHERE id = $1

-- Roles in the database and the test users assigned to them
SELECT r.name AS role, r.description, u.email AS test_user, u.is_active
      FROM roles r LEFT JOIN users u ON u.role_id = r.id ORDER BY r.name, u.email

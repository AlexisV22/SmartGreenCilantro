-- Number of permissions per role
SELECT r.name AS role, COUNT(rp.permission_id)::int AS permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.name ORDER BY r.name

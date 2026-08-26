-- Insert initial user
INSERT INTO users (google_id, name, email) 
VALUES ('100000000000000000001', 'Test Student', 'test@example.com');

-- Set default user preferences
INSERT INTO user_preferences (user_id, study_days, preferred_start, preferred_end, session_length, break_length, max_daily_minutes)
VALUES (1, 'Mon,Tue,Wed,Thu,Fri', '09:00', '17:00', 50, 10, 180);

-- Insert course
INSERT INTO courses (user_id, name) 
VALUES (1, 'Discrete Mathematics');

-- Insert material
INSERT INTO materials (course_id, filename, file_path) 
VALUES (1, 'Discrete_Math_Textbook.pdf', '/uploads/materials/Discrete_Math_Textbook.pdf');

-- Insert sections referencing material_id
INSERT INTO sections (material_id, title, start_page, end_page, estimated_minutes, difficulty) VALUES 
(1, 'Propositions', 3, 6, 40, 1),
(1, 'Logical Operators', 7, 10, 50, 2),
(1, 'Truth Tables', 11, 15, 60, 2);

-- Insert tasks
INSERT INTO tasks (section_id, priority, deadline, status) VALUES 
(1, 90, '2026-08-28', 'Not Started'),
(2, 80, '2026-08-29', 'Not Started'),
(3, 60, '2026-08-30', 'Not Started');
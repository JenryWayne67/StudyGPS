/**
 * StudyGPS Central Data Store & State Engine
 * Implements the core entity relationship:
 * USER -> USER_PREFERENCES
 * COURSES -> MATERIALS -> SECTIONS -> TASKS -> (SCHEDULES & STUDY_SESSIONS via task_id) -> PROGRESS
 */

const STORAGE_KEYS = {
  PREFERENCES: 'studygps_user_preferences',
  COURSES: 'studygps_courses',
  MATERIALS: 'studygps_materials',
  SECTIONS: 'studygps_sections',
  TASKS: 'studygps_tasks',
  SCHEDULES: 'studygps_schedules',
  WEEKLY_SCHEDULE: 'studygps_weekly_schedule',
  SESSIONS: 'studygps_study_sessions',
  USER: 'studygps_user_info'
};

const DEFAULT_COURSES = [
  { id: 1, name: 'Discrete Mathematics', code: 'CS201', color: '#3b82f6', icon: '📐' },
  { id: 2, name: 'C++ Programming', code: 'CS102', color: '#10b981', icon: '💻' },
  { id: 3, name: 'Networking & Systems', code: 'CS304', color: '#8b5cf6', icon: '🌐' }
];

const DEFAULT_PREFERENCES = {
  study_days: ['Monday', 'Tuesday', 'Friday', 'Saturday'],
  preferred_start: '18:00',
  preferred_end: '21:00',
  session_length: 50,
  break_length: 10,
  max_daily_minutes: 120,
  interview_completed: true
};

const DEFAULT_MATERIALS = [
  {
    id: 1,
    course_id: 1,
    course_name: 'Discrete Mathematics',
    filename: 'Discrete Mathematics.pdf',
    upload_date: '2026-08-25',
    status: 'analyzed', // pending | analyzing | analyzed
    page_count: 48,
    file_size: '4.2 MB'
  },
  {
    id: 2,
    course_id: 2,
    course_name: 'C++ Programming',
    filename: 'Lecture 02 - Functions & Memory.pdf',
    upload_date: '2026-08-25',
    status: 'analyzed',
    page_count: 32,
    file_size: '2.8 MB'
  }
];

const DEFAULT_SECTIONS = [
  {
    id: 1,
    material_id: 1,
    course_id: 1,
    title: 'Propositions & Logical Equivalence',
    start_page: 3,
    end_page: 6,
    estimated_minutes: 40,
    difficulty: 1
  },
  {
    id: 2,
    material_id: 1,
    course_id: 1,
    title: 'Logical Operators',
    start_page: 7,
    end_page: 10,
    estimated_minutes: 50,
    difficulty: 2
  },
  {
    id: 3,
    material_id: 1,
    course_id: 1,
    title: 'Truth Tables & Proofs',
    start_page: 11,
    end_page: 15,
    estimated_minutes: 60,
    difficulty: 2
  },
  {
    id: 4,
    material_id: 2,
    course_id: 2,
    title: 'C++ Functions & Parameter Passing',
    start_page: 24,
    end_page: 31,
    estimated_minutes: 50,
    difficulty: 2
  },
  {
    id: 5,
    material_id: 2,
    course_id: 2,
    title: 'Pointers & Dynamic Memory',
    start_page: 45,
    end_page: 52,
    estimated_minutes: 45,
    difficulty: 3
  }
];

const DEFAULT_TASKS = [
  {
    id: 15,
    section_id: 2,
    course_id: 1,
    course_name: 'Discrete Mathematics',
    title: 'Logical Operators',
    pages: 'Pages 7–10',
    start_page: 7,
    end_page: 10,
    estimated_minutes: 50,
    priority: 80,
    priority_level: 'high', // high (red), medium (yellow), normal (green)
    deadline: '2026-08-28',
    status: 'In Progress', // Not Started | In Progress | Completed
    time_group: 'TODAY'
  },
  {
    id: 16,
    section_id: 3,
    course_id: 1,
    course_name: 'Discrete Mathematics',
    title: 'Truth Tables',
    pages: 'Pages 11–15',
    start_page: 11,
    end_page: 15,
    estimated_minutes: 60,
    priority: 70,
    priority_level: 'medium',
    deadline: '2026-08-29',
    status: 'Not Started',
    time_group: 'TODAY'
  },
  {
    id: 22,
    section_id: 4,
    course_id: 2,
    course_name: 'C++ Programming',
    title: 'C++ Functions',
    pages: 'Pages 24–31',
    start_page: 24,
    end_page: 31,
    estimated_minutes: 50,
    priority: 75,
    priority_level: 'high',
    deadline: '2026-08-30',
    status: 'Not Started',
    time_group: 'TODAY'
  },
  {
    id: 24,
    section_id: 5,
    course_id: 2,
    course_name: 'C++ Programming',
    title: 'Pointers & Dynamic Memory',
    pages: 'Pages 45–52',
    start_page: 45,
    end_page: 52,
    estimated_minutes: 45,
    priority: 65,
    priority_level: 'medium',
    deadline: '2026-09-02',
    status: 'Not Started',
    time_group: 'UPCOMING'
  }
];

const DEFAULT_WEEKLY_SCHEDULE = {
  weekLabel: 'Aug 24 – Aug 30',
  startDate: '2026-08-24',
  endDate: '2026-08-30',
  days: [
    {
      dayName: 'MON',
      dateStr: 'Aug 24',
      isToday: false,
      slots: [
        { id: 101, task_id: 15, time: '6:00', title: 'Logical Operators', course_name: 'Discrete Mathematics', course_code: 'CS 201', pages: 'Pages 7–10', duration_minutes: 50, color: 'blue' },
        { id: 102, task_id: 16, time: '7:00', title: 'Truth Tables', course_name: 'Discrete Mathematics', course_code: 'CS 201', pages: 'Pages 11–15', duration_minutes: 50, color: 'blue' }
      ]
    },
    {
      dayName: 'TUE',
      dateStr: 'Aug 25',
      isToday: false,
      slots: [
        { id: 103, task_id: 22, time: '6:00', title: 'C++ Functions', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 24–31', duration_minutes: 50, color: 'emerald' },
        { id: 104, task_id: 24, time: '7:00', title: 'Pointers & Dynamic Mem', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 45–52', duration_minutes: 50, color: 'emerald' }
      ]
    },
    {
      dayName: 'WED',
      dateStr: 'Aug 26',
      isToday: true,
      slots: [
        { id: 105, task_id: 31, time: '6:00', title: 'Network Basics', course_name: 'Computer Networks', course_code: 'CS 144', pages: 'Pages 5–14', duration_minutes: 45, color: 'amber' },
        { id: 106, task_id: 32, time: '6:50', title: 'OSI Model Layers', course_name: 'Computer Networks', course_code: 'CS 144', pages: 'Pages 15–22', duration_minutes: 50, color: 'amber' }
      ]
    },
    {
      dayName: 'THU',
      dateStr: 'Aug 27',
      isToday: false,
      slots: [
        { id: 107, task_id: null, time: '6:00', title: 'Midterm Review', course_name: 'Discrete Math & C++', course_code: 'Review', pages: 'Summary Notes', duration_minutes: 50, color: 'indigo' },
        { id: 108, task_id: null, time: '7:00', title: '─────', course_name: 'Free / Rest Interval', course_code: 'Rest', pages: '', duration_minutes: 30, color: 'slate', isFree: true }
      ]
    },
    {
      dayName: 'FRI',
      dateStr: 'Aug 28',
      isToday: false,
      slots: [
        { id: 109, task_id: 24, time: '6:00', title: 'C++ Memory Leaks', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 53–60', duration_minutes: 50, color: 'emerald' },
        { id: 110, task_id: null, time: '7:00', title: 'Weekly Recaps', course_name: 'General Review', course_code: 'Review', pages: 'Flashcards', duration_minutes: 45, color: 'violet' }
      ]
    }
  ]
};

const DEFAULT_SCHEDULES = [
  {
    id: 1,
    task_id: 15,
    time: '6:00 PM',
    title: 'Logical Operators',
    course_name: 'Discrete Mathematics',
    pages: 'Pages 7–10',
    duration_minutes: 50,
    type: 'task',
    completed: false
  },
  {
    id: 2,
    time: '6:50 PM',
    title: 'Break',
    duration_minutes: 10,
    type: 'break'
  },
  {
    id: 3,
    task_id: 22,
    time: '7:00 PM',
    title: 'C++ Functions',
    course_name: 'C++ Programming',
    pages: 'Pages 24–31',
    duration_minutes: 50,
    type: 'task',
    completed: false
  }
];

const DEFAULT_SESSIONS = [
  { id: 1, task_id: 15, planned_minutes: 50, actual_minutes: 43, completed: 1, date: '2026-08-25', course_name: 'Discrete Mathematics' },
  { id: 2, task_id: 1, planned_minutes: 40, actual_minutes: 40, completed: 1, date: '2026-08-24', course_name: 'Discrete Mathematics' },
  { id: 3, task_id: 10, planned_minutes: 50, actual_minutes: 55, completed: 1, date: '2026-08-23', course_name: 'C++ Programming' },
  { id: 4, task_id: 11, planned_minutes: 45, actual_minutes: 45, completed: 1, date: '2026-08-22', course_name: 'Networking & Systems' }
];

window.StudyGPS = {
  // --- Initialization & Helper ---
  _get: function(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },
  _set: function(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  },

  // --- Auth & User Info ---
  getUser: function() {
    return this._get(STORAGE_KEYS.USER, {
      name: 'Alex Johnson',
      email: 'alex.johnson@university.edu',
      major: 'Computer Science',
      isLoggedIn: true,
      avatar: 'AJ'
    });
  },

  setUser: function(userData) {
    const current = this.getUser();
    const updated = { ...current, ...userData };
    this._set(STORAGE_KEYS.USER, updated);
    return updated;
  },

  // --- User Preferences (Interview) ---
  getPreferences: function() {
    return this._get(STORAGE_KEYS.PREFERENCES, DEFAULT_PREFERENCES);
  },

  savePreferences: function(prefs) {
    const current = this.getPreferences();
    const merged = { ...current, ...prefs, interview_completed: true };
    this._set(STORAGE_KEYS.PREFERENCES, merged);
    this.generateSchedule(); // Auto-recalc schedule based on new study prefs
    return merged;
  },

  // --- Courses ---
  getCourses: function() {
    return this._get(STORAGE_KEYS.COURSES, DEFAULT_COURSES);
  },

  addCourse: function(courseName, code, color, icon) {
    const courses = this.getCourses();
    const newCourse = {
      id: Date.now(),
      name: courseName.trim(),
      code: code ? code.trim() : ('CS' + (courses.length + 1) * 100),
      color: color || '#2563eb',
      icon: icon || '📘'
    };
    courses.push(newCourse);
    this._set(STORAGE_KEYS.COURSES, courses);
    return newCourse;
  },

  deleteCourse: function(courseId) {
    let courses = this.getCourses();
    courses = courses.filter(c => String(c.id) !== String(courseId));
    this._set(STORAGE_KEYS.COURSES, courses);
    return courses;
  },

  // --- Materials ---
  getMaterials: function(courseId) {
    const all = this._get(STORAGE_KEYS.MATERIALS, DEFAULT_MATERIALS);
    if (!courseId) return all;
    return all.filter(m => String(m.course_id) === String(courseId));
  },

  uploadMaterial: function(courseId, fileName, fileSize = '3.5 MB') {
    const materials = this.getMaterials();
    const courses = this.getCourses();
    const course = courses.find(c => String(c.id) === String(courseId)) || courses[0];

    const newMat = {
      id: Date.now(),
      course_id: course ? course.id : 1,
      course_name: course ? course.name : 'General Course',
      filename: fileName || 'Uploaded_Lecture_Notes.pdf',
      file_path: `/uploads/courses/${course ? course.id : 1}/${fileName || 'Uploaded_Lecture_Notes.pdf'}`,
      uploaded_at: new Date().toISOString(),
      status: 'pending',
      page_count: Math.floor(Math.random() * 30) + 15,
      file_size: fileSize
    };

    materials.unshift(newMat);
    this._set(STORAGE_KEYS.MATERIALS, materials);
    return newMat;
  },

  analyzeMaterial: function(materialId) {
    const materials = this.getMaterials();
    const mat = materials.find(m => String(m.id) === String(materialId));
    if (mat) {
      mat.status = 'analyzed';
      this._set(STORAGE_KEYS.MATERIALS, materials);
    }
    return this.getSections(materialId);
  },

  // --- Sections ---
  getSections: function(materialId) {
    const all = this._get(STORAGE_KEYS.SECTIONS, DEFAULT_SECTIONS);
    if (!materialId) return all;
    return all.filter(s => String(s.material_id) === String(materialId));
  },

  // --- Tasks ---
  getTasks: function(filter = {}) {
    let tasks = this._get(STORAGE_KEYS.TASKS, DEFAULT_TASKS);
    if (filter.course_id) {
      tasks = tasks.filter(t => String(t.course_id) === String(filter.course_id));
    }
    if (filter.status && filter.status !== 'All') {
      tasks = tasks.filter(t => t.status === filter.status);
    }
    return tasks;
  },

  getTaskById: function(taskId) {
    const tasks = this.getTasks();
    return tasks.find(t => String(t.id) === String(taskId)) || tasks[0];
  },

  generateTasksFromMaterial: function(materialId) {
    const sections = this.getSections(materialId);
    const existingTasks = this.getTasks();
    const materials = this.getMaterials();
    const mat = materials.find(m => String(m.id) === String(materialId));

    const newTasks = sections.map((sec, idx) => {
      const isPriorityHigh = sec.difficulty >= 2;
      return {
        id: Date.now() + idx,
        section_id: sec.id,
        course_id: sec.course_id,
        course_name: mat ? mat.course_name : 'Course Study',
        title: sec.title,
        pages: `Pages ${sec.start_page}–${sec.end_page}`,
        start_page: sec.start_page,
        end_page: sec.end_page,
        estimated_minutes: sec.estimated_minutes,
        priority: isPriorityHigh ? 80 : 65,
        priority_level: isPriorityHigh ? 'high' : 'medium',
        deadline: new Date(Date.now() + 86400000 * (idx + 2)).toISOString().split('T')[0],
        status: 'Not Started',
        time_group: idx < 2 ? 'TODAY' : 'UPCOMING'
      };
    });

    const combined = [...newTasks, ...existingTasks];
    this._set(STORAGE_KEYS.TASKS, combined);
    this.generateSchedule();
    return newTasks;
  },

  // --- Schedule ---
  getSchedule: function() {
    return this._get(STORAGE_KEYS.SCHEDULES, DEFAULT_SCHEDULES);
  },

  getWeeklySchedule: function(weekOffset = 0) {
    const key = `${STORAGE_KEYS.WEEKLY_SCHEDULE}_offset_${weekOffset}`;
    const cached = this._get(key, null);
    if (cached) return cached;
    if (weekOffset === 0) {
      const defaultWeekly = this._get(STORAGE_KEYS.WEEKLY_SCHEDULE, DEFAULT_WEEKLY_SCHEDULE);
      return defaultWeekly;
    }
    return this.generateWeeklySchedule(weekOffset);
  },

  generateWeeklySchedule: function(weekOffset = 0) {
    const prefs = this.getPreferences();
    const tasks = this.getTasks();
    const courses = this.getCourses();

    // Compute base dates (Centered around current mock date Aug 26, 2026 -> Mon Aug 24)
    const baseMonday = new Date(2026, 7, 24 + weekOffset * 7); // Month is 0-indexed (7 = Aug)
    const baseSunday = new Date(baseMonday);
    baseSunday.setDate(baseMonday.getDate() + 6);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startStr = `${monthNames[baseMonday.getMonth()]} ${baseMonday.getDate()}`;
    const endStr = `${monthNames[baseSunday.getMonth()]} ${baseSunday.getDate()}`;
    const weekLabel = `${startStr} – ${endStr}`;

    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const startTimes = ['6:00', '7:00'];

    // Collect available subjects / modules to distribute
    const subjectPool = [
      { title: 'Logical Operators', course_name: 'Discrete Mathematics', course_code: 'CS 201', pages: 'Pages 7–10', color: 'blue', task_id: 15 },
      { title: 'Truth Tables', course_name: 'Discrete Mathematics', course_code: 'CS 201', pages: 'Pages 11–15', color: 'blue', task_id: 16 },
      { title: 'C++ Functions', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 24–31', color: 'emerald', task_id: 22 },
      { title: 'Pointers & Dynamic Mem', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 45–52', color: 'emerald', task_id: 24 },
      { title: 'Network Basics', course_name: 'Computer Networks', course_code: 'CS 144', pages: 'Pages 5–14', color: 'amber', task_id: 31 },
      { title: 'OSI Model Layers', course_name: 'Computer Networks', course_code: 'CS 144', pages: 'Pages 15–22', color: 'amber', task_id: 32 },
      { title: 'Midterm Review', course_name: 'Discrete Math & C++', course_code: 'Review', pages: 'Summary Notes', color: 'indigo', task_id: null },
      { title: '─────', course_name: 'Free / Rest Interval', course_code: 'Rest', pages: '', color: 'slate', task_id: null, isFree: true },
      { title: 'C++ Memory Leaks', course_name: 'C++ Programming', course_code: 'CS 106B', pages: 'Pages 53–60', color: 'emerald', task_id: 24 },
      { title: 'Weekly Recaps', course_name: 'General Review', course_code: 'Review', pages: 'Flashcards', color: 'violet', task_id: null }
    ];

    let poolIndex = (Math.abs(weekOffset) * 3) % subjectPool.length;

    const days = dayNames.map((dName, idx) => {
      const curDate = new Date(baseMonday);
      curDate.setDate(baseMonday.getDate() + idx);
      const isToday = weekOffset === 0 && dName === 'WED';

      const s1 = subjectPool[poolIndex % subjectPool.length];
      poolIndex++;
      const s2 = subjectPool[poolIndex % subjectPool.length];
      poolIndex++;

      return {
        dayName: dName,
        dateStr: `${monthNames[curDate.getMonth()]} ${curDate.getDate()}`,
        isToday: isToday,
        slots: [
          {
            id: (weekOffset + 10) * 100 + idx * 2 + 1,
            time: '6:00',
            task_id: s1.task_id,
            title: s1.title,
            course_name: s1.course_name,
            course_code: s1.course_code,
            pages: s1.pages,
            duration_minutes: 50,
            color: s1.color,
            isFree: !!s1.isFree
          },
          {
            id: (weekOffset + 10) * 100 + idx * 2 + 2,
            time: dName === 'WED' ? '6:50' : '7:00',
            task_id: s2.task_id,
            title: s2.title,
            course_name: s2.course_name,
            course_code: s2.course_code,
            pages: s2.pages,
            duration_minutes: 50,
            color: s2.color,
            isFree: !!s2.isFree
          }
        ]
      };
    });

    const weeklyData = {
      weekLabel,
      startDate: baseMonday.toISOString().split('T')[0],
      endDate: baseSunday.toISOString().split('T')[0],
      days
    };

    const key = weekOffset === 0 ? STORAGE_KEYS.WEEKLY_SCHEDULE : `${STORAGE_KEYS.WEEKLY_SCHEDULE}_offset_${weekOffset}`;
    this._set(key, weeklyData);
    return weeklyData;
  },

  generateSchedule: function() {
    const prefs = this.getPreferences();
    const tasks = this.getTasks().filter(t => t.status !== 'Completed');
    const startTimeStr = prefs.preferred_start || '18:00';
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const sessionLength = prefs.session_length || 50;
    const breakLength = prefs.break_length || 10;

    let currentMinutes = startH * 60 + (startM || 0);
    const newSchedule = [];

    const formatTime = (totalMins) => {
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 || 12;
      const displayM = String(m).padStart(2, '0');
      return `${displayH}:${displayM} ${ampm}`;
    };

    const studyTasks = tasks.slice(0, 3);
    studyTasks.forEach((task, index) => {
      const startMin = currentMinutes;
      const endMin = currentMinutes + sessionLength;
      
      // Add study block matching schedules schema: (id, task_id, date, start_time, end_time, start_page, end_page)
      newSchedule.push({
        id: index * 2 + 1,
        task_id: task.id,
        date: new Date().toISOString().split('T')[0],
        start_time: formatTime(startMin),
        end_time: formatTime(endMin),
        start_page: task.start_page || 1,
        end_page: task.end_page || 10,
        time: formatTime(startMin),
        title: task.title,
        course_name: task.course_name,
        pages: task.pages,
        duration_minutes: sessionLength,
        type: 'task',
        completed: task.status === 'Completed'
      });

      currentMinutes += sessionLength;

      // Add break if not last task
      if (index < studyTasks.length - 1) {
        newSchedule.push({
          id: index * 2 + 2,
          time: formatTime(currentMinutes),
          title: 'Break',
          duration_minutes: breakLength,
          type: 'break'
        });
        currentMinutes += breakLength;
      }
    });

    this._set(STORAGE_KEYS.SCHEDULES, newSchedule);
    return newSchedule;
  },

  // --- Study Sessions (Timer -> DB) ---
  getSessions: function() {
    return this._get(STORAGE_KEYS.SESSIONS, DEFAULT_SESSIONS);
  },

  recordStudySession: function(taskId, plannedMinutes, actualMinutes, completed = 1) {
    const sessions = this.getSessions();
    const task = this.getTaskById(taskId);
    const now = new Date();
    const startTime = new Date(now.getTime() - (Number(actualMinutes) || 45) * 60000).toTimeString().substring(0, 5);
    const endTime = now.toTimeString().substring(0, 5);

    // Matches study_sessions schema: (id, task_id, planned_minutes, actual_minutes, start_time, end_time, completed)
    const newSession = {
      id: Date.now(),
      task_id: taskId ? Number(taskId) : 15,
      planned_minutes: Number(plannedMinutes) || 50,
      actual_minutes: Number(actualMinutes) || 45,
      start_time: startTime,
      end_time: endTime,
      completed: completed ? 1 : 0,
      date: now.toISOString().split('T')[0],
      course_name: task ? task.course_name : 'General Study'
    };

    sessions.unshift(newSession);
    this._set(STORAGE_KEYS.SESSIONS, sessions);

    // Update task status if completed
    if (completed && task) {
      const allTasks = this.getTasks();
      const target = allTasks.find(t => String(t.id) === String(taskId));
      if (target) {
        target.status = 'Completed';
        this._set(STORAGE_KEYS.TASKS, allTasks);
      }
    }

    return newSession;
  },

  // --- Progress Analytics ---
  getProgress: function() {
    const tasks = this.getTasks();
    const sessions = this.getSessions();
    const completedTasks = tasks.filter(t => t.status === 'Completed').length;
    const totalTasks = tasks.length || 12;

    const totalMinutes = sessions.reduce((acc, s) => acc + (s.actual_minutes || 0), 0) + 270;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    const completionRate = Math.round((completedTasks / totalTasks) * 100) || 67;

    return {
      tasksCompleted: completedTasks + 8, // base historical + recent
      totalTasks: totalTasks + 4,
      studiedDisplay: `${hours}h ${mins}m`,
      completionRate: Math.min(100, Math.max(0, completionRate)),
      weeklyHours: [1.2, 2.5, 3.8, 1.5, 4.5, 3.2, 4.8], // M T W T F S S
      courses: [
        { name: 'Discrete Mathematics', progress: 78, color: '#3b82f6' },
        { name: 'C++ Programming', progress: 64, color: '#10b981' },
        { name: 'Networking & Systems', progress: 52, color: '#8b5cf6' }
      ],
      scheduleAdherence: 81
    };
  }
};

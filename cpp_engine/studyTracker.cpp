// ============================================================
//  StudyGPS - cpp_engine/studyTracker.cpp
//  Study session tracking logic (no UI timer here).
//  The frontend will later call: Start / Pause / Resume / Finish.
//
//  Build: g++ -std=c++17 studyTracker.cpp -o studyTracker
// ============================================================

#include <iostream>
#include <string>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

// Task status pipeline:  Not Started -> In Progress -> Completed
enum class TaskStatus {
    NotStarted,
    InProgress,
    Completed
};

// Plain data holder that mirrors the `study_sessions` table
// (id, task_id, planned_minutes, actual_minutes, start_time, end_time, completed)
struct StudySessionRecord {
    int         taskId;
    int         plannedMinutes;
    int         actualMinutes;
    std::string startTime;   // "YYYY-MM-DD HH:MM:SS"
    std::string endTime;     // "YYYY-MM-DD HH:MM:SS"
    int         completed;   // 0 or 1
};

class StudySession {
private:
    // ---- Task data (input) ----
    int         taskId;
    std::string taskName;
    int         plannedDurationMinutes;
    TaskStatus  status;

    // ---- Elapsed-time measurement (monotonic, immune to clock changes) ----
    std::chrono::steady_clock::time_point segmentStart;  // start of current running segment
    long long   totalActiveSeconds;                      // sum of finished segments

    // ---- Wall-clock stamps (what actually goes into the database) ----
    std::chrono::system_clock::time_point sessionStartWall;
    std::chrono::system_clock::time_point sessionEndWall;
    bool        hasStartStamp;
    bool        hasEndStamp;

    // ---- Timer state ----
    bool        isRunning;   // session started and not yet finished
    bool        isPaused;

    int         actualMinutes; // computed at finishSession()

    // Format a system_clock time point as "YYYY-MM-DD HH:MM:SS"
    static std::string formatTime(const std::chrono::system_clock::time_point& tp) {
        std::time_t t = std::chrono::system_clock::to_time_t(tp);
        std::tm tmBuf{};
#ifdef _WIN32
        localtime_s(&tmBuf, &t);
#else
        localtime_r(&t, &tmBuf);
#endif
        std::ostringstream oss;
        oss << std::put_time(&tmBuf, "%Y-%m-%d %H:%M:%S");
        return oss.str();
    }

    // Internal setter used by the state machine
    void setStatus(TaskStatus newStatus) { status = newStatus; }

    // Close the currently running segment and add it to the total
    void accumulateCurrentSegment() {
        auto now = std::chrono::steady_clock::now();
        totalActiveSeconds +=
            std::chrono::duration_cast<std::chrono::seconds>(now - segmentStart).count();
    }

public:
    // Constructor: Task ID + Task name + Planned study duration
    StudySession(int id, const std::string& name, int plannedMinutes)
        : taskId(id),
          taskName(name),
          plannedDurationMinutes(plannedMinutes),
          status(TaskStatus::NotStarted),
          totalActiveSeconds(0),
          hasStartStamp(false),
          hasEndStamp(false),
          isRunning(false),
          isPaused(false),
          actualMinutes(0) {}

    // ---------------------------------------------------
    // 1. startSession() - begin the study session
    // ---------------------------------------------------
    bool startSession() {
        if (isRunning) {
            std::cout << "!! Session is already running.\n";
            return false;
        }
        if (status == TaskStatus::Completed) {
            std::cout << "!! Task already completed. Start a new session object.\n";
            return false;
        }

        totalActiveSeconds = 0;
        actualMinutes      = 0;
        segmentStart       = std::chrono::steady_clock::now();
        sessionStartWall   = std::chrono::system_clock::now();
        hasStartStamp      = true;
        hasEndStamp        = false;
        isRunning          = true;
        isPaused           = false;

        updateTaskStatus();   // Not Started -> In Progress
        std::cout << "-> Session started for task: " << taskName
                  << " (planned " << plannedDurationMinutes << " min)\n";
        return true;
    }

    // ---------------------------------------------------
    // 2. pauseSession() - stop counting time
    // ---------------------------------------------------
    bool pauseSession() {
        if (!isRunning) {
            std::cout << "!! Cannot pause: no active session.\n";
            return false;
        }
        if (isPaused) {
            std::cout << "!! Session is already paused.\n";
            return false;
        }

        accumulateCurrentSegment();
        isPaused = true;
        std::cout << "-> Session paused (" << totalActiveSeconds << "s counted so far).\n";
        return true;
    }

    // ---------------------------------------------------
    // 3. resumeSession() - continue counting time
    // ---------------------------------------------------
    bool resumeSession() {
        if (!isRunning) {
            std::cout << "!! Cannot resume: no active session.\n";
            return false;
        }
        if (!isPaused) {
            std::cout << "!! Session is not paused.\n";
            return false;
        }

        segmentStart = std::chrono::steady_clock::now();  // new segment; paused time excluded
        isPaused     = false;
        std::cout << "-> Session resumed.\n";
        return true;
    }

    // ---------------------------------------------------
    // 4. finishSession() - end session, compute time, update status
    // ---------------------------------------------------
    bool finishSession() {
        if (!isRunning) {
            std::cout << "!! Cannot finish: no active session.\n";
            return false;
        }

        if (!isPaused) {
            accumulateCurrentSegment();   // paused time was already banked
        }

        sessionEndWall = std::chrono::system_clock::now();
        hasEndStamp    = true;
        isRunning      = false;
        isPaused       = false;

        actualMinutes  = calculateDuration();   // Calculate Actual Time
        updateTaskStatus();                     // In Progress -> Completed

        std::cout << "-> Session finished. Actual study time: "
                  << actualMinutes << " minutes.\n";
        return true;
    }

    // ---------------------------------------------------
    // 5. calculateDuration() - actual minutes studied
    //    (paused time is never counted; rounded to nearest minute)
    // ---------------------------------------------------
    int calculateDuration() const {
        long long seconds = totalActiveSeconds;
        if (isRunning && !isPaused) {   // allow a live read mid-session
            auto now = std::chrono::steady_clock::now();
            seconds += std::chrono::duration_cast<std::chrono::seconds>(now - segmentStart).count();
        }
        if (seconds < 0) seconds = 0;
        return static_cast<int>((seconds + 30) / 60);
    }

    // ---------------------------------------------------
    // 6. updateTaskStatus() - advance the status pipeline
    //    Not Started -> In Progress -> Completed
    // ---------------------------------------------------
    void updateTaskStatus() {
        switch (status) {
            case TaskStatus::NotStarted: setStatus(TaskStatus::InProgress); break;
            case TaskStatus::InProgress: setStatus(TaskStatus::Completed);  break;
            case TaskStatus::Completed:  /* terminal state */               break;
        }
    }

    // Optional explicit form (e.g. backend restoring a saved session)
    void updateTaskStatus(TaskStatus newStatus) { setStatus(newStatus); }

    // ---------------------------------------------------
    // Save Study Session -> row for the study_sessions table
    // ---------------------------------------------------
    StudySessionRecord toRecord() const {
        StudySessionRecord r;
        r.taskId         = taskId;
        r.plannedMinutes = plannedDurationMinutes;
        r.actualMinutes  = (status == TaskStatus::Completed) ? actualMinutes : calculateDuration();
        r.startTime      = hasStartStamp ? formatTime(sessionStartWall) : "";
        r.endTime        = hasEndStamp   ? formatTime(sessionEndWall)   : "";
        r.completed      = (status == TaskStatus::Completed) ? 1 : 0;
        return r;
    }

    // ---- Getters ----
    int         getTaskId()         const { return taskId; }
    std::string getTaskName()       const { return taskName; }
    int         getPlannedMinutes() const { return plannedDurationMinutes; }
    TaskStatus  getStatus()         const { return status; }
    bool        running()           const { return isRunning; }
    bool        paused()            const { return isPaused; }

    std::string getStatusString() const {
        switch (status) {
            case TaskStatus::NotStarted: return "Not Started";
            case TaskStatus::InProgress: return "In Progress";
            case TaskStatus::Completed:  return "Completed";
            default:                     return "Unknown";
        }
    }

    // ---- Display ----
    void displaySummary() const {
        std::cout << "\n=========================================\n";
        std::cout << "Task: " << taskName << "\n\n";
        std::cout << "Planned Time: " << plannedDurationMinutes << " minutes\n";
        std::cout << "Actual Time: "
                  << ((status == TaskStatus::Completed) ? actualMinutes : calculateDuration())
                  << " minutes\n\n";
        std::cout << "Status: " << getStatusString() << "\n";
        std::cout << "=========================================\n";
    }

    // Test hook: inject elapsed study time without waiting in real time.
    // Remove (or ignore) once the real frontend timer drives the session.
    void addElapsedSecondsForTesting(long long seconds) { totalActiveSeconds += seconds; }
};

// ============================================================
//  Demo / flow simulation
//  Scheduled Task -> Start -> Study -> Pause/Resume -> Finish
//  -> Calculate Actual Time -> Update Task Status -> Save
// ============================================================
int main(int argc, char* argv[]) {

    // Expected:
    // studyTracker.exe <task_id> <task_name> <planned_minutes> <actual_seconds>

    if (argc != 5) {
        std::cerr
            << "Usage: studyTracker.exe <task_id> <task_name> "
            << "<planned_minutes> <actual_seconds>\n";
        return 1;
    }

    try {
        int taskId = std::stoi(argv[1]);
        std::string taskName = argv[2];
        int plannedMinutes = std::stoi(argv[3]);
        long long actualSeconds = std::stoll(argv[4]);

        if (taskId <= 0 || plannedMinutes <= 0 || actualSeconds < 0) {
            std::cerr << "Invalid input values.\n";
            return 1;
        }

        // Create the C++ study session.
        StudySession session(taskId, taskName, plannedMinutes);

        // Start the session.
        session.startSession();

        // For this integration step, the frontend has already
        // measured the active study time.
        session.addElapsedSecondsForTesting(actualSeconds);

        // Finish and calculate actual study time.
        session.finishSession();

        // Convert to database-ready record.
        StudySessionRecord row = session.toRecord();

        // IMPORTANT:
        // Output only machine-readable data for Node.js.
        std::cout
            << "task_id=" << row.taskId
            << " planned_minutes=" << row.plannedMinutes
            << " actual_minutes=" << row.actualMinutes
            << " completed=" << row.completed
            << "\n";

        return 0;

    } catch (const std::exception& error) {
        std::cerr << "C++ error: " << error.what() << "\n";
        return 1;
    }
}
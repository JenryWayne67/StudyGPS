// studyTracker.cpp - records one study session: planned vs. actual minutes and status.
// Usage: studyTracker.exe <task_id> <task_name> <planned_minutes> <actual_seconds>

#include <iostream>
#include <string>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

// Not Started -> In Progress -> Completed
enum class TaskStatus {
    NotStarted,
    InProgress,
    Completed
};

// One row for the study_sessions table.
struct StudySessionRecord {
    int         taskId;
    int         plannedMinutes;
    int         actualMinutes;
    std::string startTime;   // "YYYY-MM-DD HH:MM:SS"
    std::string endTime;
    int         completed;
};

class StudySession {
private:
    int         taskId;
    std::string taskName;
    int         plannedDurationMinutes;
    TaskStatus  status;

    std::chrono::steady_clock::time_point segmentStart;
    long long   totalActiveSeconds;                      // finished segments only; paused time excluded

    std::chrono::system_clock::time_point sessionStartWall;
    std::chrono::system_clock::time_point sessionEndWall;
    bool        hasStartStamp;
    bool        hasEndStamp;

    bool        isRunning;
    bool        isPaused;

    int         actualMinutes;

    // "YYYY-MM-DD HH:MM:SS" in local time.
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

    void setStatus(TaskStatus newStatus) { status = newStatus; }

    // Adds the running segment to totalActiveSeconds.
    void accumulateCurrentSegment() {
        auto now = std::chrono::steady_clock::now();
        totalActiveSeconds +=
            std::chrono::duration_cast<std::chrono::seconds>(now - segmentStart).count();
    }

public:
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

        actualMinutes  = calculateDuration();
        updateTaskStatus();                     // In Progress -> Completed

        std::cout << "-> Session finished. Actual study time: "
                  << actualMinutes << " minutes.\n";
        return true;
    }

    // Minutes studied so far, rounded to the nearest minute (paused time excluded).
    int calculateDuration() const {
        long long seconds = totalActiveSeconds;
        if (isRunning && !isPaused) {
            auto now = std::chrono::steady_clock::now();
            seconds += std::chrono::duration_cast<std::chrono::seconds>(now - segmentStart).count();
        }
        if (seconds < 0) seconds = 0;
        return static_cast<int>((seconds + 30) / 60);
    }

    // Advances Not Started -> In Progress -> Completed.
    void updateTaskStatus() {
        switch (status) {
            case TaskStatus::NotStarted: setStatus(TaskStatus::InProgress); break;
            case TaskStatus::InProgress: setStatus(TaskStatus::Completed);  break;
            case TaskStatus::Completed:                                     break;
        }
    }

    void updateTaskStatus(TaskStatus newStatus) { setStatus(newStatus); }

    // The row saved to study_sessions.
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

    // Adds study time the frontend's timer already measured.
    void addElapsedSecondsForTesting(long long seconds) { totalActiveSeconds += seconds; }
};

// Runs a session with the frontend-measured seconds and prints
// task_id= planned_minutes= actual_minutes= completed= for Node.js.
int main(int argc, char* argv[]) {

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

        StudySession session(taskId, taskName, plannedMinutes);

        session.startSession();

        session.addElapsedSecondsForTesting(actualSeconds);

        session.finishSession();

        StudySessionRecord row = session.toRecord();

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

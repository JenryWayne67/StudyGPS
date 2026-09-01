// studyTracker.cpp
//
// Core tracking logic for how much time a student actually spends studying
// a given task. No UI / timer front-end here on purpose — this class only
// tracks state transitions and elapsed time; a frontend would eventually
// call startSession() / pauseSession() / resumeSession() / finishSession()
// in response to button presses.
//
// The end result of a session (task id, planned vs actual minutes, status)
// is shaped so it can be dropped straight into a `study_sessions` table.

#include <iostream>
#include <string>
#include <chrono>
#include <stdexcept>

// ---------------------------------------------------------------------
// Task status, per the spec's flow: Not Started -> In Progress -> Completed
// ---------------------------------------------------------------------
enum class TaskStatus {
    NotStarted,
    InProgress,
    Completed
};

inline std::string toString(TaskStatus status) {
    switch (status) {
        case TaskStatus::NotStarted: return "Not Started";
        case TaskStatus::InProgress: return "In Progress";
        case TaskStatus::Completed:  return "Completed";
    }
    return "Unknown";
}

// ---------------------------------------------------------------------
// Internal session state machine (separate from TaskStatus, since a
// session can be Paused mid-way, which isn't a task status of its own).
// ---------------------------------------------------------------------
enum class SessionState {
    Idle,       // created, not started yet
    Running,    // actively being timed
    Paused,     // timer stopped, session not finished
    Finished    // session complete, duration calculated
};

inline std::string toString(SessionState state) {
    switch (state) {
        case SessionState::Idle:     return "Idle";
        case SessionState::Running:  return "Running";
        case SessionState::Paused:   return "Paused";
        case SessionState::Finished: return "Finished";
    }
    return "Unknown";
}

// ---------------------------------------------------------------------
// StudySession
// ---------------------------------------------------------------------
class StudySession {
public:
    StudySession(std::string taskId, std::string taskName, int plannedMinutes)
        : taskId_(std::move(taskId)),
          taskName_(std::move(taskName)),
          plannedMinutes_(plannedMinutes),
          state_(SessionState::Idle),
          status_(TaskStatus::NotStarted),
          accumulatedSeconds_(0),
          actualMinutes_(-1) {
        if (plannedMinutes_ <= 0) {
            throw std::invalid_argument("plannedMinutes must be positive");
        }
    }

    // -------------------------------------------------------------
    // 1. Start the study session
    // -------------------------------------------------------------
    void startSession() {
        if (state_ != SessionState::Idle) {
            throw std::logic_error("startSession() called but session is not Idle (current state: "
                                    + toString(state_) + ")");
        }
        segmentStart_ = Clock::now();
        state_ = SessionState::Running;
        updateTaskStatus(); // NotStarted -> InProgress
        log("Session started");
    }

    // -------------------------------------------------------------
    // 2. Pause the current study session
    // -------------------------------------------------------------
    void pauseSession() {
        if (state_ != SessionState::Running) {
            throw std::logic_error("pauseSession() called but session is not Running (current state: "
                                    + toString(state_) + ")");
        }
        accumulateElapsed();
        state_ = SessionState::Paused;
        log("Session paused");
    }

    // -------------------------------------------------------------
    // 3. Resume a paused study session
    // -------------------------------------------------------------
    void resumeSession() {
        if (state_ != SessionState::Paused) {
            throw std::logic_error("resumeSession() called but session is not Paused (current state: "
                                    + toString(state_) + ")");
        }
        segmentStart_ = Clock::now();
        state_ = SessionState::Running;
        log("Session resumed");
    }

    // -------------------------------------------------------------
    // 4. Finish the session and calculate the actual study time
    // -------------------------------------------------------------
    void finishSession() {
        if (state_ != SessionState::Running && state_ != SessionState::Paused) {
            throw std::logic_error("finishSession() called but session is not Running or Paused (current state: "
                                    + toString(state_) + ")");
        }
        if (state_ == SessionState::Running) {
            accumulateElapsed();
        }
        state_ = SessionState::Finished;
        actualMinutes_ = calculateDuration();
        updateTaskStatus(); // InProgress -> Completed
        log("Session finished");
    }

    // -------------------------------------------------------------
    // 5. Calculate how many minutes were actually studied
    //    (rounded to the nearest minute; safe to call before finishing,
    //    e.g. to show a live "studied so far" figure)
    // -------------------------------------------------------------
    long calculateDuration() const {
        long long totalSeconds = accumulatedSeconds_;
        if (state_ == SessionState::Running) {
            totalSeconds += secondsSince(segmentStart_);
        }
        // round to nearest minute rather than always truncating down
        return static_cast<long>((totalSeconds + 30) / 60);
    }

    // -------------------------------------------------------------
    // 6. Update task status based on current session state
    // -------------------------------------------------------------
    void updateTaskStatus() {
        switch (state_) {
            case SessionState::Idle:
                status_ = TaskStatus::NotStarted;
                break;
            case SessionState::Running:
            case SessionState::Paused:
                status_ = TaskStatus::InProgress;
                break;
            case SessionState::Finished:
                status_ = TaskStatus::Completed;
                break;
        }
    }

    // -------------------------------------------------------------
    // Accessors / reporting
    // -------------------------------------------------------------
    const std::string& taskId() const { return taskId_; }
    const std::string& taskName() const { return taskName_; }
    int plannedMinutes() const { return plannedMinutes_; }
    long actualMinutes() const { return actualMinutes_; }
    TaskStatus status() const { return status_; }
    SessionState state() const { return state_; }

    // A plain-data snapshot shaped for a `study_sessions` row:
    // (task_id, task_name, planned_minutes, actual_minutes, status)
    void printSummary() const {
        std::cout << "Task: " << taskName_ << "\n";
        std::cout << "Planned Time: " << plannedMinutes_ << " minutes\n";
        std::cout << "Actual Time: "
                   << (actualMinutes_ >= 0 ? actualMinutes_ : calculateDuration())
                   << " minutes\n";
        std::cout << "Status: " << toString(status_) << "\n";
    }

private:
    using Clock = std::chrono::steady_clock;

    static long long secondsSince(Clock::time_point t) {
        return std::chrono::duration_cast<std::chrono::seconds>(Clock::now() - t).count();
    }

    // Add the time elapsed in the current running segment to the total,
    // then reset the segment marker. Called whenever a running segment ends
    // (pause or finish).
    void accumulateElapsed() {
        accumulatedSeconds_ += secondsSince(segmentStart_);
    }

    void log(const std::string& msg) const {
        std::cout << "[StudySession:" << taskId_ << "] " << msg
                   << " (state=" << toString(state_) << ")\n";
    }

    std::string taskId_;
    std::string taskName_;
    int plannedMinutes_;

    SessionState state_;
    TaskStatus status_;

    Clock::time_point segmentStart_;   // when the current Running segment began
    long long accumulatedSeconds_;     // total active (non-paused) seconds so far
    long actualMinutes_;               // set once finishSession() runs; -1 until then
};

// ---------------------------------------------------------------------
// Demo matching the spec's example:
//   Task: Logical Operators, Planned: 50 minutes -> Actual: 43 minutes -> Completed
//
// Since this is a real timer, the demo fast-forwards conceptually by
// pausing/resuming quickly; in real use the elapsed time would reflect
// however long the student actually studied.
// ---------------------------------------------------------------------
int main() {
    StudySession session("task_001", "Logical Operators", 50);

    session.startSession();
    // ... student studies ...
    session.pauseSession();
    // ... student takes a break ...
    session.resumeSession();
    // ... student studies more ...
    session.finishSession();

    session.printSummary();

    // Example of what would get persisted to study_sessions:
    // INSERT INTO study_sessions (task_id, task_name, planned_minutes, actual_minutes, status)
    // VALUES (session.taskId(), session.taskName(), session.plannedMinutes(),
    //         session.actualMinutes(), toString(session.status()));

    return 0;
}

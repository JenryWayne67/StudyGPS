// scheduler.cpp
//
// Generates a study schedule from a set of tasks and a set of available
// time windows. No UI / database code here on purpose — this is the raw
// scheduling algorithm, exercised against sample data via main().
//
// NOTE on dates: real deadlines ("August 29") and real calendar days
// ("Monday") need a calendar to compare against "today". To keep this
// module self-contained, both tasks and time slots carry a small integer
// `dayIndex` = "how many days from today" (0 = today/soonest day, 1 =
// tomorrow, etc). Converting an actual calendar date into that index is a
// one-line job for whoever wires this up to a real calendar/date library
// later — it's deliberately kept out of the scheduling algorithm itself.

#include <algorithm>
#include <cmath>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------
// Input data structures
// ---------------------------------------------------------------------

struct Task {
    std::string id;
    std::string name;
    int estimatedMinutes;
    int priority;           // higher = more important (e.g. 0-100)
    int deadlineDayIndex;   // days from today the task is due by
    int difficulty = 0;     // optional tie-breaker, higher = harder (0 if unused)

    // Optional reading-page range this task covers. Use -1/-1 for tasks
    // that don't correspond to a page range (e.g. a practice-problem set).
    int startPage = -1;
    int endPage = -1;

    bool hasPages() const { return startPage >= 0 && endPage >= startPage; }
    int pageCount() const { return hasPages() ? (endPage - startPage + 1) : 0; }
};

struct TimeSlot {
    std::string dayLabel;   // e.g. "Monday" — for display only
    int dayIndex;           // days from today — for ordering/deadline comparison
    int startMinutes;       // minutes since midnight
    int endMinutes;         // minutes since midnight
};

struct SchedulerConfig {
    int sessionLengthMinutes;   // preferred length of one study session
    int breakLengthMinutes;     // break inserted after each session
    int maxDailyMinutes;        // cap on total *study* minutes per day (breaks excluded)
};

// ---------------------------------------------------------------------
// Output data structure — what createSchedule() produces, one per session
// ---------------------------------------------------------------------

struct ScheduledSession {
    std::string taskId;
    std::string taskName;
    std::string dayLabel;
    int dayIndex;
    int startMinutes;
    int endMinutes;
    int startPage = -1;   // -1 if the task has no pages
    int endPage = -1;
    int partNumber;       // 1-based; >1 means this task was split
    int totalParts;
};

// ---------------------------------------------------------------------
// Small formatting helper (not part of the algorithm, just for main())
// ---------------------------------------------------------------------

static std::string minutesToClock(int minutesSinceMidnight) {
    int h24 = (minutesSinceMidnight / 60) % 24;
    int m = minutesSinceMidnight % 60;
    int h12 = h24 % 12;
    if (h12 == 0) h12 = 12;
    const char* ampm = (h24 < 12) ? "AM" : "PM";
    std::ostringstream out;
    out << h12 << ":" << (m < 10 ? "0" : "") << m << " " << ampm;
    return out.str();
}

// ---------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------

class Scheduler {
public:
    Scheduler(std::vector<Task> tasks,
               std::vector<TimeSlot> availableSlots,
               SchedulerConfig config)
        : tasks_(std::move(tasks)),
          availableSlots_(std::move(availableSlots)),
          config_(config) {
        // Slots must be processed in chronological order for "earliest slot
        // first" placement to make sense.
        std::sort(availableSlots_.begin(), availableSlots_.end(),
                  [](const TimeSlot& a, const TimeSlot& b) {
                      if (a.dayIndex != b.dayIndex) return a.dayIndex < b.dayIndex;
                      return a.startMinutes < b.startMinutes;
                  });
    }

    // -------------------------------------------------------------
    // 1. Generate the final study schedule
    // -------------------------------------------------------------
    std::vector<ScheduledSession> generateSchedule() {
        std::vector<ScheduledSession> schedule;
        unscheduledWarnings_.clear();

        std::vector<Task> ordered = prioritizeTasks(tasks_);

        // Working copies we consume from as sessions get placed.
        std::vector<TimeSlot> remainingSlots = availableSlots_;
        std::map<int, int> dailyUsedMinutes; // dayIndex -> minutes used so far

        for (const Task& task : ordered) {
            std::vector<int> chunks = splitTask(task.estimatedMinutes, config_.sessionLengthMinutes);

            int currentPage = task.startPage;
            int minutesPlacedSoFar = 0;
            int totalParts = static_cast<int>(chunks.size());

            for (int i = 0; i < totalParts; ++i) {
                int chunkMinutes = chunks[i];

                int slotIdx = findAvailableSlot(remainingSlots, dailyUsedMinutes, chunkMinutes);
                if (slotIdx == -1) {
                    unscheduledWarnings_.push_back(
                        task.name + ": could not find room for " + std::to_string(chunkMinutes) +
                        " more minute(s) (part " + std::to_string(i + 1) + "/" +
                        std::to_string(totalParts) + ")");
                    continue; // try the next chunk anyway; later chunks may still fit elsewhere
                }

                TimeSlot& slot = remainingSlots[slotIdx];

                // Work out the page range for this chunk (proportional to
                // time, using cumulative rounding so the parts add up
                // exactly to the task's full page range).
                int chunkStartPage = -1, chunkEndPage = -1;
                if (task.hasPages()) {
                    minutesPlacedSoFar += chunkMinutes;
                    double fraction = static_cast<double>(minutesPlacedSoFar) / task.estimatedMinutes;
                    int pageBoundary = task.startPage +
                        static_cast<int>(std::round(fraction * task.pageCount())) - 1;
                    pageBoundary = std::min(pageBoundary, task.endPage);

                    chunkStartPage = currentPage;
                    chunkEndPage = std::max(pageBoundary, chunkStartPage); // never go backwards
                    currentPage = chunkEndPage + 1;
                }

                ScheduledSession session = createSchedule(
                    task, slot, chunkMinutes, chunkStartPage, chunkEndPage, i + 1, totalParts);
                schedule.push_back(session);

                // Consume the time (and the following break) from the slot.
                dailyUsedMinutes[slot.dayIndex] += chunkMinutes;
                slot.startMinutes += chunkMinutes;
                if (slot.startMinutes + config_.breakLengthMinutes <= slot.endMinutes) {
                    slot.startMinutes += config_.breakLengthMinutes;
                }
            }
        }

        return schedule;
    }

    // -------------------------------------------------------------
    // 2. Sort tasks by priority, urgency (deadline), and difficulty
    // -------------------------------------------------------------
    std::vector<Task> prioritizeTasks(std::vector<Task> tasksToSort) const {
        std::sort(tasksToSort.begin(), tasksToSort.end(),
                  [this](const Task& a, const Task& b) {
                      return taskScore(a) > taskScore(b); // higher score = scheduled earlier
                  });
        return tasksToSort;
    }

    // -------------------------------------------------------------
    // 3. Find the first available slot with room for `neededMinutes`
    //    Returns an index into `slots`, or -1 if none fits.
    // -------------------------------------------------------------
    int findAvailableSlot(const std::vector<TimeSlot>& slots,
                           const std::map<int, int>& dailyUsedMinutes,
                           int neededMinutes) const {
        for (int i = 0; i < static_cast<int>(slots.size()); ++i) {
            const TimeSlot& slot = slots[i];
            int usedToday = 0;
            auto it = dailyUsedMinutes.find(slot.dayIndex);
            if (it != dailyUsedMinutes.end()) usedToday = it->second;

            if (usedToday + neededMinutes > config_.maxDailyMinutes) continue;
            if (canFitTask(slot, neededMinutes)) return i;
        }
        return -1;
    }

    // -------------------------------------------------------------
    // 4. Check whether a chunk of `minutesNeeded` fits in a slot
    // -------------------------------------------------------------
    bool canFitTask(const TimeSlot& slot, int minutesNeeded) const {
        return (slot.endMinutes - slot.startMinutes) >= minutesNeeded;
    }

    // -------------------------------------------------------------
    // 5. Split a task's total time into session-length chunks
    // -------------------------------------------------------------
    std::vector<int> splitTask(int totalMinutes, int sessionLengthMinutes) const {
        std::vector<int> chunks;
        int remaining = totalMinutes;
        while (remaining > 0) {
            int chunk = std::min(sessionLengthMinutes, remaining);
            chunks.push_back(chunk);
            remaining -= chunk;
        }
        if (chunks.empty()) chunks.push_back(0); // defensive: zero-length task
        return chunks;
    }

    // -------------------------------------------------------------
    // 6. Build one finalized schedule record
    // -------------------------------------------------------------
    ScheduledSession createSchedule(const Task& task, const TimeSlot& slot, int minutes,
                                     int startPage, int endPage, int partNumber, int totalParts) const {
        ScheduledSession s;
        s.taskId = task.id;
        s.taskName = task.name;
        s.dayLabel = slot.dayLabel;
        s.dayIndex = slot.dayIndex;
        s.startMinutes = slot.startMinutes;
        s.endMinutes = slot.startMinutes + minutes;
        s.startPage = startPage;
        s.endPage = endPage;
        s.partNumber = partNumber;
        s.totalParts = totalParts;
        return s;
    }

    const std::vector<std::string>& unscheduledWarnings() const { return unscheduledWarnings_; }

private:
    // Combines priority, deadline urgency, and difficulty into one score.
    // Weights are just reasonable defaults for sample data — tune freely.
    double taskScore(const Task& task) const {
        constexpr double kPriorityWeight = 1.0;
        constexpr double kUrgencyWeight = 40.0;
        constexpr double kDifficultyWeight = 0.5;

        int daysUntilDeadline = std::max(task.deadlineDayIndex, 0);
        double urgency = 1.0 / (daysUntilDeadline + 1); // closer deadline -> bigger number

        return task.priority * kPriorityWeight +
               urgency * kUrgencyWeight +
               task.difficulty * kDifficultyWeight;
    }

    std::vector<Task> tasks_;
    std::vector<TimeSlot> availableSlots_;
    SchedulerConfig config_;
    std::vector<std::string> unscheduledWarnings_;
};

// ---------------------------------------------------------------------
// Demo / sample data, matching the spec's example:
//   Logical Operators: 50 min, priority 80, pages 7-10
//   Truth Tables:       100 min (splits into two 50-min sessions), pages 11-18
//   Monday 6-9 PM, Tuesday 7-10 PM available, 50-min sessions, 10-min breaks,
//   120-minute daily cap.
// ---------------------------------------------------------------------

static void printSchedule(const std::vector<ScheduledSession>& schedule) {
    std::string lastDay;
    for (const auto& s : schedule) {
        if (s.dayLabel != lastDay) {
            std::cout << "\n" << s.dayLabel << "\n";
            lastDay = s.dayLabel;
        }
        std::cout << minutesToClock(s.startMinutes) << " - " << minutesToClock(s.endMinutes)
                   << "\n" << s.taskName;
        if (s.totalParts > 1) {
            std::cout << " (Part " << s.partNumber << "/" << s.totalParts << ")";
        }
        std::cout << "\n";
        if (s.startPage >= 0) {
            std::cout << "Pages " << s.startPage << "-" << s.endPage << "\n";
        }
        std::cout << "\n";
    }
}

int main() {
    std::vector<Task> tasks = {
        {"task_logical_operators", "Logical Operators", 50, /*priority=*/80,
         /*deadlineDayIndex=*/2, /*difficulty=*/3, /*startPage=*/7, /*endPage=*/10},
        {"task_truth_tables", "Truth Tables", 100, /*priority=*/70,
         /*deadlineDayIndex=*/3, /*difficulty=*/5, /*startPage=*/11, /*endPage=*/18},
    };

    std::vector<TimeSlot> slots = {
        {"Monday", 0, 18 * 60, 21 * 60},   // 6:00 PM - 9:00 PM
        {"Tuesday", 1, 19 * 60, 22 * 60},  // 7:00 PM - 10:00 PM
    };

    SchedulerConfig config{/*sessionLengthMinutes=*/50, /*breakLengthMinutes=*/10,
                            /*maxDailyMinutes=*/120};

    Scheduler scheduler(tasks, slots, config);
    std::vector<ScheduledSession> schedule = scheduler.generateSchedule();

    printSchedule(schedule);

    for (const auto& warning : scheduler.unscheduledWarnings()) {
        std::cout << "WARNING: " << warning << "\n";
    }

    return 0;
}

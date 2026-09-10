// scheduler.cpp
//
// Generates a study schedule from a set of tasks and a set of available
// time windows. No UI / database code here — pure scheduling algorithm.
//
// dayIndex = days from today (0 = today, 1 = tomorrow, ...). Callers
// convert real calendar dates into this before calling in.
//
// Every study session is exactly sessionLengthMinutes long - the user's
// preferred session length, never a leftover sliver. All page-range tasks
// from the same material form one continuous, page-ordered stream of
// reading that gets cut into sessions, so:
//   - a session can cover several short sections back to back (e.g.
//     pages 4-4 and 5-18 in one 50-minute session), instead of a 1-page
//     section becoming its own 5-minute session;
//   - a long section can span several sessions;
//   - pages of one material are always studied in order, whatever the
//     individual sections' priorities are.
// A session never mixes two different materials. Tasks without a page
// range or material (e.g. custom tasks) are streams of their own.

#include <algorithm>
#include <iostream>
#include <limits>
#include <map>
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

    // Which PDF/material this task's section came from (empty if none).
    // Tasks sharing a materialId are scheduled as one page-ordered stream.
    std::string materialId;

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
    int sessionLengthMinutes;   // length of every study session
    int breakLengthMinutes;     // break inserted after each session
    int maxDailyMinutes;        // cap on total *study* minutes per day (breaks excluded)
};

// ---------------------------------------------------------------------
// Output data structure — one task's share of one session. A session
// covering several tasks produces one of these per task, all with the
// same day/start/end.
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
    int partNumber;       // 1-based; >1 means this task spans several sessions
    int totalParts;
};

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

        const int sessionLength = config_.sessionLengthMinutes;
        if (sessionLength <= 0) {
            unscheduledWarnings_.push_back("Session length must be greater than 0 - nothing was scheduled");
            return schedule;
        }
        if (sessionLength > config_.maxDailyMinutes) {
            unscheduledWarnings_.push_back(
                "Session length (" + std::to_string(sessionLength) + " min) is longer than the daily study limit (" +
                std::to_string(config_.maxDailyMinutes) + " min) - no session can be scheduled");
        }

        std::vector<std::vector<PlannedSession>> streamSessions;
        for (const std::vector<int>& stream : buildStreams()) {
            streamSessions.push_back(planStreamSessions(stream, sessionLength));
        }
        std::vector<PlannedSession> ordered = mergeStreams(streamSessions);

        // Working copies we consume from as sessions get placed.
        std::vector<TimeSlot> remainingSlots = availableSlots_;
        std::map<int, int> dailyUsedMinutes; // dayIndex -> minutes used so far

        // Every session is the same length and always goes into the
        // earliest slot with room, so sessions land in chronological order
        // exactly as `ordered` lists them - which is what keeps a
        // material's pages in order on the calendar. (Once one session
        // doesn't fit anywhere, no later one can either.)
        for (const PlannedSession& planned : ordered) {
            int slotIdx = findAvailableSlot(remainingSlots, dailyUsedMinutes, sessionLength);
            if (slotIdx == -1) {
                unscheduledWarnings_.push_back(
                    "Could not find room for a " + std::to_string(sessionLength) +
                    "-minute session covering " + describeSession(planned));
                continue;
            }

            TimeSlot& slot = remainingSlots[slotIdx];
            for (const SessionPiece& piece : planned.pieces) {
                schedule.push_back(createSchedule(tasks_[piece.taskIdx], slot, sessionLength,
                                                  piece.startPage, piece.endPage,
                                                  piece.partNumber, piece.totalParts));
            }

            // Consume the session and the break after it. A break that
            // doesn't fit closes the slot rather than letting the next
            // session start with no break at all.
            dailyUsedMinutes[slot.dayIndex] += sessionLength;
            slot.startMinutes += sessionLength;
            slot.startMinutes = std::min(slot.startMinutes + config_.breakLengthMinutes, slot.endMinutes);
        }

        return schedule;
    }

    const std::vector<std::string>& unscheduledWarnings() const { return unscheduledWarnings_; }

private:
    // One task's share of a planned session.
    struct SessionPiece {
        int taskIdx;          // index into tasks_
        int startPage = -1;
        int endPage = -1;
        int partNumber = 1;
        int totalParts = 1;
    };

    // One session-length block of study, before it's given a time slot.
    struct PlannedSession {
        std::vector<SessionPiece> pieces;  // in page order
        double score = 0;                  // highest taskScore among its tasks
    };

    // -------------------------------------------------------------
    // 2. Group tasks into streams: every page-range task of the same
    //    material in one stream, sorted by page; any other task is a
    //    stream of its own. Streams keep the input order of their first
    //    task (the tie-breaker when priorities are equal).
    // -------------------------------------------------------------
    std::vector<std::vector<int>> buildStreams() const {
        std::vector<std::vector<int>> streams;
        std::map<std::string, size_t> streamByMaterial;

        for (int i = 0; i < static_cast<int>(tasks_.size()); ++i) {
            const Task& task = tasks_[i];
            if (task.materialId.empty() || !task.hasPages()) {
                streams.push_back({i});
                continue;
            }
            auto it = streamByMaterial.find(task.materialId);
            if (it == streamByMaterial.end()) {
                streamByMaterial[task.materialId] = streams.size();
                streams.push_back({i});
            } else {
                streams[it->second].push_back(i);
            }
        }

        for (std::vector<int>& stream : streams) {
            std::stable_sort(stream.begin(), stream.end(), [this](int a, int b) {
                if (tasks_[a].startPage != tasks_[b].startPage) return tasks_[a].startPage < tasks_[b].startPage;
                return tasks_[a].endPage < tasks_[b].endPage;
            });
        }
        return streams;
    }

    // -------------------------------------------------------------
    // 3. Cut one stream into sessions of exactly `sessionLength` minutes.
    //
    // The stream's total estimated time T becomes round(T / sessionLength)
    // sessions (at least one), and the reading is spread evenly across
    // them: session k covers stream minutes [k*T/n, (k+1)*T/n). Each
    // task's pages are split in proportion to its minutes, so every page
    // lands in exactly one session and pages never go backwards.
    //
    // Positions are kept in units of 1/n minute so all the boundaries are
    // exact integers (no floating-point drift between sessions).
    // -------------------------------------------------------------
    std::vector<PlannedSession> planStreamSessions(const std::vector<int>& stream, int sessionLength) const {
        std::vector<long long> taskStart, taskLength; // scaled
        long long total = 0;
        for (int idx : stream) total += std::max(tasks_[idx].estimatedMinutes, 1);

        long long n = std::max<long long>(1, (2 * total + sessionLength) / (2LL * sessionLength));

        long long cursor = 0;
        for (int idx : stream) {
            long long m = std::max(tasks_[idx].estimatedMinutes, 1) * n;
            taskStart.push_back(cursor);
            taskLength.push_back(m);
            cursor += m;
        }
        // Stream end == total * n; session s covers [s*total, (s+1)*total).

        std::vector<PlannedSession> sessions(static_cast<size_t>(n));

        for (size_t k = 0; k < stream.size(); ++k) {
            const Task& task = tasks_[stream[k]];
            long long begin = taskStart[k];
            long long end = begin + taskLength[k];

            for (long long s = begin / total; s <= (end - 1) / total; ++s) {
                long long lo = std::max(begin, s * total);
                long long hi = std::min(end, (s + 1) * total);

                SessionPiece piece;
                piece.taskIdx = stream[k];
                if (task.hasPages()) {
                    int from = pageOffsetAt(lo, begin, taskLength[k], task.pageCount());
                    int to = pageOffsetAt(hi, begin, taskLength[k], task.pageCount());
                    if (to <= from) continue; // rounds to no whole page; neighbours cover it
                    piece.startPage = task.startPage + from;
                    piece.endPage = task.startPage + to - 1;
                }
                sessions[static_cast<size_t>(s)].pieces.push_back(piece);
            }
        }

        // A session can round to zero whole pages when a section's time
        // estimate is long relative to its page count (e.g. one page
        // estimated at 3 hours). It's still real study time - keep it on
        // the page the stream is at when that session starts.
        for (long long s = 0; s < n; ++s) {
            PlannedSession& session = sessions[static_cast<size_t>(s)];
            if (!session.pieces.empty()) continue;
            long long at = s * total;
            size_t k = 0;
            while (k + 1 < stream.size() && taskStart[k] + taskLength[k] <= at) ++k;
            const Task& task = tasks_[stream[k]];
            SessionPiece piece;
            piece.taskIdx = stream[k];
            if (task.hasPages()) {
                long long offset = (at - taskStart[k]) * task.pageCount() / taskLength[k];
                int page = task.startPage + static_cast<int>(std::min<long long>(offset, task.pageCount() - 1));
                piece.startPage = page;
                piece.endPage = page;
            }
            session.pieces.push_back(piece);
        }

        // Part numbers per task (a task spanning 3 sessions is part 1/3,
        // 2/3, 3/3), and each session's score for ordering.
        std::map<int, int> piecesPerTask;
        for (const PlannedSession& session : sessions) {
            for (const SessionPiece& piece : session.pieces) ++piecesPerTask[piece.taskIdx];
        }
        std::map<int, int> seenPerTask;
        for (PlannedSession& session : sessions) {
            session.score = std::numeric_limits<double>::lowest();
            for (SessionPiece& piece : session.pieces) {
                piece.partNumber = ++seenPerTask[piece.taskIdx];
                piece.totalParts = piecesPerTask[piece.taskIdx];
                session.score = std::max(session.score, taskScore(tasks_[piece.taskIdx]));
            }
        }
        return sessions;
    }

    // Whole pages of a task completed by scaled stream position `at`
    // (rounded half up), for a task occupying [begin, begin + length).
    static int pageOffsetAt(long long at, long long begin, long long length, int pageCount) {
        return static_cast<int>((2 * (at - begin) * pageCount + length) / (2 * length));
    }

    // -------------------------------------------------------------
    // 4. Merge all streams into one session order: always take the
    //    stream whose next session is most important, so urgent work goes
    //    first while each stream's own sessions stay in page order. A
    //    session counts as important as anything after it in its stream
    //    (you can't reach an urgent later chapter without reading the
    //    pages before it). Ties go to the stream listed first.
    // -------------------------------------------------------------
    std::vector<PlannedSession> mergeStreams(std::vector<std::vector<PlannedSession>>& streams) const {
        std::vector<std::vector<double>> effective(streams.size());
        for (size_t i = 0; i < streams.size(); ++i) {
            effective[i].resize(streams[i].size());
            double best = std::numeric_limits<double>::lowest();
            for (size_t j = streams[i].size(); j-- > 0;) {
                best = std::max(best, streams[i][j].score);
                effective[i][j] = best;
            }
        }

        std::vector<size_t> next(streams.size(), 0);
        std::vector<PlannedSession> ordered;
        while (true) {
            int pick = -1;
            for (size_t i = 0; i < streams.size(); ++i) {
                if (next[i] >= streams[i].size()) continue;
                if (pick == -1 || effective[i][next[i]] > effective[pick][next[pick]]) {
                    pick = static_cast<int>(i);
                }
            }
            if (pick == -1) break;
            ordered.push_back(std::move(streams[pick][next[pick]++]));
        }
        return ordered;
    }

    // -------------------------------------------------------------
    // 5. Find the first available slot with room for `neededMinutes`
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
            if (slot.endMinutes - slot.startMinutes >= neededMinutes) return i;
        }
        return -1;
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

    std::string describeSession(const PlannedSession& session) const {
        std::string out;
        for (const SessionPiece& piece : session.pieces) {
            if (!out.empty()) out += ", ";
            out += tasks_[piece.taskIdx].name;
            if (piece.startPage >= 0) {
                out += " (pages " + std::to_string(piece.startPage) + "-" + std::to_string(piece.endPage) + ")";
            }
        }
        return out;
    }

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
// CLI mode - same "engine as a small stdin/stdout filter" pattern as
// sectionTaskManager.cpp / studyTracker.cpp: no DB/JSON code here,
// Node.js (backend/routes/schedule.js) owns all I/O and just pipes
// real task/time-slot rows in and reads scheduled sessions back out.
//
// Input (stdin, one record per line, pipe-delimited; any order):
//   CONFIG|sessionLengthMinutes|breakLengthMinutes|maxDailyMinutes
//   TASK|id|name|estimatedMinutes|priority|deadlineDayIndex|difficulty|startPage|endPage|materialId
//   SLOT|dayLabel|dayIndex|startMinutes|endMinutes
// materialId may be empty (two consecutive pipes).
//
// Output (stdout, one line per task per session, key=value):
//   task_id=<id> day_index=<n> day_label=<label> start_minutes=<n>
//   end_minutes=<n> start_page=<n> end_page=<n> part=<n> total_parts=<n>
// A session covering several tasks prints one line per task, all with the
// same day_index/start_minutes/end_minutes.
// Sessions that couldn't be placed are reported as: warning=<message>
//
// Build:
//   g++ -std=c++17 -O2 -o scheduler cpp_engine/scheduler.cpp
//
// Run (manual test):
//   printf "CONFIG|50|10|120\nTASK|1|Logical Operators|50|80|2|3|7|10\nSLOT|Monday|0|1080|1260\n" | ./scheduler
// ---------------------------------------------------------------------

static std::vector<std::string> splitPipeDelimited(const std::string& line) {
    std::vector<std::string> fields;
    std::stringstream ss(line);
    std::string field;
    while (std::getline(ss, field, '|')) {
        fields.push_back(field);
    }
    return fields;
}

static std::string trimLineEndings(const std::string& rawLine) {
    std::string line = rawLine;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
        line.pop_back();
    }
    return line;
}

int main() {
    SchedulerConfig config{/*sessionLengthMinutes=*/50, /*breakLengthMinutes=*/10,
                            /*maxDailyMinutes=*/120};
    std::vector<Task> tasks;
    std::vector<TimeSlot> slots;

    std::string rawLine;
    while (std::getline(std::cin, rawLine)) {
        std::string line = trimLineEndings(rawLine);
        if (line.empty()) continue;

        std::vector<std::string> fields = splitPipeDelimited(line);
        if (fields.empty()) continue;

        try {
            if (fields[0] == "CONFIG" && fields.size() >= 4) {
                config.sessionLengthMinutes = std::stoi(fields[1]);
                config.breakLengthMinutes = std::stoi(fields[2]);
                config.maxDailyMinutes = std::stoi(fields[3]);
            } else if (fields[0] == "TASK" && fields.size() >= 9) {
                Task task;
                task.id = fields[1];
                task.name = fields[2];
                task.estimatedMinutes = std::stoi(fields[3]);
                task.priority = std::stoi(fields[4]);
                task.deadlineDayIndex = std::stoi(fields[5]);
                task.difficulty = std::stoi(fields[6]);
                task.startPage = std::stoi(fields[7]);
                task.endPage = std::stoi(fields[8]);
                // materialId is optional (field 9) for backward compatibility
                // with older callers/sample data that don't send it yet.
                task.materialId = (fields.size() >= 10) ? fields[9] : "";
                tasks.push_back(task);
            } else if (fields[0] == "SLOT" && fields.size() >= 5) {
                TimeSlot slot;
                slot.dayLabel = fields[1];
                slot.dayIndex = std::stoi(fields[2]);
                slot.startMinutes = std::stoi(fields[3]);
                slot.endMinutes = std::stoi(fields[4]);
                slots.push_back(slot);
            }
            // Unknown record types / malformed lines are skipped rather
            // than aborting the whole batch, same tolerance as the other
            // engines.
        } catch (const std::exception&) {
            continue;
        }
    }

    Scheduler scheduler(tasks, slots, config);
    std::vector<ScheduledSession> schedule = scheduler.generateSchedule();

    for (const auto& s : schedule) {
        std::cout
            << "task_id=" << s.taskId
            << " day_index=" << s.dayIndex
            << " day_label=" << s.dayLabel
            << " start_minutes=" << s.startMinutes
            << " end_minutes=" << s.endMinutes
            << " start_page=" << s.startPage
            << " end_page=" << s.endPage
            << " part=" << s.partNumber
            << " total_parts=" << s.totalParts
            << "\n";
    }

    for (const auto& warning : scheduler.unscheduledWarnings()) {
        std::cout << "warning=" << warning << "\n";
    }

    std::cerr << "scheduler: scheduled " << schedule.size() << " session piece(s) from "
               << tasks.size() << " task(s) into " << slots.size() << " slot(s)\n";

    return 0;
}

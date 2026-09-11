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
//
// Exception: when the user typed a duration themselves (a custom task, or
// a section whose minutes they edited), that stream keeps its exact total
// minutes - full-length sessions, then one shorter final session for the
// remainder - instead of being rounded to whole sessions.
//
// Lecture files of the same course are studied one after another: a
// course's next PDF (in upload order) only starts once every section of
// the previous one has been scheduled.
//
// Different courses take turns (HTML, CSS, Networking, HTML, ...) so no
// single course fills the calendar while the others wait; a course with
// work due within kUrgentDays days gets extra turns until that work is in.

#include <algorithm>
#include <cctype>
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

    // True when the user set this task's duration themselves. A stream
    // containing one keeps its exact total minutes - see
    // planStreamSessions().
    bool exactMinutes = false;

    // Course the task belongs to. All PDFs of one course are scheduled in
    // sequence (one file finished before the next starts) - see buildChains().
    std::string courseId;

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

        // Each chain's sessions, in the order they must be studied.
        std::vector<std::vector<int>> streams = buildStreams();
        std::vector<std::vector<PlannedSession>> chainSessions;
        // What takes turns: a course's PDFs take one turn together (they're
        // studied one after another anyway); every other task - e.g. each
        // custom task, even though they all live in the same "Personal
        // Tasks" course - is a subject of its own and takes its own turn.
        std::vector<std::string> chainCourse;
        for (const std::vector<int>& chain : buildChains(streams)) {
            const Task& first = tasks_[streams[chain.front()].front()];
            const bool pdfCourse = !first.materialId.empty() && first.hasPages() && !first.courseId.empty();
            chainCourse.push_back(pdfCourse ? first.courseId : "#" + std::to_string(chainSessions.size()));
            chainSessions.emplace_back();
            for (int streamIdx : chain) {
                for (PlannedSession& session : planStreamSessions(streams[streamIdx], sessionLength)) {
                    session.chain = static_cast<int>(chainSessions.size()) - 1;
                    chainSessions.back().push_back(std::move(session));
                }
            }
        }
        std::vector<PlannedSession> ordered = mergeChains(chainSessions, chainCourse);

        // Working copies we consume from as sessions get placed.
        std::vector<TimeSlot> remainingSlots = availableSlots_;
        std::map<int, int> dailyUsedMinutes; // dayIndex -> minutes used so far

        // Sessions land on the calendar strictly in `ordered` order: each
        // goes into the earliest slot with room that starts no earlier than
        // where the previous session ended. Sessions aren't all the same
        // length (a custom task's shorter last session), so "earliest slot
        // with room" alone could drop a short session into a gap before a
        // longer one placed earlier - putting pages out of order. And once
        // a session can't be placed, the rest of its chain is skipped too,
        // so later pages - or a course's next file - never get scheduled
        // ahead of missing ones.
        int minDay = std::numeric_limits<int>::min();
        int minStart = 0;
        std::vector<bool> chainBlocked(chainSessions.size(), false);

        for (const PlannedSession& planned : ordered) {
            int slotIdx = chainBlocked[planned.chain]
                ? -1
                : findAvailableSlot(remainingSlots, dailyUsedMinutes, planned.minutes, minDay, minStart);
            if (slotIdx == -1) {
                chainBlocked[planned.chain] = true;
                unscheduledWarnings_.push_back(
                    "Could not find room for a " + std::to_string(planned.minutes) +
                    "-minute session covering " + describeSession(planned));
                continue;
            }

            TimeSlot& slot = remainingSlots[slotIdx];
            for (const SessionPiece& piece : planned.pieces) {
                schedule.push_back(createSchedule(tasks_[piece.taskIdx], slot, planned.minutes,
                                                  piece.startPage, piece.endPage,
                                                  piece.partNumber, piece.totalParts));
            }

            // Consume the session and the break after it. A break that
            // doesn't fit closes the slot rather than letting the next
            // session start with no break at all.
            minDay = slot.dayIndex;
            minStart = slot.startMinutes + planned.minutes;
            dailyUsedMinutes[slot.dayIndex] += planned.minutes;
            slot.startMinutes += planned.minutes;
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

    // One block of study, before it's given a time slot.
    struct PlannedSession {
        std::vector<SessionPiece> pieces;  // in page order
        int minutes = 0;                   // session length (shorter only for an exact stream's last one)
        int chain = 0;                     // which chain (course sequence) it belongs to
        int deadline = std::numeric_limits<int>::max(); // earliest deadlineDayIndex among its tasks
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
    // 2b. Group streams into chains that are studied one after another:
    //    all PDFs of the same course, in upload order - a course's next
    //    lecture file only starts once the previous one is finished. Any
    //    other stream (e.g. a custom task) is a chain of its own. Chains
    //    keep the input order of their first stream (the tie-breaker).
    // -------------------------------------------------------------
    std::vector<std::vector<int>> buildChains(const std::vector<std::vector<int>>& streams) const {
        std::vector<std::vector<int>> chains;
        std::map<std::string, size_t> chainByCourse;

        for (int i = 0; i < static_cast<int>(streams.size()); ++i) {
            const Task& first = tasks_[streams[i].front()];
            if (first.materialId.empty() || !first.hasPages() || first.courseId.empty()) {
                chains.push_back({i});
                continue;
            }
            auto it = chainByCourse.find(first.courseId);
            if (it == chainByCourse.end()) {
                chainByCourse[first.courseId] = chains.size();
                chains.push_back({i});
            } else {
                chains[it->second].push_back(i);
            }
        }

        for (std::vector<int>& chain : chains) {
            std::stable_sort(chain.begin(), chain.end(), [&](int a, int b) {
                return materialLess(tasks_[streams[a].front()].materialId, tasks_[streams[b].front()].materialId);
            });
        }
        return chains;
    }

    // Upload order of two materials. Their ids are database ids, so compare
    // them as numbers when both are ("9" before "10").
    static bool materialLess(const std::string& a, const std::string& b) {
        auto isNumber = [](const std::string& s) {
            return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
        };
        if (isNumber(a) && isNumber(b) && a.size() != b.size()) return a.size() < b.size();
        return a < b;
    }

    // -------------------------------------------------------------
    // 3. Cut one stream into sessions.
    //
    // Normally every session is exactly `sessionLength` minutes: the
    // stream's total estimated time T becomes round(T / sessionLength)
    // sessions (at least one), and the reading is spread evenly across
    // them - session k covers stream minutes [k*T/n, (k+1)*T/n).
    //
    // If the user set any duration in the stream themselves, T is kept
    // exactly instead: ceil(T / sessionLength) sessions, all full length
    // except the last, which gets the remainder (70 min -> 50 + 20).
    //
    // Either way each task's pages are split in proportion to its minutes,
    // so every page lands in exactly one session and pages never go
    // backwards. Positions are kept in units of 1/scale minute so all the
    // boundaries are exact integers (no floating-point drift).
    // -------------------------------------------------------------
    std::vector<PlannedSession> planStreamSessions(const std::vector<int>& stream, int sessionLength) const {
        long long total = 0;
        bool exact = false;
        for (int idx : stream) {
            total += std::max(tasks_[idx].estimatedMinutes, 1);
            exact = exact || tasks_[idx].exactMinutes;
        }

        long long n, scale;
        std::vector<long long> bounds; // session s covers [bounds[s], bounds[s+1]), scaled
        if (exact) {
            n = (total + sessionLength - 1) / sessionLength;
            scale = 1;
            for (long long s = 0; s <= n; ++s) bounds.push_back(std::min(s * sessionLength, total));
        } else {
            n = std::max<long long>(1, (2 * total + sessionLength) / (2LL * sessionLength));
            scale = n;
            for (long long s = 0; s <= n; ++s) bounds.push_back(s * total);
        }

        std::vector<long long> taskStart, taskLength; // scaled
        long long cursor = 0;
        for (int idx : stream) {
            long long m = std::max(tasks_[idx].estimatedMinutes, 1) * scale;
            taskStart.push_back(cursor);
            taskLength.push_back(m);
            cursor += m;
        }

        std::vector<PlannedSession> sessions(static_cast<size_t>(n));
        for (long long s = 0; s < n; ++s) {
            sessions[static_cast<size_t>(s)].minutes =
                exact ? static_cast<int>(bounds[s + 1] - bounds[s]) : sessionLength;
        }

        for (size_t k = 0; k < stream.size(); ++k) {
            const Task& task = tasks_[stream[k]];
            long long begin = taskStart[k];
            long long end = begin + taskLength[k];

            for (long long s = 0; s < n; ++s) {
                long long lo = std::max(begin, bounds[s]);
                long long hi = std::min(end, bounds[s + 1]);
                if (hi <= lo) continue;

                SessionPiece piece;
                piece.taskIdx = stream[k];
                if (task.hasPages()) {
                    int from = pageOffsetAt(lo, begin, taskLength[k], task.pageCount());
                    int to = pageOffsetAt(hi, begin, taskLength[k], task.pageCount());
                    if (to <= from) {
                        // Less than a whole page of this task falls in this
                        // session. A rounding sliver is dropped (neighbours
                        // cover the page), but real study time - e.g. a
                        // 1-page section the user set to 90 minutes running
                        // into a second session - stays listed, on the page
                        // it's at.
                        if (hi - lo < kMinPieceMinutes * scale) continue;
                        from = static_cast<int>(std::min<long long>(
                            (lo - begin) * task.pageCount() / taskLength[k], task.pageCount() - 1));
                        to = from + 1;
                    }
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
            long long at = bounds[s];
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
                session.deadline = std::min(session.deadline, tasks_[piece.taskIdx].deadlineDayIndex);
            }
        }
        return sessions;
    }

    // Shortest share of a session (in minutes) that's listed for a task
    // when it doesn't reach a whole new page.
    static constexpr long long kMinPieceMinutes = 10;

    // Work due within this many days gets extra turns - see mergeChains().
    static constexpr int kUrgentDays = 3;

    // Whole pages of a task completed by scaled stream position `at`
    // (rounded half up), for a task occupying [begin, begin + length).
    static int pageOffsetAt(long long at, long long begin, long long length, int pageCount) {
        return static_cast<int>((2 * (at - begin) * pageCount + length) / (2 * length));
    }

    // -------------------------------------------------------------
    // 4. Merge all chains into one session order.
    //
    //    Courses take turns: the next session goes to the course that has
    //    waited longest since its last turn, so HTML, CSS and Networking
    //    alternate instead of one course filling the calendar first. Each
    //    chain's own sessions stay in order (pages in order, and a course's
    //    files one after another).
    //
    //    Urgent work gets extra turns: while any course has a session due
    //    within kUrgentDays days, those sessions go first, closest deadline
    //    first. A session counts as due as early as anything after it in its
    //    chain (the pages before an urgent chapter have to come first).
    //
    //    Ties go to the more important session (priority/urgency/difficulty
    //    score, again counting what follows it), then to the chain listed
    //    first.
    // -------------------------------------------------------------
    std::vector<PlannedSession> mergeChains(std::vector<std::vector<PlannedSession>>& chains,
                                            const std::vector<std::string>& chainCourse) const {
        std::vector<std::vector<double>> score(chains.size());
        std::vector<std::vector<int>> dueBy(chains.size());
        for (size_t i = 0; i < chains.size(); ++i) {
            score[i].resize(chains[i].size());
            dueBy[i].resize(chains[i].size());
            double best = std::numeric_limits<double>::lowest();
            int soonest = std::numeric_limits<int>::max();
            for (size_t j = chains[i].size(); j-- > 0;) {
                best = std::max(best, chains[i][j].score);
                soonest = std::min(soonest, chains[i][j].deadline);
                score[i][j] = best;
                dueBy[i][j] = soonest;
            }
        }

        std::map<std::string, long long> lastTurn; // course -> turn number of its latest session
        auto turnOf = [&](size_t i) {
            auto it = lastTurn.find(chainCourse[i]);
            return it == lastTurn.end() ? -1LL : it->second;
        };
        std::vector<size_t> next(chains.size(), 0);

        // Is chain a's next session a better pick than chain b's?
        auto better = [&](size_t a, size_t b) {
            const int dueA = dueBy[a][next[a]], dueB = dueBy[b][next[b]];
            const bool urgentA = dueA <= kUrgentDays, urgentB = dueB <= kUrgentDays;
            if (urgentA != urgentB) return urgentA;
            if (urgentA && dueA != dueB) return dueA < dueB;
            const long long turnA = turnOf(a), turnB = turnOf(b);
            if (turnA != turnB) return turnA < turnB;
            return score[a][next[a]] > score[b][next[b]];
        };

        std::vector<PlannedSession> ordered;
        for (long long turn = 0;; ++turn) {
            int pick = -1;
            for (size_t i = 0; i < chains.size(); ++i) {
                if (next[i] >= chains[i].size()) continue;
                if (pick == -1 || better(i, static_cast<size_t>(pick))) pick = static_cast<int>(i);
            }
            if (pick == -1) break;
            lastTurn[chainCourse[pick]] = turn;
            ordered.push_back(std::move(chains[pick][next[pick]++]));
        }
        return ordered;
    }

    // -------------------------------------------------------------
    // 5. Find the first available slot with room for `neededMinutes`
    //    that starts no earlier than (minDay, minStart).
    //    Returns an index into `slots`, or -1 if none fits.
    // -------------------------------------------------------------
    int findAvailableSlot(const std::vector<TimeSlot>& slots,
                           const std::map<int, int>& dailyUsedMinutes,
                           int neededMinutes, int minDay, int minStart) const {
        for (int i = 0; i < static_cast<int>(slots.size()); ++i) {
            const TimeSlot& slot = slots[i];
            if (slot.dayIndex < minDay || (slot.dayIndex == minDay && slot.startMinutes < minStart)) continue;

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
//   TASK|id|name|estimatedMinutes|priority|deadlineDayIndex|difficulty|startPage|endPage|materialId|exactMinutes|courseId
//   SLOT|dayLabel|dayIndex|startMinutes|endMinutes
// materialId may be empty (two consecutive pipes). exactMinutes is 1 when
// the user set the task's duration themselves (optional, default 0).
// courseId (optional) puts a course's PDFs in sequence, in materialId order.
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
                task.exactMinutes = (fields.size() >= 11) && fields[10] == "1";
                task.courseId = (fields.size() >= 12) ? fields[11] : "";
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

// scheduler.cpp - builds the study schedule from tasks and free time slots.
// Sessions are the preferred length, PDFs go in page order, courses take turns.

#include <algorithm>
#include <cctype>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <string>
#include <vector>

struct Task {
    std::string id;
    std::string name;
    int estimatedMinutes;
    int priority;
    int deadlineDayIndex;   // days from today
    int difficulty = 0;
    int startPage = -1;
    int endPage = -1;
    std::string materialId;
    bool exactMinutes = false;  // user-set duration, kept exact
    std::string courseId;

    bool hasPages() const { return startPage >= 0 && endPage >= startPage; }
    int pageCount() const { return hasPages() ? (endPage - startPage + 1) : 0; }
};

struct TimeSlot {
    std::string dayLabel;
    int dayIndex;           // days from today
    int startMinutes;       // minutes since midnight
    int endMinutes;
};

struct SchedulerConfig {
    int sessionLengthMinutes;
    int breakLengthMinutes;
    int maxDailyMinutes;        // study minutes per day, breaks excluded
};

// One task's share of one session; a session covering several tasks yields several.
struct ScheduledSession {
    std::string taskId;
    std::string taskName;
    std::string dayLabel;
    int dayIndex;
    int startMinutes;
    int endMinutes;
    int startPage = -1;
    int endPage = -1;
    int partNumber;
    int totalParts;
};

class Scheduler {
public:
    Scheduler(std::vector<Task> tasks,
               std::vector<TimeSlot> availableSlots,
               SchedulerConfig config)
        : tasks_(std::move(tasks)),
          availableSlots_(std::move(availableSlots)),
          config_(config) {
        std::sort(availableSlots_.begin(), availableSlots_.end(),
                  [](const TimeSlot& a, const TimeSlot& b) {
                      if (a.dayIndex != b.dayIndex) return a.dayIndex < b.dayIndex;
                      return a.startMinutes < b.startMinutes;
                  });
    }

    // Plans each chain's sessions, merges them into one order, then places each in the
    // earliest slot after the previous one; once a chain's session doesn't fit, the rest waits.
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

        std::vector<std::vector<int>> streams = buildStreams();
        std::vector<std::vector<PlannedSession>> chainSessions;
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

        std::vector<TimeSlot> remainingSlots = availableSlots_;
        std::map<int, int> dailyUsedMinutes;

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

    // A block of study before it gets a time slot.
    struct PlannedSession {
        std::vector<SessionPiece> pieces;
        int minutes = 0;                   // shorter only for an exact stream's last session
        int chain = 0;
        int deadline = std::numeric_limits<int>::max();
        double score = 0;
    };

    // One stream per material with its tasks in page order; any other task is a
    // stream of its own.
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

    // Chains are studied one after another: a course's PDFs in upload order; any
    // other stream is a chain of its own.
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

    // Upload order: material ids compared as numbers ("9" before "10").
    static bool materialLess(const std::string& a, const std::string& b) {
        auto isNumber = [](const std::string& s) {
            return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
        };
        if (isNumber(a) && isNumber(b) && a.size() != b.size()) return a.size() < b.size();
        return a < b;
    }

    // Cuts a stream into round(T/L) full sessions, or ceil(T/L) with a shorter last one when a
    // duration is user-set; each task's pages are split by its minutes (integer maths, no drift).
    std::vector<PlannedSession> planStreamSessions(const std::vector<int>& stream, int sessionLength) const {
        long long total = 0;
        bool exact = false;
        for (int idx : stream) {
            total += std::max(tasks_[idx].estimatedMinutes, 1);
            exact = exact || tasks_[idx].exactMinutes;
        }

        long long n, scale;
        std::vector<long long> bounds;
        if (exact) {
            n = (total + sessionLength - 1) / sessionLength;
            scale = 1;
            for (long long s = 0; s <= n; ++s) bounds.push_back(std::min(s * sessionLength, total));
        } else {
            n = std::max<long long>(1, (2 * total + sessionLength) / (2LL * sessionLength));
            scale = n;
            for (long long s = 0; s <= n; ++s) bounds.push_back(s * total);
        }

        std::vector<long long> taskStart, taskLength;
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

    // Shortest partial-page share of a session that is still listed.
    static constexpr long long kMinPieceMinutes = 10;

    // Work due within this many days gets extra turns.
    static constexpr int kUrgentDays = 3;

    // Whole pages of a task done at scaled position `at` (rounded half up).
    static int pageOffsetAt(long long at, long long begin, long long length, int pageCount) {
        return static_cast<int>((2 * (at - begin) * pageCount + length) / (2 * length));
    }

    // Courses take turns, longest-waiting first; work due within kUrgentDays goes first
    // (closest deadline first). Each chain's own sessions stay in order.
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

        std::map<std::string, long long> lastTurn;
        auto turnOf = [&](size_t i) {
            auto it = lastTurn.find(chainCourse[i]);
            return it == lastTurn.end() ? -1LL : it->second;
        };
        std::vector<size_t> next(chains.size(), 0);

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

    // Index of the first slot at/after (minDay, minStart) with room left, or -1.
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

    // Priority, deadline urgency and difficulty combined into one number.
    double taskScore(const Task& task) const {
        constexpr double kPriorityWeight = 1.0;
        constexpr double kUrgencyWeight = 40.0;
        constexpr double kDifficultyWeight = 0.5;

        int daysUntilDeadline = std::max(task.deadlineDayIndex, 0);
        double urgency = 1.0 / (daysUntilDeadline + 1);

        return task.priority * kPriorityWeight +
               urgency * kUrgencyWeight +
               task.difficulty * kDifficultyWeight;
    }

    std::vector<Task> tasks_;
    std::vector<TimeSlot> availableSlots_;
    SchedulerConfig config_;
    std::vector<std::string> unscheduledWarnings_;
};

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

// stdin: CONFIG|len|break|dailyMax, TASK|id|name|min|prio|due|diff|p1|p2|material|exact|course, SLOT|label|day|start|end
// stdout: one key=value line per session piece, then warning= lines for sessions that didn't fit.
int main() {
    SchedulerConfig config{50, 10,
                            120};
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

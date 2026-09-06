// ============================================================
//  StudyGPS - cpp_engine/sectionTaskManager.cpp
//
//  Turns the sections detected from a PDF (title, page range,
//  estimated minutes, difficulty) into StudyGPS tasks
//  (priority + status), following the same "engine as a small
//  CLI filter" pattern as studyTracker.cpp / progressReport.cpp:
//  no DB/JSON code in here, Node.js (materials.js) owns I/O.
//
//  Input  (stdin, one section per line, pipe-delimited):
//      section_id|title|start_page|end_page|estimated_minutes|difficulty
//
//  Output (stdout, one task per line, same key=value shape
//  studyTracker.cpp already prints, so the existing Node-side
//  regex-parsing convention just works):
//      section_id=<id> priority=<n> status=Not Started
//
//  Build:
//  g++ -std=c++17 -O2 -o sectionTaskManager cpp_engine/sectionTaskManager.cpp
//
//  Run (manual test):
//  echo "1|Class and Object|2|23|66|1" | ./sectionTaskManager
// ============================================================

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

// ---------------------------------------------------------------------
// Input data structure - mirrors one row coming from the `sections` table
// ---------------------------------------------------------------------

struct SectionInput {
    int         id = 0;
    std::string title;
    int         startPage = 0;
    int         endPage = 0;
    int         estimatedMinutes = 0;
    int         difficulty = 1;

    int pageCount() const {
        return (endPage >= startPage) ? (endPage - startPage + 1) : 0;
    }
};

// ---------------------------------------------------------------------
// Output data structure - one row to insert into the `tasks` table
// ---------------------------------------------------------------------

struct TaskOutput {
    int sectionId = 0;
    int priority = 0;
    std::string status = "Not Started";
};

// ---------------------------------------------------------------------
// Parsing helpers
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

static bool parseSectionLine(const std::string& rawLine, SectionInput& out) {
    // Trim trailing \r (in case input came from a Windows-edited file)
    std::string line = rawLine;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
        line.pop_back();
    }
    if (line.empty()) return false;

    std::vector<std::string> fields = splitPipeDelimited(line);
    if (fields.size() < 6) return false;

    try {
        out.id               = std::stoi(fields[0]);
        out.title            = fields[1];
        out.startPage        = std::stoi(fields[2]);
        out.endPage          = std::stoi(fields[3]);
        out.estimatedMinutes = std::stoi(fields[4]);
        out.difficulty       = std::stoi(fields[5]);
    } catch (const std::exception&) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------
// Section -> Task processing
// ---------------------------------------------------------------------
//
// Priority combines two signals so that longer AND harder sections
// naturally rise to the top of a task list (the actual date/deadline
// scheduling is scheduler.cpp's job, not this file's):
//   - difficulty (1-5 expected, but not enforced) weighted heavily
//   - page count, capped so one very long section can't dominate
//     every other section's priority

class SectionTaskManager {
public:
    static TaskOutput processSection(const SectionInput& section) {
        TaskOutput task;
        task.sectionId = section.id;
        task.priority = computePriority(section);
        task.status = "Not Started";
        return task;
    }

    static int computePriority(const SectionInput& section) {
        constexpr int kDifficultyWeight = 10;
        constexpr int kMaxPagesCounted = 20;

        int difficulty = std::max(section.difficulty, 1);
        int pagesCounted = std::min(section.pageCount(), kMaxPagesCounted);

        return difficulty * kDifficultyWeight + pagesCounted;
    }
};

// ---------------------------------------------------------------------
// main() - read sections from stdin, write tasks to stdout
// ---------------------------------------------------------------------

int main() {
    std::string line;
    int processedCount = 0;

    while (std::getline(std::cin, line)) {
        SectionInput section;
        if (!parseSectionLine(line, section)) {
            // Skip malformed/blank lines rather than aborting the whole
            // batch - Node.js only cares about well-formed output lines.
            continue;
        }

        TaskOutput task = SectionTaskManager::processSection(section);

        std::cout
            << "section_id=" << task.sectionId
            << " priority=" << task.priority
            << " status=" << task.status
            << "\n";

        ++processedCount;
    }

    std::cerr << "sectionTaskManager: processed " << processedCount << " section(s)\n";
    return 0;
}

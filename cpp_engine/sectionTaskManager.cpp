// sectionTaskManager.cpp - turns detected PDF sections into tasks with a priority.
// stdin: id|title|start_page|end_page|minutes|difficulty; stdout: section_id= priority= status= lines.

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

// One row of the sections table.
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

// One row for the tasks table.
struct TaskOutput {
    int sectionId = 0;
    int priority = 0;
    std::string status = "Not Started";
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

// Parses one input line; false for blank or malformed lines.
static bool parseSectionLine(const std::string& rawLine, SectionInput& out) {
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

// Priority = difficulty x 10 + page count (capped at 20), so longer/harder sections rank higher.
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

// Reads sections from stdin and writes one task line each; malformed lines are skipped.
int main() {
    std::string line;
    int processedCount = 0;

    while (std::getline(std::cin, line)) {
        SectionInput section;
        if (!parseSectionLine(line, section)) {
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

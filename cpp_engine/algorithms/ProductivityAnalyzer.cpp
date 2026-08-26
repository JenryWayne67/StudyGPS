#include "ProductivityAnalyzer.h"

#include <algorithm>
#include <set>
#include <string>

namespace studygps {

ProductivityResult ProductivityAnalyzer::analyze(const std::vector<StudySession>& sessions,
                                                 const std::vector<Task>& tasks,
                                                 const std::vector<Quiz>& quizzes) {
    ProductivityResult result;
    std::set<std::string> studyDays;

    for (const auto& session : sessions) {
        result.totalFocusedStudyMinutes += session.getDurationMinutes();
        const auto& startTime = session.getStartTime();
        if (startTime.size() >= 10) studyDays.insert(startTime.substr(0, 10));
    }
    if (!sessions.empty()) {
        result.averageSessionMinutes = static_cast<double>(result.totalFocusedStudyMinutes) / sessions.size();
    }
    if (!tasks.empty()) {
        const auto completed = std::count_if(tasks.begin(), tasks.end(),
                                             [](const Task& task) { return task.isCompleted(); });
        result.taskCompletionRate = 100.0 * completed / tasks.size();
    }
    if (!sessions.empty()) {
        result.consistencyScore = 100.0 * studyDays.size() / sessions.size();
    }
    if (!quizzes.empty()) {
        for (const auto& quiz : quizzes) result.averageQuizScore += quiz.getScorePercent();
        result.averageQuizScore /= quizzes.size();
    }
    return result;
}

}
#include "ReportGenerator.h"

#include <algorithm>
#include <map>

namespace studygps {

AcademicReport ReportGenerator::generate(const std::vector<Course>& courses,
                                         const std::vector<Topic>& topics,
                                         const std::vector<Progress>& progress,
                                         const std::vector<StudySession>& sessions,
                                         const std::vector<Task>& tasks,
                                         const std::vector<Quiz>& quizzes,
                                         const ProductivityResult& productivity) {
    AcademicReport report;
    report.studyHours = productivity.totalFocusedStudyMinutes / 60.0;
    report.completionRate = productivity.taskCompletionRate;
    report.averageQuizScore = productivity.averageQuizScore;

    for (const auto& item : progress) report.averageMastery += item.getMasteryPercent();
    if (!progress.empty()) report.averageMastery /= progress.size();

    for (const auto& topic : topics) {
        if (topic.getMasteryPercent() < 70) report.weakTopics.push_back(topic.getName());
    }

    std::map<std::string, std::vector<int>> courseMastery;
    for (const auto& item : progress) courseMastery[item.getCourseId()].push_back(item.getMasteryPercent());
    struct CourseScore { std::string name; double score; };
    std::vector<CourseScore> scores;
    for (const auto& course : courses) {
        const auto values = courseMastery.find(course.getId());
        if (values == courseMastery.end() || values->second.empty()) continue;
        double score = 0.0;
        for (int value : values->second) score += value;
        scores.push_back({course.getName(), score / values->second.size()});
    }
    if (!scores.empty()) {
        const auto strongest = std::max_element(scores.begin(), scores.end(),
            [](const CourseScore& left, const CourseScore& right) { return left.score < right.score; });
        const auto weakest = std::min_element(scores.begin(), scores.end(),
            [](const CourseScore& left, const CourseScore& right) { return left.score < right.score; });
        report.strongestCourses.push_back(strongest->name);
        report.weakestCourses.push_back(weakest->name);
    }

    if (!report.weakTopics.empty()) report.recommendations.push_back("Schedule review sessions for weak topics");
    if (report.completionRate < 70.0) report.recommendations.push_back("Break unfinished tasks into shorter study blocks");
    if (report.averageQuizScore < 70.0) report.recommendations.push_back("Revisit quiz mistakes before starting new material");
    if (sessions.empty()) report.recommendations.push_back("Record at least one focused study session next week");
    if (tasks.empty() && quizzes.empty()) report.recommendations.push_back("Add tasks and quizzes to measure progress");
    return report;
}

}
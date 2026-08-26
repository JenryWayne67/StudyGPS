#ifndef STUDYGPS_REPORT_GENERATOR_H
#define STUDYGPS_REPORT_GENERATOR_H

#include "ProductivityAnalyzer.h"
#include "../models/Course.h"
#include "../models/Progress.h"
#include "../models/Quiz.h"
#include "../models/StudySession.h"
#include "../models/Task.h"
#include "../models/Topic.h"

#include <string>
#include <vector>

namespace studygps {

struct AcademicReport {
    double studyHours = 0.0;
    double completionRate = 0.0;
    double averageMastery = 0.0;
    double averageQuizScore = 0.0;
    std::vector<std::string> weakTopics;
    std::vector<std::string> strongestCourses;
    std::vector<std::string> weakestCourses;
    std::vector<std::string> recommendations;
};

class ReportGenerator {
public:
    static AcademicReport generate(const std::vector<Course>& courses,
                                   const std::vector<Topic>& topics,
                                   const std::vector<Progress>& progress,
                                   const std::vector<StudySession>& sessions,
                                   const std::vector<Task>& tasks,
                                   const std::vector<Quiz>& quizzes,
                                   const ProductivityResult& productivity);
};

}

#endif
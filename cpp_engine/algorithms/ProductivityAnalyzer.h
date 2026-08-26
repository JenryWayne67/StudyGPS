#ifndef STUDYGPS_PRODUCTIVITY_ANALYZER_H
#define STUDYGPS_PRODUCTIVITY_ANALYZER_H

#include "../models/Quiz.h"
#include "../models/StudySession.h"
#include "../models/Task.h"

#include <vector>

namespace studygps {

struct ProductivityResult {
    int totalFocusedStudyMinutes = 0;
    double averageSessionMinutes = 0.0;
    double taskCompletionRate = 0.0;
    double consistencyScore = 0.0;
    double averageQuizScore = 0.0;
};

class ProductivityAnalyzer {
public:
    static ProductivityResult analyze(const std::vector<StudySession>& sessions,
                                      const std::vector<Task>& tasks,
                                      const std::vector<Quiz>& quizzes);
};

}

#endif
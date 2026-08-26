#ifndef STUDYGPS_REVIEW_SCHEDULER_H
#define STUDYGPS_REVIEW_SCHEDULER_H

#include "../models/Schedule.h"
#include "../models/Task.h"
#include "../models/Topic.h"

#include <string>
#include <vector>

namespace studygps {

struct ReviewRecommendation {
    bool requiresReview = false;
    double reviewScore = 0.0;
    std::string reason;
    Task reviewTask;
    ScheduleEntry scheduleEntry;
};

class ReviewScheduler {
public:
    static constexpr double masteryThreshold = 70.0;

    static ReviewRecommendation evaluate(const Topic& topic, double masteryPercent,
                                         double quizScorePercent, double completionPercent,
                                         const std::vector<std::string>& previousReviewDates);
};

}

#endif
#include "ReviewScheduler.h"

#include <algorithm>
#include <string>

namespace studygps {

ReviewRecommendation ReviewScheduler::evaluate(const Topic& topic, double masteryPercent,
                                               double quizScorePercent, double completionPercent,
                                               const std::vector<std::string>& previousReviewDates) {
    ReviewRecommendation recommendation;
    const double boundedMastery = std::clamp(masteryPercent, 0.0, 100.0);
    const double boundedQuiz = std::clamp(quizScorePercent, 0.0, 100.0);
    const double boundedCompletion = std::clamp(completionPercent, 0.0, 100.0);
    recommendation.reviewScore = 0.50 * boundedMastery + 0.30 * boundedQuiz + 0.20 * boundedCompletion;
    recommendation.requiresReview = recommendation.reviewScore < masteryThreshold;
    if (!recommendation.requiresReview) return recommendation;

    recommendation.reason = "Topic mastery is below the review threshold";
    const std::string taskId = "review-" + topic.getId();
    recommendation.reviewTask = Task(taskId, "Review " + topic.getName(), topic.getCourseId(), 30);
    recommendation.reviewTask.setTopicId(topic.getId());
    recommendation.reviewTask.setPriority(boundedMastery < 40.0 ? TaskPriority::High : TaskPriority::Medium);
    recommendation.scheduleEntry = {"schedule-" + taskId, taskId, "", "", ""};
    if (!previousReviewDates.empty()) {
        recommendation.reason += "; previous review: " + previousReviewDates.back();
    }
    return recommendation;
}

}
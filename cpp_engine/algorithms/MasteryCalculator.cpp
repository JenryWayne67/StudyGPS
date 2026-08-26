#include "MasteryCalculator.h"

#include <algorithm>

namespace studygps {

double MasteryCalculator::calculate(double completionPercent, double quizScorePercent,
                                    double practicePercent) {
    const auto clampPercent = [](double value) {
        return std::clamp(value, 0.0, 100.0);
    };
    return 0.30 * clampPercent(completionPercent)
         + 0.50 * clampPercent(quizScorePercent)
         + 0.20 * clampPercent(practicePercent);
}

}
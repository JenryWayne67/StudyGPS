#ifndef STUDYGPS_MASTERY_CALCULATOR_H
#define STUDYGPS_MASTERY_CALCULATOR_H

namespace studygps {

class MasteryCalculator {
public:
    // Mastery = 30% completion + 50% quiz + 20% practice.
    static double calculate(double completionPercent, double quizScorePercent,
                            double practicePercent);
};

}

#endif
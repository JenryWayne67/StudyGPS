#include "Progress.h"

Progress::Progress() : completedTasks_(0), totalTasks_(0), quizzesTaken_(0), currentStreak_(0), completionPercentage_(0.0) {}

Progress::Progress(int completedTasks, int totalTasks, int quizzesTaken,
                   int currentStreak, double completionPercentage)
    : completedTasks_(completedTasks), totalTasks_(totalTasks), quizzesTaken_(quizzesTaken),
      currentStreak_(currentStreak), completionPercentage_(completionPercentage) {}

int Progress::getCompletedTasks() const {
    return completedTasks_;
}

void Progress::setCompletedTasks(int completedTasks) {
    completedTasks_ = completedTasks;
}

int Progress::getTotalTasks() const {
    return totalTasks_;
}

void Progress::setTotalTasks(int totalTasks) {
    totalTasks_ = totalTasks;
}

int Progress::getQuizzesTaken() const {
    return quizzesTaken_;
}

void Progress::setQuizzesTaken(int quizzesTaken) {
    quizzesTaken_ = quizzesTaken;
}

int Progress::getCurrentStreak() const {
    return currentStreak_;
}

void Progress::setCurrentStreak(int currentStreak) {
    currentStreak_ = currentStreak;
}

double Progress::getCompletionPercentage() const {
    return completionPercentage_;
}

void Progress::setCompletionPercentage(double completionPercentage) {
    completionPercentage_ = completionPercentage;
}

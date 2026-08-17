#pragma once

class Progress {
public:
    Progress();
    Progress(int completedTasks, int totalTasks, int quizzesTaken,
             int currentStreak, double completionPercentage);

    int getCompletedTasks() const;
    void setCompletedTasks(int completedTasks);

    int getTotalTasks() const;
    void setTotalTasks(int totalTasks);

    int getQuizzesTaken() const;
    void setQuizzesTaken(int quizzesTaken);

    int getCurrentStreak() const;
    void setCurrentStreak(int currentStreak);

    double getCompletionPercentage() const;
    void setCompletionPercentage(double completionPercentage);

private:
    int completedTasks_;
    int totalTasks_;
    int quizzesTaken_;
    int currentStreak_;
    double completionPercentage_;
};

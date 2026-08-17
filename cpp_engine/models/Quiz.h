#pragma once

#include <string>

class Quiz {
public:
    Quiz();
    Quiz(int id, const std::string& title, const std::string& topic,
         int totalQuestions, int score, int passingScore);

    int getId() const;
    void setId(int id);

    const std::string& getTitle() const;
    void setTitle(const std::string& title);

    const std::string& getTopic() const;
    void setTopic(const std::string& topic);

    int getTotalQuestions() const;
    void setTotalQuestions(int totalQuestions);

    int getScore() const;
    void setScore(int score);

    int getPassingScore() const;
    void setPassingScore(int passingScore);

    bool isPassed() const;
    void setPassed(bool passed);

private:
    int id_;
    std::string title_;
    std::string topic_;
    int totalQuestions_;
    int score_;
    int passingScore_;
    bool passed_;
};

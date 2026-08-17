#include "Quiz.h"

Quiz::Quiz() : id_(0), title_(""), topic_(""), totalQuestions_(0), score_(0), passingScore_(0), passed_(false) {}

Quiz::Quiz(int id, const std::string& title, const std::string& topic,
           int totalQuestions, int score, int passingScore)
    : id_(id), title_(title), topic_(topic), totalQuestions_(totalQuestions),
      score_(score), passingScore_(passingScore), passed_(score >= passingScore) {}

int Quiz::getId() const {
    return id_;
}

void Quiz::setId(int id) {
    id_ = id;
}

const std::string& Quiz::getTitle() const {
    return title_;
}

void Quiz::setTitle(const std::string& title) {
    title_ = title;
}

const std::string& Quiz::getTopic() const {
    return topic_;
}

void Quiz::setTopic(const std::string& topic) {
    topic_ = topic;
}

int Quiz::getTotalQuestions() const {
    return totalQuestions_;
}

void Quiz::setTotalQuestions(int totalQuestions) {
    totalQuestions_ = totalQuestions;
}

int Quiz::getScore() const {
    return score_;
}

void Quiz::setScore(int score) {
    score_ = score;
    passed_ = score_ >= passingScore_;
}

int Quiz::getPassingScore() const {
    return passingScore_;
}

void Quiz::setPassingScore(int passingScore) {
    passingScore_ = passingScore;
    passed_ = score_ >= passingScore_;
}

bool Quiz::isPassed() const {
    return passed_;
}

void Quiz::setPassed(bool passed) {
    passed_ = passed;
}

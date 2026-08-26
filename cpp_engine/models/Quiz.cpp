#include "Quiz.h"

#include <stdexcept>
#include <utility>

namespace studygps {

Quiz::Quiz(std::string id, std::string courseId, std::string title)
	: id_(std::move(id)), courseId_(std::move(courseId)), title_(std::move(title)) {}
const std::string& Quiz::getId() const { return id_; }
const std::string& Quiz::getCourseId() const { return courseId_; }
const std::string& Quiz::getTopicId() const { return topicId_; }
const std::string& Quiz::getTitle() const { return title_; }
const std::string& Quiz::getAttemptedAt() const { return attemptedAt_; }
int Quiz::getQuestionCount() const { return questionCount_; }
int Quiz::getCorrectAnswers() const { return correctAnswers_; }
double Quiz::getScorePercent() const {
	return questionCount_ == 0 ? 0.0 : (100.0 * correctAnswers_) / questionCount_;
}
void Quiz::setCourseId(const std::string& courseId) { courseId_ = courseId; }
void Quiz::setTopicId(const std::string& topicId) { topicId_ = topicId; }
void Quiz::setTitle(const std::string& title) { title_ = title; }
void Quiz::setAttemptedAt(const std::string& attemptedAt) { attemptedAt_ = attemptedAt; }
void Quiz::setQuestionCount(int count) {
	if (count < 0) throw std::invalid_argument("question count cannot be negative");
	if (correctAnswers_ > count) throw std::invalid_argument("correct answers exceed question count");
	questionCount_ = count;
}
void Quiz::setCorrectAnswers(int correctAnswers) {
	if (correctAnswers < 0 || correctAnswers > questionCount_) {
		throw std::invalid_argument("correct answers must be within question count");
	}
	correctAnswers_ = correctAnswers;
}

}

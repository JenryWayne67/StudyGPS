#ifndef STUDYGPS_QUIZ_H
#define STUDYGPS_QUIZ_H

#include <string>

namespace studygps {

class Quiz {
public:
	Quiz() = default;
	Quiz(std::string id, std::string courseId, std::string title);

	const std::string& getId() const;
	const std::string& getCourseId() const;
	const std::string& getTopicId() const;
	const std::string& getTitle() const;
	const std::string& getAttemptedAt() const;
	int getQuestionCount() const;
	int getCorrectAnswers() const;
	double getScorePercent() const;

	void setCourseId(const std::string& courseId);
	void setTopicId(const std::string& topicId);
	void setTitle(const std::string& title);
	void setAttemptedAt(const std::string& attemptedAt);
	void setQuestionCount(int count);
	void setCorrectAnswers(int correctAnswers);

private:
	std::string id_;
	std::string courseId_;
	std::string topicId_;
	std::string title_;
	std::string attemptedAt_;
	int questionCount_ = 0;
	int correctAnswers_ = 0;
};

}

#endif

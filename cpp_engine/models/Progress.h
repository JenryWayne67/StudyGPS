#ifndef STUDYGPS_PROGRESS_H
#define STUDYGPS_PROGRESS_H

#include <string>

namespace studygps {

class Progress {
public:
	Progress() = default;
	Progress(std::string studentId, std::string courseId);

	const std::string& getStudentId() const;
	const std::string& getCourseId() const;
	const std::string& getTopicId() const;
	int getCompletionPercent() const;
	int getMasteryPercent() const;
	int getCompletedTasks() const;
	int getTotalTasks() const;
	int getStudyMinutes() const;

	void setStudentId(const std::string& studentId);
	void setCourseId(const std::string& courseId);
	void setTopicId(const std::string& topicId);
	void setCompletionPercent(int percent);
	void setMasteryPercent(int percent);
	void setCompletedTasks(int count);
	void setTotalTasks(int count);
	void setStudyMinutes(int minutes);

private:
	std::string studentId_;
	std::string courseId_;
	std::string topicId_;
	int completionPercent_ = 0;
	int masteryPercent_ = 0;
	int completedTasks_ = 0;
	int totalTasks_ = 0;
	int studyMinutes_ = 0;
};

}

#endif

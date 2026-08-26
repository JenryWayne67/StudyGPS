#ifndef STUDYGPS_STUDY_SESSION_H
#define STUDYGPS_STUDY_SESSION_H

#include <string>

namespace studygps {

class StudySession {
public:
	StudySession() = default;
	StudySession(std::string id, std::string studentId, int durationMinutes = 0);

	const std::string& getId() const;
	const std::string& getStudentId() const;
	const std::string& getCourseId() const;
	const std::string& getTopicId() const;
	const std::string& getStartTime() const;
	const std::string& getEndTime() const;
	const std::string& getNotes() const;
	int getDurationMinutes() const;

	void setStudentId(const std::string& studentId);
	void setCourseId(const std::string& courseId);
	void setTopicId(const std::string& topicId);
	void setStartTime(const std::string& startTime);
	void setEndTime(const std::string& endTime);
	void setNotes(const std::string& notes);
	void setDurationMinutes(int minutes);

private:
	std::string id_;
	std::string studentId_;
	std::string courseId_;
	std::string topicId_;
	std::string startTime_;
	std::string endTime_;
	std::string notes_;
	int durationMinutes_ = 0;
};

}

#endif

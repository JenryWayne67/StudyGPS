#include "StudySession.h"

#include <stdexcept>
#include <utility>

namespace studygps {

StudySession::StudySession(std::string id, std::string studentId, int durationMinutes)
	: id_(std::move(id)), studentId_(std::move(studentId)) {
	setDurationMinutes(durationMinutes);
}
const std::string& StudySession::getId() const { return id_; }
const std::string& StudySession::getStudentId() const { return studentId_; }
const std::string& StudySession::getCourseId() const { return courseId_; }
const std::string& StudySession::getTopicId() const { return topicId_; }
const std::string& StudySession::getStartTime() const { return startTime_; }
const std::string& StudySession::getEndTime() const { return endTime_; }
const std::string& StudySession::getNotes() const { return notes_; }
int StudySession::getDurationMinutes() const { return durationMinutes_; }
void StudySession::setStudentId(const std::string& studentId) { studentId_ = studentId; }
void StudySession::setCourseId(const std::string& courseId) { courseId_ = courseId; }
void StudySession::setTopicId(const std::string& topicId) { topicId_ = topicId; }
void StudySession::setStartTime(const std::string& startTime) { startTime_ = startTime; }
void StudySession::setEndTime(const std::string& endTime) { endTime_ = endTime; }
void StudySession::setNotes(const std::string& notes) { notes_ = notes; }
void StudySession::setDurationMinutes(int minutes) {
	if (minutes < 0) throw std::invalid_argument("session duration cannot be negative");
	durationMinutes_ = minutes;
}

}

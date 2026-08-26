#include "Progress.h"

#include <stdexcept>
#include <utility>

namespace studygps {

namespace {
void validatePercent(int percent, const char* field) {
	if (percent < 0 || percent > 100) throw std::invalid_argument(std::string(field) + " must be between 0 and 100");
}
}

Progress::Progress(std::string studentId, std::string courseId)
	: studentId_(std::move(studentId)), courseId_(std::move(courseId)) {}
const std::string& Progress::getStudentId() const { return studentId_; }
const std::string& Progress::getCourseId() const { return courseId_; }
const std::string& Progress::getTopicId() const { return topicId_; }
int Progress::getCompletionPercent() const { return completionPercent_; }
int Progress::getMasteryPercent() const { return masteryPercent_; }
int Progress::getCompletedTasks() const { return completedTasks_; }
int Progress::getTotalTasks() const { return totalTasks_; }
int Progress::getStudyMinutes() const { return studyMinutes_; }
void Progress::setStudentId(const std::string& studentId) { studentId_ = studentId; }
void Progress::setCourseId(const std::string& courseId) { courseId_ = courseId; }
void Progress::setTopicId(const std::string& topicId) { topicId_ = topicId; }
void Progress::setCompletionPercent(int percent) { validatePercent(percent, "completion"); completionPercent_ = percent; }
void Progress::setMasteryPercent(int percent) { validatePercent(percent, "mastery"); masteryPercent_ = percent; }
void Progress::setCompletedTasks(int count) {
	if (count < 0 || count > totalTasks_) throw std::invalid_argument("completed tasks must be within total tasks");
	completedTasks_ = count;
}
void Progress::setTotalTasks(int count) {
	if (count < 0 || count < completedTasks_) throw std::invalid_argument("total tasks cannot be below completed tasks");
	totalTasks_ = count;
}
void Progress::setStudyMinutes(int minutes) {
	if (minutes < 0) throw std::invalid_argument("study minutes cannot be negative");
	studyMinutes_ = minutes;
}

}

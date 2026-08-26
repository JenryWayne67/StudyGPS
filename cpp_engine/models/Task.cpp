#include "Task.h"

#include <stdexcept>

namespace studygps {

Task::Task(std::string id, std::string title, std::string courseId,
		   int estimatedMinutes)
	: id_(std::move(id)), title_(std::move(title)), courseId_(std::move(courseId)) {
	setEstimatedMinutes(estimatedMinutes);
}

const std::string& Task::getId() const { return id_; }
const std::string& Task::getTitle() const { return title_; }
const std::string& Task::getDescription() const { return description_; }
const std::string& Task::getCourseId() const { return courseId_; }
const std::string& Task::getTopicId() const { return topicId_; }
const std::string& Task::getDueDate() const { return dueDate_; }
int Task::getEstimatedMinutes() const { return estimatedMinutes_; }
TaskPriority Task::getPriority() const { return priority_; }
TaskStatus Task::getStatus() const { return status_; }
const std::vector<std::string>& Task::getDependencyIds() const { return dependencyIds_; }

void Task::setTitle(const std::string& title) { title_ = title; }
void Task::setDescription(const std::string& description) { description_ = description; }
void Task::setCourseId(const std::string& courseId) { courseId_ = courseId; }
void Task::setTopicId(const std::string& topicId) { topicId_ = topicId; }
void Task::setDueDate(const std::string& dueDate) { dueDate_ = dueDate; }
void Task::setEstimatedMinutes(int minutes) {
	if (minutes < 0) {
		throw std::invalid_argument("estimated minutes cannot be negative");
	}
	estimatedMinutes_ = minutes;
}
void Task::setPriority(TaskPriority priority) { priority_ = priority; }
void Task::setStatus(TaskStatus status) { status_ = status; }
void Task::setDependencyIds(const std::vector<std::string>& dependencyIds) {
	dependencyIds_ = dependencyIds;
}
void Task::addDependency(const std::string& dependencyId) {
	if (!dependencyId.empty()) {
		dependencyIds_.push_back(dependencyId);
	}
}
bool Task::isCompleted() const { return status_ == TaskStatus::Completed; }

}

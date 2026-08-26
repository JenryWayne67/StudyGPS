#ifndef STUDYGPS_TASK_H
#define STUDYGPS_TASK_H

#include <string>
#include <vector>

namespace studygps {

enum class TaskPriority { Low, Medium, High, Urgent };
enum class TaskStatus { Pending, InProgress, Completed, Cancelled };

class Task {
public:
	Task() = default;
	Task(std::string id, std::string title, std::string courseId,
		 int estimatedMinutes = 0);

	const std::string& getId() const;
	const std::string& getTitle() const;
	const std::string& getDescription() const;
	const std::string& getCourseId() const;
	const std::string& getTopicId() const;
	const std::string& getDueDate() const;
	int getEstimatedMinutes() const;
	TaskPriority getPriority() const;
	TaskStatus getStatus() const;
	const std::vector<std::string>& getDependencyIds() const;

	void setTitle(const std::string& title);
	void setDescription(const std::string& description);
	void setCourseId(const std::string& courseId);
	void setTopicId(const std::string& topicId);
	void setDueDate(const std::string& dueDate);
	void setEstimatedMinutes(int minutes);
	void setPriority(TaskPriority priority);
	void setStatus(TaskStatus status);
	void setDependencyIds(const std::vector<std::string>& dependencyIds);
	void addDependency(const std::string& dependencyId);
	bool isCompleted() const;

private:
	std::string id_;
	std::string title_;
	std::string description_;
	std::string courseId_;
	std::string topicId_;
	std::string dueDate_;
	int estimatedMinutes_ = 0;
	TaskPriority priority_ = TaskPriority::Medium;
	TaskStatus status_ = TaskStatus::Pending;
	std::vector<std::string> dependencyIds_;
};

}

#endif

#include "Course.h"

#include <stdexcept>
#include <utility>

namespace studygps {

Course::Course(std::string id, std::string name, std::string description)
	: id_(std::move(id)), name_(std::move(name)), description_(std::move(description)) {}

const std::string& Course::getId() const { return id_; }
const std::string& Course::getName() const { return name_; }
const std::string& Course::getDescription() const { return description_; }
const std::string& Course::getInstructor() const { return instructor_; }
int Course::getCompletionPercent() const { return completionPercent_; }
const std::vector<std::string>& Course::getTopicIds() const { return topicIds_; }
void Course::setName(const std::string& name) { name_ = name; }
void Course::setDescription(const std::string& description) { description_ = description; }
void Course::setInstructor(const std::string& instructor) { instructor_ = instructor; }
void Course::setCompletionPercent(int percent) {
	if (percent < 0 || percent > 100) throw std::invalid_argument("completion must be between 0 and 100");
	completionPercent_ = percent;
}
void Course::setTopicIds(const std::vector<std::string>& topicIds) { topicIds_ = topicIds; }
void Course::addTopic(const std::string& topicId) {
	if (!topicId.empty()) topicIds_.push_back(topicId);
}

}

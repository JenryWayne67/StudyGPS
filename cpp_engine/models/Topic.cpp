#include "Topic.h"

#include <stdexcept>
#include <utility>

namespace studygps {

Topic::Topic(std::string id, std::string courseId, std::string name)
	: id_(std::move(id)), courseId_(std::move(courseId)), name_(std::move(name)) {}

const std::string& Topic::getId() const { return id_; }
const std::string& Topic::getCourseId() const { return courseId_; }
const std::string& Topic::getName() const { return name_; }
const std::string& Topic::getDescription() const { return description_; }
int Topic::getMasteryPercent() const { return masteryPercent_; }
const std::vector<std::string>& Topic::getPrerequisiteIds() const { return prerequisiteIds_; }
void Topic::setCourseId(const std::string& courseId) { courseId_ = courseId; }
void Topic::setName(const std::string& name) { name_ = name; }
void Topic::setDescription(const std::string& description) { description_ = description; }
void Topic::setMasteryPercent(int percent) {
	if (percent < 0 || percent > 100) throw std::invalid_argument("mastery must be between 0 and 100");
	masteryPercent_ = percent;
}
void Topic::setPrerequisiteIds(const std::vector<std::string>& prerequisiteIds) { prerequisiteIds_ = prerequisiteIds; }
void Topic::addPrerequisite(const std::string& topicId) {
	if (!topicId.empty()) prerequisiteIds_.push_back(topicId);
}

}

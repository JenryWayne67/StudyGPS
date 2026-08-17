#include "Course.h"

Course::Course() : courseCode_(""), title_(""), description_(""), creditHours_(0) {}

Course::Course(const std::string& courseCode, const std::string& title,
               const std::string& description, int creditHours)
    : courseCode_(courseCode), title_(title), description_(description), creditHours_(creditHours) {}

const std::string& Course::getCourseCode() const {
    return courseCode_;
}

void Course::setCourseCode(const std::string& courseCode) {
    courseCode_ = courseCode;
}

const std::string& Course::getTitle() const {
    return title_;
}

void Course::setTitle(const std::string& title) {
    title_ = title;
}

const std::string& Course::getDescription() const {
    return description_;
}

void Course::setDescription(const std::string& description) {
    description_ = description;
}

int Course::getCreditHours() const {
    return creditHours_;
}

void Course::setCreditHours(int creditHours) {
    creditHours_ = creditHours;
}

const std::vector<std::string>& Course::getTopics() const {
    return topics_;
}

void Course::addTopic(const std::string& topicTitle) {
    topics_.push_back(topicTitle);
}

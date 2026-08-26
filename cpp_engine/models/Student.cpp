#include "Student.h"

#include <stdexcept>
#include <utility>

namespace studygps {

Student::Student(std::string id, std::string name, std::string email)
	: id_(std::move(id)), name_(std::move(name)), email_(std::move(email)) {}

const std::string& Student::getId() const { return id_; }
const std::string& Student::getName() const { return name_; }
const std::string& Student::getEmail() const { return email_; }
int Student::getDailyStudyGoalMinutes() const { return dailyStudyGoalMinutes_; }
const std::vector<std::string>& Student::getCourseIds() const { return courseIds_; }
void Student::setName(const std::string& name) { name_ = name; }
void Student::setEmail(const std::string& email) { email_ = email; }
void Student::setDailyStudyGoalMinutes(int minutes) {
	if (minutes < 0) throw std::invalid_argument("study goal cannot be negative");
	dailyStudyGoalMinutes_ = minutes;
}
void Student::setCourseIds(const std::vector<std::string>& courseIds) { courseIds_ = courseIds; }
void Student::addCourse(const std::string& courseId) {
	if (!courseId.empty()) courseIds_.push_back(courseId);
}

}

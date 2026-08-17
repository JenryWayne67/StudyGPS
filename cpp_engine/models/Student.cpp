#include "Student.h"

Student::Student() : id_(0), name_(""), email_(""), major_(""), academicYear_("") {}

Student::Student(int id, const std::string& name, const std::string& email,
                 const std::string& major, const std::string& academicYear)
    : id_(id), name_(name), email_(email), major_(major), academicYear_(academicYear) {}

int Student::getId() const {
    return id_;
}

void Student::setId(int id) {
    id_ = id;
}

const std::string& Student::getName() const {
    return name_;
}

void Student::setName(const std::string& name) {
    name_ = name;
}

const std::string& Student::getEmail() const {
    return email_;
}

void Student::setEmail(const std::string& email) {
    email_ = email;
}

const std::string& Student::getMajor() const {
    return major_;
}

void Student::setMajor(const std::string& major) {
    major_ = major;
}

const std::string& Student::getAcademicYear() const {
    return academicYear_;
}

void Student::setAcademicYear(const std::string& academicYear) {
    academicYear_ = academicYear;
}

const std::vector<std::string>& Student::getEnrolledCourseCodes() const {
    return enrolledCourseCodes_;
}

void Student::addEnrolledCourseCode(const std::string& courseCode) {
    enrolledCourseCodes_.push_back(courseCode);
}

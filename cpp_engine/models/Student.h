#pragma once

#include <string>
#include <vector>

class Student {
public:
    Student();
    Student(int id, const std::string& name, const std::string& email,
            const std::string& major, const std::string& academicYear);

    int getId() const;
    void setId(int id);

    const std::string& getName() const;
    void setName(const std::string& name);

    const std::string& getEmail() const;
    void setEmail(const std::string& email);

    const std::string& getMajor() const;
    void setMajor(const std::string& major);

    const std::string& getAcademicYear() const;
    void setAcademicYear(const std::string& academicYear);

    const std::vector<std::string>& getEnrolledCourseCodes() const;
    void addEnrolledCourseCode(const std::string& courseCode);

private:
    int id_;
    std::string name_;
    std::string email_;
    std::string major_;
    std::string academicYear_;
    std::vector<std::string> enrolledCourseCodes_;
};

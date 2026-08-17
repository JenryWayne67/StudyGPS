#pragma once

#include <string>
#include <vector>

class Course {
public:
    Course();
    Course(const std::string& courseCode, const std::string& title,
           const std::string& description, int creditHours);

    const std::string& getCourseCode() const;
    void setCourseCode(const std::string& courseCode);

    const std::string& getTitle() const;
    void setTitle(const std::string& title);

    const std::string& getDescription() const;
    void setDescription(const std::string& description);

    int getCreditHours() const;
    void setCreditHours(int creditHours);

    const std::vector<std::string>& getTopics() const;
    void addTopic(const std::string& topicTitle);

private:
    std::string courseCode_;
    std::string title_;
    std::string description_;
    int creditHours_;
    std::vector<std::string> topics_;
};

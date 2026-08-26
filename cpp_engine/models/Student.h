#ifndef STUDYGPS_STUDENT_H
#define STUDYGPS_STUDENT_H

#include <string>
#include <vector>

namespace studygps {

class Student {
public:
	Student() = default;
	Student(std::string id, std::string name, std::string email);

	const std::string& getId() const;
	const std::string& getName() const;
	const std::string& getEmail() const;
	int getDailyStudyGoalMinutes() const;
	const std::vector<std::string>& getCourseIds() const;

	void setName(const std::string& name);
	void setEmail(const std::string& email);
	void setDailyStudyGoalMinutes(int minutes);
	void setCourseIds(const std::vector<std::string>& courseIds);
	void addCourse(const std::string& courseId);

private:
	std::string id_;
	std::string name_;
	std::string email_;
	int dailyStudyGoalMinutes_ = 60;
	std::vector<std::string> courseIds_;
};

}

#endif

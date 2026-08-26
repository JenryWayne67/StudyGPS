#ifndef STUDYGPS_COURSE_H
#define STUDYGPS_COURSE_H

#include <string>
#include <vector>

namespace studygps {

class Course {
public:
	Course() = default;
	Course(std::string id, std::string name, std::string description = "");

	const std::string& getId() const;
	const std::string& getName() const;
	const std::string& getDescription() const;
	const std::string& getInstructor() const;
	int getCompletionPercent() const;
	const std::vector<std::string>& getTopicIds() const;

	void setName(const std::string& name);
	void setDescription(const std::string& description);
	void setInstructor(const std::string& instructor);
	void setCompletionPercent(int percent);
	void setTopicIds(const std::vector<std::string>& topicIds);
	void addTopic(const std::string& topicId);

private:
	std::string id_;
	std::string name_;
	std::string description_;
	std::string instructor_;
	int completionPercent_ = 0;
	std::vector<std::string> topicIds_;
};

}

#endif

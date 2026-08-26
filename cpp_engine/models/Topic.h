#ifndef STUDYGPS_TOPIC_H
#define STUDYGPS_TOPIC_H

#include <string>
#include <vector>

namespace studygps {

class Topic {
public:
	Topic() = default;
	Topic(std::string id, std::string courseId, std::string name);

	const std::string& getId() const;
	const std::string& getCourseId() const;
	const std::string& getName() const;
	const std::string& getDescription() const;
	int getMasteryPercent() const;
	const std::vector<std::string>& getPrerequisiteIds() const;

	void setCourseId(const std::string& courseId);
	void setName(const std::string& name);
	void setDescription(const std::string& description);
	void setMasteryPercent(int percent);
	void setPrerequisiteIds(const std::vector<std::string>& prerequisiteIds);
	void addPrerequisite(const std::string& topicId);

private:
	std::string id_;
	std::string courseId_;
	std::string name_;
	std::string description_;
	int masteryPercent_ = 0;
	std::vector<std::string> prerequisiteIds_;
};

}

#endif

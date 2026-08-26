#ifndef STUDYGPS_SCHEDULE_H
#define STUDYGPS_SCHEDULE_H

#include <string>
#include <vector>

namespace studygps {

struct ScheduleEntry {
	std::string id;
	std::string taskId;
	std::string date;
	std::string startTime;
	std::string endTime;
};

class Schedule {
public:
	Schedule() = default;
	explicit Schedule(std::string studentId);

	const std::string& getStudentId() const;
	const std::vector<ScheduleEntry>& getEntries() const;
	void setStudentId(const std::string& studentId);
	void setEntries(const std::vector<ScheduleEntry>& entries);
	void addEntry(const ScheduleEntry& entry);
	bool removeEntry(const std::string& entryId);

private:
	std::string studentId_;
	std::vector<ScheduleEntry> entries_;
};

}

#endif

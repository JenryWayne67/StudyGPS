#include "Schedule.h"

#include <algorithm>
#include <utility>

namespace studygps {

Schedule::Schedule(std::string studentId) : studentId_(std::move(studentId)) {}
const std::string& Schedule::getStudentId() const { return studentId_; }
const std::vector<ScheduleEntry>& Schedule::getEntries() const { return entries_; }
void Schedule::setStudentId(const std::string& studentId) { studentId_ = studentId; }
void Schedule::setEntries(const std::vector<ScheduleEntry>& entries) { entries_ = entries; }
void Schedule::addEntry(const ScheduleEntry& entry) { entries_.push_back(entry); }
bool Schedule::removeEntry(const std::string& entryId) {
	const auto oldSize = entries_.size();
	entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
								  [&](const ScheduleEntry& entry) { return entry.id == entryId; }),
				   entries_.end());
	return entries_.size() != oldSize;
}

}

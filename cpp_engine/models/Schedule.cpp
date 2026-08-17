#include "Schedule.h"

Schedule::Schedule() : name_(""), weekStartDate_("") {}

Schedule::Schedule(const std::string& name, const std::string& weekStartDate)
    : name_(name), weekStartDate_(weekStartDate) {}

const std::string& Schedule::getName() const {
    return name_;
}

void Schedule::setName(const std::string& name) {
    name_ = name;
}

const std::string& Schedule::getWeekStartDate() const {
    return weekStartDate_;
}

void Schedule::setWeekStartDate(const std::string& weekStartDate) {
    weekStartDate_ = weekStartDate;
}

const std::vector<std::string>& Schedule::getSessionIds() const {
    return sessionIds_;
}

void Schedule::addSessionId(const std::string& sessionId) {
    sessionIds_.push_back(sessionId);
}
